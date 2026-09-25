/**
 * 出纳日记账外币（USD）全链路冒烟脚本 —— FIX-260
 *
 * 在独立数据库副本 + 独立端口上起真实服务，用 HTTP 走完整链路并断言：
 *   ① 开启外币核算、维护 USD 币种与汇率、把银行科目 1002.99 设为 USD 外币科目
 *   ② /cashier/accounts 带 is_foreign / currency_code；/cashier/journal/rate 解析出 USD + 汇率
 *   ③ 录入 USD 流水（带 / 不带汇率）→ 列表原币余额 + 本位币合计；修改汇率重算本位币
 *   ④ 期初 USD 行；余额调节表按 USD 取数
 *   ⑤ 生成凭证：金额 = 原币 × 汇率，现金分录带外币三字段，对方科目三字段为空
 *   ⑥ 凭证录入（外币分录）→ 开启 auto_sync 后日记账出现 USD 行（原币 = foreign_amount）
 *   ⑦ 对账单导入 USD 金额 → 自动勾对按原币匹配
 *   ⑧ 本位币科目行为不变（汇率强制 1）；传错币种被拒绝
 *
 * 运行：node scratch/cashierFxSmokeTest.mjs
 */
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-cashier-fx-smoke')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3199
const BASE = `http://127.0.0.1:${PORT}`
const results = []
let step = 0
function ok(name, detail) { step++; results.push({ n: step, name, pass: true, detail }); console.log(`PASS ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function bad(name, detail) { step++; results.push({ n: step, name, pass: false, detail }); console.log(`FAIL ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function assert(name, cond, detail) { (cond ? ok : bad)(name, detail) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

async function prepDb() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true })
  await src.backup(TEMP_DB)
  src.close()
}

async function waitServer(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/auth/account-sets`); if (r.ok) return true } catch { /* not up */ }
    await sleep(700)
  }
  throw new Error('server did not come up in time')
}

let child, log = ''
async function startServer() {
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => { log += d.toString() })
  child.stderr.on('data', d => { log += d.toString() })
  try { await waitServer() } catch (e) { console.log('--- server log ---\n' + log.slice(-4000)); throw e }
}

let token = ''
let ASID = ''
async function api(method, path, body, { allowError = false } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-set-id': ASID },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await r.text()
  let json
  try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  if (!r.ok && !allowError) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 300)}`)
  return { status: r.status, ...json }
}
const post = (p, b, o) => api('POST', p, b, o)
const put = (p, b, o) => api('PUT', p, b, o)
const get = (p, o) => api('GET', p, undefined, o)

const USD_CODE = '1002999'
const CNY_CODE = '1001'
const D = '2026-09-10'

async function main() {
  await prepDb()
  await startServer()

  // 登录（账套取列表第一项）
  {
    const sets = (await fetch(`${BASE}/api/auth/account-sets`).then(x => x.json())).data
    ASID = sets[0].id
    const lr = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: ASID }),
    }).then(x => x.json())
    token = lr.token
    assert('admin 登录', !!token, sets[0].name)
  }

  // ① 外币核算开关 + USD 币种 + 汇率 + 外币科目
  await put('/api/system/params', { params: [{ param_key: 'enable_foreign_currency', param_value: 'true' }] })
  {
    const cur = await post('/api/base/currencies', { code: 'USD', name: '美元', default_rate: 7, end_rate: 7.1, rate_decimals: 4, is_enabled: 1 }, { allowError: true })
    assert('USD 币种存在', cur.status === 200 || /已存在/.test(cur.message || ''), cur.message || '')
    await post('/api/base/exchange-rates', { currency_code: 'USD', year: 2026, period: 9, rate: 7.2 })
    const rs = await get('/api/base/exchange-rates/resolve?currency_code=USD&year=2026&period=9')
    assert('9 月 USD 汇率 = 7.2', r2(rs.data?.rate ?? rs.data) === 7.2, JSON.stringify(rs.data))
  }
  // 银行科目：1002 下新建末级 USD 科目（若 1002 已有下级则直接挂在 1002 下）
  {
    const accs = (await get('/api/base/accounts')).data
    const flat = []
    const walk = a => { flat.push(a); (a.children || []).forEach(walk) }
    ;(Array.isArray(accs) ? accs : []).forEach(walk)
    const bank = flat.find(a => a.code === '1002')
    assert('存在银行存款科目 1002', !!bank)
    let usd = flat.find(a => a.code === USD_CODE)
    if (!usd) {
      const r = await post('/api/base/accounts', { code: USD_CODE, name: '美元户', parent_id: bank.id, direction: bank.direction || 'debit', is_bank: 1, is_foreign: 1, currency_code: 'USD' }, { allowError: true })
      assert('新建 USD 银行科目', r.status === 200, r.message || '')
      usd = r.data
    } else {
      await put(`/api/base/accounts/${usd.id}`, { name: usd.name, is_bank: 1, is_foreign: 1, currency_code: 'USD' })
    }
  }

  // ② 出纳科目列表带外币属性；默认汇率接口
  {
    const list = (await get('/api/cashier/accounts')).data
    const usd = list.find(a => a.code === USD_CODE)
    assert('/cashier/accounts 含 USD 科目且 is_foreign=1 / currency_code=USD', usd && Number(usd.is_foreign) === 1 && usd.currency_code === 'USD', JSON.stringify(usd))
    const rate = (await get(`/api/cashier/journal/rate?account_code=${USD_CODE}&biz_date=${D}`)).data
    assert('journal/rate → USD + 7.2', rate.currency === 'USD' && r2(rate.rate) === 7.2 && rate.is_foreign === true, JSON.stringify(rate))
    const rateCny = (await get(`/api/cashier/journal/rate?account_code=${CNY_CODE}&biz_date=${D}`)).data
    assert('本位币科目 rate → RMB / 1', rateCny.currency === 'RMB' && rateCny.rate === 1 && rateCny.is_foreign === false, JSON.stringify(rateCny))
    const curs = (await get('/api/cashier/currencies')).data
    assert('出纳币种列表含主数据 USD（本位币在前）', curs[0] === 'RMB' && curs.includes('USD'), curs.join(','))
  }

  // ④ 期初 USD（账套已有对账单据时接口禁止改期初，这里直接写库模拟历史导入的 USD 期初行）
  {
    const db = new Database(TEMP_DB)
    db.prepare("DELETE FROM cashier_init_balance WHERE account_set_id=? AND account_code=?").run(ASID, USD_CODE)
    db.prepare("INSERT INTO cashier_init_balance (id, account_set_id, account_code, currency, balance, init_date) VALUES (?,?,?,?,?,?)")
      .run('ib-usd-smoke', ASID, USD_CODE, 'USD', 1000, '2026-01-01')
    db.close()
  }

  // ③ 录入 USD 流水
  let j1, j2
  {
    const r1 = await post('/api/cashier/journal', { account_code: USD_CODE, biz_date: D, summary: '收美元货款', debit: 100, credit: 0, exchange_rate: 7.25, counter_account: '1122' })
    j1 = r1.data
    assert('录入 USD 收入 100 @7.25', r1.code === 0 && r1.data.currency === 'USD' && r1.data.exchange_rate === 7.25, JSON.stringify(r1.data))
    const r2r = await post('/api/cashier/journal', { account_code: USD_CODE, biz_date: D, summary: '付美元运费', debit: 0, credit: 40, counter_account: '6601' }, { allowError: true })
    if (r2r.status !== 200) {
      // 6601 可能非末级，退回用 1122
      const alt = await post('/api/cashier/journal', { account_code: USD_CODE, biz_date: D, summary: '付美元运费', debit: 0, credit: 40, counter_account: '1122' })
      j2 = alt.data
    } else j2 = r2r.data
    assert('录入 USD 支出 40（不传汇率 → 取期间汇率 7.2）', j2 && j2.currency === 'USD' && r2(j2.exchange_rate) === 7.2, JSON.stringify(j2))

    const bad1 = await post('/api/cashier/journal', { account_code: USD_CODE, biz_date: D, summary: 'x', debit: 1, credit: 0, currency: 'RMB' }, { allowError: true })
    assert('传入与科目不一致的币种被拒绝（400）', bad1.status === 400 && /币种/.test(bad1.message), bad1.message)
    const bad2 = await post('/api/cashier/journal', { account_code: USD_CODE, biz_date: D, summary: 'x', debit: 1, credit: 0, exchange_rate: -1 }, { allowError: true })
    assert('汇率 <= 0 被拒绝（400）', bad2.status === 400 && /汇率/.test(bad2.message), bad2.message)

    const list = (await get(`/api/cashier/journal?account_code=${USD_CODE}&start_date=2026-09-01&end_date=2026-09-30`)).data
    assert('列表 currency=USD、期初 1000、期末 1060（原币）', list.currency === 'USD' && list.opening === 1000 && r2(list.closing) === 1060, `opening=${list.opening} closing=${list.closing}`)
    assert('本位币合计：借 725 / 贷 288', r2(list.totalBaseDebit) === 725 && r2(list.totalBaseCredit) === 288, `bd=${list.totalBaseDebit} bc=${list.totalBaseCredit}`)
    const row1 = list.rows.find(r => r.id === j1.id)
    assert('行带 exchange_rate / base_debit', row1 && row1.exchange_rate === 7.25 && r2(row1.base_debit) === 725, JSON.stringify({ er: row1?.exchange_rate, bd: row1?.base_debit }))

    // 修改汇率 → 本位币重算
    await put(`/api/cashier/journal/${j1.id}`, { exchange_rate: 7.3 })
    const row1b = (await get(`/api/cashier/journal/${j1.id}`)).data
    assert('修改汇率 7.3 → base_debit 730、币种仍 USD', row1b.currency === 'USD' && r2(row1b.base_debit) === 730, JSON.stringify({ c: row1b.currency, bd: row1b.base_debit }))
    await put(`/api/cashier/journal/${j1.id}`, { debit: 200 })
    const row1c = (await get(`/api/cashier/journal/${j1.id}`)).data
    assert('修改原币 200（不传汇率）→ 沿用 7.3 → base_debit 1460', r2(row1c.base_debit) === 1460 && row1c.exchange_rate === 7.3, JSON.stringify({ bd: row1c.base_debit, er: row1c.exchange_rate }))
  }

  // ⑧ 本位币科目行为不变
  {
    const r = await post('/api/cashier/journal', { account_code: CNY_CODE, biz_date: D, summary: '人民币收入', debit: 50, credit: 0, exchange_rate: 9, counter_account: '1122' })
    const row = (await get(`/api/cashier/journal/${r.data.id}`)).data
    assert('本位币科目：汇率强制 1、base_debit = debit', row.currency === 'RMB' && row.exchange_rate === 1 && r2(row.base_debit) === 50, JSON.stringify({ c: row.currency, er: row.exchange_rate, bd: row.base_debit }))
    await api('DELETE', `/api/cashier/journal/${r.data.id}`)
  }

  // ④ 出纳与总账对账表按 USD 原币（FIX-262：原银行余额调节表下线）
  {
    const rc = (await get(`/api/cashier/gl-reconcile/report?account_code=${USD_CODE}&end_date=2026-09-30`)).data
    assert('对账表 currency=USD、出纳余额 1160（原币）', rc.currency === 'USD' && r2(rc.cashier_balance) === 1160, JSON.stringify({ c: rc.currency, b: rc.cashier_balance }))
  }

  // ⑦ 出纳对账工作台按原币出数（凭证未记账前总账一侧为空）
  {
    const en = (await get(`/api/cashier/gl-reconcile/entries?account_code=${USD_CODE}&start_date=2026-09-01&end_date=2026-09-30`)).data
    assert('出纳对账：币种 USD、出纳侧含本月日记账', en.summary?.currency === 'USD' && en.cashier.length >= 2, JSON.stringify({ c: en.summary?.currency, n: en.cashier.length }))
  }

  // ⑤ 生成凭证
  {
    const pv = await post('/api/cashier/generate-voucher/preview', { account_code: USD_CODE, ids: [j1.id, j2.id] })
    const prow = pv.data.rows.find(r => r.id === j1.id)
    assert('预览行带 currency / exchange_rate / base_debit', prow && prow.currency === 'USD' && prow.exchange_rate === 7.3 && r2(prow.base_debit) === 1460, JSON.stringify(prow))
    const gv = await post('/api/cashier/generate-voucher', { account_code: USD_CODE, ids: [j1.id, j2.id] }, { allowError: true })
    assert('生成凭证成功（2 张）', gv.status === 200 && gv.data?.voucherIds?.length === 2, gv.message || JSON.stringify(gv.data?.details))
    if (gv.data?.voucherIds?.length) {
      const d1 = gv.data.details.find(d => d.bizDate === D && d.direction === '收入')
      assert('明细：本位币 1460 / 原币 200 / 汇率 7.3', d1 && r2(d1.amount) === 1460 && d1.foreignAmount === 200 && d1.exchangeRate === 7.3, JSON.stringify(d1))
      const db = new Database(TEMP_DB, { readonly: true })
      const entries = db.prepare('SELECT account_code, direction, amount, currency_code, exchange_rate, foreign_amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq').all(gv.data.voucherIds[0])
      db.close()
      const cash = entries.find(e => e.account_code === USD_CODE)
      const counter = entries.find(e => e.account_code !== USD_CODE)
      assert('现金分录：amount 1460、USD/7.3/200', cash && r2(cash.amount) === 1460 && cash.currency_code === 'USD' && cash.exchange_rate === 7.3 && cash.foreign_amount === 200, JSON.stringify(cash))
      assert('对方（非外币）分录：amount 1460、外币三字段为空', counter && r2(counter.amount) === 1460 && counter.currency_code == null && counter.foreign_amount == null, JSON.stringify(counter))
      // 凭证能通过总账校验：读取凭证详情
      const vd = await get(`/api/voucher/vouchers/${gv.data.voucherIds[0]}`, { allowError: true })
      assert('凭证详情可读', vd.status === 200, vd.message || '')
    }
  }

  // ⑥ 凭证 → 出纳同步（外币分录）
  {
    await put('/api/system/params', { params: [{ param_key: 'cashier:auto_sync', param_value: '1' }] })
    const vt = (await get('/api/base/voucher-types', { allowError: true })).data
    const vtId = Array.isArray(vt) && vt.length ? vt[0].id : undefined
    const accs = (await get('/api/base/accounts')).data
    const flat = []
    const walk = a => { flat.push(a); (a.children || []).forEach(walk) }
    ;(Array.isArray(accs) ? accs : []).forEach(walk)
    const byCode = code => flat.find(a => a.code === code)
    const vr = await post('/api/voucher/vouchers', {
      voucher_type_id: vtId,
      voucher_date: '2026-09-12',
      remark: '同步测试',
      entries: [
        { account_id: byCode(USD_CODE)?.id, account_code: USD_CODE, account_name: '美元户', direction: 'debit', amount: 730, summary: '收美元', currency_code: 'USD', exchange_rate: 7.3, foreign_amount: 100 },
        { account_id: byCode('1122')?.id, account_code: '1122', account_name: '应收账款', direction: 'credit', amount: 730, summary: '收美元' },
      ],
    }, { allowError: true })
    assert('录入外币凭证成功', vr.status === 200, vr.message || '')
    const list = (await get(`/api/cashier/journal?account_code=${USD_CODE}&start_date=2026-09-12&end_date=2026-09-12`)).data
    const synced = list.rows.find(r => r.created_by === '凭证同步')
    assert('同步出的日记账：USD、原币 100、汇率 7.3、本位币 730', synced && synced.currency === 'USD' && synced.debit === 100 && synced.exchange_rate === 7.3 && r2(synced.base_debit) === 730, JSON.stringify(synced && { c: synced.currency, d: synced.debit, er: synced.exchange_rate, bd: synced.base_debit }))
  }

  // 币种删除保护
  {
    const curs = (await get('/api/base/currencies?include_disabled=1')).data
    const usd = curs.find(c => c.code === 'USD')
    const del = await api('DELETE', `/api/base/currencies/${usd.id}`, undefined, { allowError: true })
    assert('USD 被出纳 / 科目引用时不能删除', del.status !== 200, del.message || '')
  }

  const fails = results.filter(r => !r.pass)
  console.log(`\n==== ${results.length} 步，${fails.length} 失败 ====`)
  if (fails.length) process.exitCode = 1
}

main().catch(e => { console.error(e); console.log('--- server log ---\n' + log.slice(-3000)); process.exitCode = 1 }).finally(() => { try { child?.kill() } catch { /* ignore */ } })

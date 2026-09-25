/**
 * 固定资产 ↔ 总账 联动端到端测试
 *
 * 在独立数据库中：建资产卡片 → 计提折旧（生成凭证）→ 总账取数核对
 * → 反折旧复原 → 再计提 → 记账过账 → 已记账口径核对。
 *
 * 运行：node scratch/fixedAssetGlTest.mjs
 */
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = 'C:\\Users\\Administrator\\AppData\\Local\\Temp\\1\\opencode\\fa-gl-test'
const TEMP_DB = join(WORK, 'finance.db')
const SERVER_LOG = join(WORK, 'server.log')
const PORT = 3199
const BASE = `http://127.0.0.1:${PORT}`
const GOV_SET = '7411a620-abaf-4046-90e1-57bbd6280809'
const Y = 2026, M = 9
const results = []
let step = 0
function ok(name, detail) { step++; results.push({ n: step, name, pass: true, detail }); console.log(`PASS ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function bad(name, detail) { step++; results.push({ n: step, name, pass: false, detail }); console.log(`FAIL ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function assert(name, cond, detail) { (cond ? ok : bad)(name, detail) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function prepDb() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  // WAL 模式下必须用 backup，直接复制 .db 会丢未 checkpoint 的事务
  const src = new Database(SRC_DB, { readonly: true })
  return src.backup(TEMP_DB).then(() => src.close())
}

async function waitServer(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/auth/account-sets`)
      if (r.ok) return true
    } catch { /* not up yet */ }
    await sleep(700)
  }
  throw new Error('server did not come up in time; see ' + SERVER_LOG)
}

let child
async function startServer() {
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d.toString() })
  child.stderr.on('data', d => { log += d.toString() })
  try {
    await waitServer()
  } catch (e) {
    console.log('--- server log ---\n' + log.slice(-4000))
    throw e
  }
}

let token = '', asid = GOV_SET
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-set-id': asid },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await r.text()
  let json
  try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function main() {
  await prepDb()

  // 让记账可直接进行（资产折旧凭证为 draft，测试聚焦过账后总账联动）
  {
    const db = new Database(TEMP_DB)
    const as = db.prepare('SELECT id, code, name FROM account_sets').all()
    const chosen = as.find(s => s.id === GOV_SET) || as[0]
    asid = chosen.id
    db.prepare("UPDATE system_params SET param_value='false' WHERE account_set_id=? AND param_key='require_audit'").run(asid)
    db.prepare("INSERT OR REPLACE INTO system_params (id, account_set_id, param_key, param_value) VALUES ('test-allow-direct', ?, 'allow_direct_post', 'true')").run(asid)
    // 2026-09-25：测试账套里已有历史测试卡片（ZCTEST01~04 等），会混进本脚本的折旧预览 / 合计断言。
    // 只在临时库副本里清掉该账套原有的资产业务数据，保证脚本只面对自己新建的 3 张卡片。
    for (const t of ['fixed_asset_depr', 'fixed_asset_change', 'fixed_asset_workload', 'fixed_asset_requisition', 'fixed_asset']) {
      try { db.prepare(`DELETE FROM ${t} WHERE account_set_id=?`).run(asid) } catch { /* 表不存在则跳过 */ }
    }
    db.prepare("DELETE FROM vouchers WHERE account_set_id=? AND source LIKE 'asset_%'").run(asid)
    db.close()
    console.log(`测试账套：${chosen.code} ${chosen.name} (${asid})`)
  }

  await startServer()

  // 登录
  {
    const r = await fetch(`${BASE}/api/auth/account-sets`).then(x => x.json())
    assert('账套列表可访问', Array.isArray(r.data) && r.data.length > 0, `${r.data?.length} 个账套`)
    const lr = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: asid }),
    }).then(x => x.json())
    token = lr.token
    assert('admin 登录成功', !!token)
  }

  // 准备字典
  const dicts = [
    ['category', { code: 'ZTEST', name: '测试资产类别', salvage_rate: 0.05, account_code: '160103', depr_account_code: '1602' }],
    ['status', { code: 'ZT1', name: '在用', depreciable: 1 }],
    ['purpose', { code: 'ZTP', name: '单位管理用', expense_account: '5101' }],
    ['dept', { code: 'ZTD', name: '测试部门' }],
  ]
  for (const [type, data] of dicts) {
    try { await api('POST', `/api/asset/dict/${type}`, data) } catch (e) { if (!/已存在|409/.test(String(e.message))) throw e }
  }
  const dictList = (await api('GET', '/api/asset/dicts')).data
  assert('资产字典就绪', dictList.category.some(c => c.code === 'ZTEST') && dictList.purpose.some(p => p.code === 'ZTP'),
    `类别${dictList.category.length}/状态${dictList.status.length}/用途${dictList.purpose.length}/部门${dictList.dept.length}`)

  // 建卡片（直接 API 新增；折旧方式 1/3/4 各一）
  const cards = [
    { asset_no: 'ZCTEST001', asset_name: '办公电脑', category_code: 'ZTEST', status_code: 'ZT1', purpose_code: 'ZTP', dept_code: 'ZTD', acquire_date: '2026-08-10', start_depr_date: '2026-08-01', original_value: 12000, salvage_rate: 0.05, salvage_value: 600, depr_method: '1', use_months: 24 },
    { asset_no: 'ZCTEST002', asset_name: '生产设备', category_code: 'ZTEST', status_code: 'ZT1', purpose_code: 'ZTP', dept_code: 'ZTD', acquire_date: '2026-07-05', start_depr_date: '2026-07-01', original_value: 100000, salvage_rate: 0.05, salvage_value: 5000, depr_method: '3', use_months: 60 },
    { asset_no: 'ZCTEST003', asset_name: '运输车辆', category_code: 'ZTEST', status_code: 'ZT1', purpose_code: 'ZTP', dept_code: 'ZTD', acquire_date: '2026-06-20', start_depr_date: '2026-06-01', original_value: 60000, salvage_rate: 0.05, salvage_value: 3000, depr_method: '4', use_months: 48 },
  ]
  for (const c of cards) {
    try { await api('POST', '/api/asset/cards', c) } catch (e) { if (!/已存在|409/.test(String(e.message))) throw e }
  }
  const cardList = (await api('GET', '/api/asset/cards?page_size=100')).data
  assert('新增 3 张资产卡片', cards.every(c => cardList.list.some(x => x.asset_no === c.asset_no)), `共 ${cardList.total} 张`)

  // 折旧预览
  const preview = (await api('GET', `/api/asset/depr/preview?year=${Y}&month=${M}`)).data
  const exp = { ZCTEST001: 475.00, ZCTEST002: 3333.33, ZCTEST003: 2326.53 }
  assert('折旧预览生成 3 行', preview.lines.length === 3, preview.lines.map(l => `${l.asset_no}=${l.month_depr}`).join(', '))
  let previewOk = true, previewDetail = []
  for (const l of preview.lines) {
    const e = exp[l.asset_no]
    if (e === undefined || Math.abs(l.month_depr - e) > 0.01) previewOk = false
    previewDetail.push(`${l.asset_no}: 实${l.month_depr} 期${e}`)
  }
  assert('折旧金额与折旧算法一致', previewOk, previewDetail.join(' | '))

  const expectedTotal = Math.round((exp.ZCTEST001 + exp.ZCTEST002 + exp.ZCTEST003) * 100) / 100

  // 计提 + 生成凭证
  const exec = (await api('POST', '/api/asset/depr/execute', { year: Y, month: M, generate_voucher: true, accum_account: '1602' })).data
  assert('计提折旧成功', exec.assetCount === 3 && Math.abs(exec.totalDepr - expectedTotal) < 0.01, `合计 ${exec.totalDepr}`)
  const vid = exec.voucher?.voucherId
  assert('折旧凭证已生成', !!vid, `voucherNo=${exec.voucher?.voucherNo}, 分录${exec.voucher?.entryCount}条`)

  // 凭证分录借贷核对
  {
    const v = (await api('GET', `/api/voucher/vouchers/${vid}`)).data
    const entries = v.entries || v.voucher_entries || []
    const dr = Math.round(entries.filter(e => e.direction === 'debit').reduce((s, e) => s + e.amount, 0) * 100) / 100
    const cr = Math.round(entries.filter(e => e.direction === 'credit').reduce((s, e) => s + e.amount, 0) * 100) / 100
    assert('凭证借贷平衡', dr === cr && Math.abs(dr - expectedTotal) < 0.01, `借${dr} / 贷${cr}`)
    const debitAccts = [...new Set(entries.filter(e => e.direction === 'debit').map(e => e.account_code))].join(',')
    const creditAccts = [...new Set(entries.filter(e => e.direction === 'credit').map(e => e.account_code))].join(',')
    assert('借方=折旧费用科目 5101', debitAccts === '5101', `借方科目 ${debitAccts}`)
    assert('贷方=累计折旧科目 1602', creditAccts === '1602', `贷方科目 ${creditAccts}`)
  }

  // 总账取数（含未记账）
  {
    const rows = (await api('GET', `/api/ledger/general?account_code=1602&start_date=${Y}-09-01&end_date=${Y}-09-30&include_unposted=true`)).data
    const r = rows.find(x => x.account_code === '1602')
    assert('总账「累计折旧1602」贷方发生额=折旧合计', r && Math.abs(r.current_credit - expectedTotal) < 0.01, r ? `贷方 ${r.current_credit}` : '未取到行')

    const rows2 = (await api('GET', `/api/ledger/general?account_code=5101&start_date=${Y}-09-01&end_date=${Y}-09-30&include_unposted=true`)).data
    const r2 = rows2.find(x => x.account_code === '5101')
    assert('总账「单位管理费用5101」借方发生额=折旧合计', r2 && Math.abs(r2.current_debit - expectedTotal) < 0.01, r2 ? `借方 ${r2.current_debit}` : '未取到行')
  }

  // 资产累计折旧/净值回写
  {
    const list = (await api('GET', '/api/asset/cards?page_size=100')).data.list
    const a1 = list.find(x => x.asset_no === 'ZCTEST001')
    assert('卡片累计折旧/净值随计提更新', a1 && Math.abs(a1.accum_depr - 475) < 0.01 && Math.abs(a1.net_value - 11525) < 0.01,
      a1 ? `累计折旧 ${a1.accum_depr}, 净值 ${a1.net_value}` : '未取到卡片')
  }

  // 反折旧（应删除凭证并回退资产）
  {
    const rev = (await api('POST', '/api/asset/depr/reverse', { year: Y, month: M })).data
    assert('反折旧删除该期折旧凭证', rev.deletedVoucherNos?.length === 1 && rev.assetCount === 3, `删除 ${rev.deletedVoucherNos?.join(',')}`)
    const gone = await api('GET', `/api/voucher/vouchers/${vid}`).then(() => true).catch(() => false)
    assert('反折旧后凭证已不存在', gone === false)
    const list = (await api('GET', '/api/asset/cards?page_size=100')).data.list
    const a1 = list.find(x => x.asset_no === 'ZCTEST001')
    assert('反折旧回退资产累计折旧', a1 && Math.abs(a1.accum_depr - 0) < 0.01 && Math.abs(a1.net_value - 12000) < 0.01,
      a1 ? `累计折旧 ${a1.accum_depr}, 净值 ${a1.net_value}` : '未取到卡片')
  }

  // 再计提 + 记账过账
  const exec2 = (await api('POST', '/api/asset/depr/execute', { year: Y, month: M, generate_voucher: true, accum_account: '1602' })).data
  const vid2 = exec2.voucher?.voucherId
  assert('再次计提生成凭证', !!vid2, `voucherNo=${exec2.voucher?.voucherNo}`)
  await api('POST', `/api/voucher/vouchers/${vid2}/post`, {})
  {
    const v = (await api('GET', `/api/voucher/vouchers/${vid2}`)).data
    assert('折旧凭证记账成功', v.status === 'posted', `status=${v.status}`)
  }

  // 过账后总账（仅已记账）
  {
    const rows = (await api('GET', `/api/ledger/general?account_code=1602&start_date=${Y}-09-01&end_date=${Y}-09-30`)).data
    const r = rows.find(x => x.account_code === '1602')
    assert('过账后总账 1602 贷方发生额=折旧合计', r && Math.abs(r.current_credit - expectedTotal) < 0.01, r ? `贷方 ${r.current_credit}, 期末 ${r.end_balance}` : '未取到行')
  }

  // 过账后试算平衡 + account_balances
  {
    const db = new Database(TEMP_DB, { readonly: true })
    const tb = db.prepare(`
      SELECT ROUND(SUM(ve.amount_cents)/100.0,2) d
      FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
      WHERE v.account_set_id=? AND v.status='posted' AND ve.direction='debit'`).get(asid)
    const tc = db.prepare(`
      SELECT ROUND(SUM(ve.amount_cents)/100.0,2) c
      FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id
      WHERE v.account_set_id=? AND v.status='posted' AND ve.direction='credit'`).get(asid)
    assert('过账凭证借贷合计相等（试算平衡）', Math.abs(tb.d - tc.c) < 0.01, `借 ${tb.d} / 贷 ${tc.c}`)
    const ab = db.prepare(`
      SELECT a.code, ab.current_debit, ab.current_credit, ab.end_balance
      FROM account_balances ab JOIN accounts a ON a.id=ab.account_id
      WHERE ab.account_set_id=? AND ab.year=? AND ab.period=? AND a.code IN ('1602','5101')
      ORDER BY a.code`).all(asid, Y, M)
    const ab1602 = ab.find(x => x.code === '1602')
    const ab5101 = ab.find(x => x.code === '5101')
    assert('account_balances 随过账更新（1602贷=5101借=折旧合计）',
      ab1602 && ab5101 && Math.abs(ab1602.current_credit - expectedTotal) < 0.01 && Math.abs(ab5101.current_debit - expectedTotal) < 0.01,
      JSON.stringify(ab))
    db.close()
  }

  // 购置凭证联动（可选）
  {
    const db = new Database(TEMP_DB, { readonly: true })
    const credit = db.prepare("SELECT code,name FROM accounts WHERE account_set_id=? AND is_enabled=1 AND code IN ('1001','1002') ORDER BY code LIMIT 1").get(asid)
    db.close()
    if (credit) {
      const r = (await api('POST', '/api/asset/cards', { ...cards[0], asset_no: 'ZCTEST004', asset_name: '测试购入资产', generate_voucher: true, credit_account: credit.code, acquire_date: '2026-09-05' })).data
      assert('新增资产时生成购置凭证', !!r.voucher?.voucherId, `借 160103 / 贷 ${credit.code}（${credit.name}）金额 12000`)
    } else {
      ok('购置凭证联动（跳过）', '账套无 1001/1002 科目')
    }
  }

  console.log('\n===== 汇总 =====')
  const passed = results.filter(r => r.pass).length
  console.log(`${passed}/${results.length} 项断言通过`)
  return { accountSet: asid, year: Y, month: M, expectedTotal, results }
}

main()
  .then(data => {
    writeFileSync(join(WORK, 'result.json'), JSON.stringify(data, null, 2))
    process.exitCode = data.results.some(r => !r.pass) ? 1 : 0
  })
  .catch(err => { console.error('TEST ERROR:', err); process.exitCode = 1 })
  .finally(() => { try { child?.kill() } catch { /* */ } setTimeout(() => process.exit(process.exitCode || 0), 800) })

/**
 * 进销存凭证设置 / 辅助核算严格对应 冒烟（隔离库副本 + 3197 端口独立后端，不动开发库）
 *
 *   node scratch/scmVoucherAuxSmoke.mjs
 *
 * 「测试」账套：1122 挂「客户」(CAT001)、2202 挂「供应商」(CAT002) 辅助核算。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-scm-aux-smoke')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3197
const BASE = `http://127.0.0.1:${PORT}`
const TEST_SET = '1409b0d2-7e8c-4e27-ab5f-5e143be3e89d'   // ZT001 测试
const CAT_CUS = '1301f828-d209-4f1e-9db3-f84d81e9b874'     // CAT001 客户
const CAT_SUP = '53855eb6-06b6-4027-9cfa-80ee9b591c09'     // CAT002 供应商
const D = '2026-09-10'

let step = 0; let failed = 0
function assert(name, cond, detail) {
  step++
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${step}. ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
function dbq(sql, ...ps) { const db = new Database(TEMP_DB, { readonly: true }); try { return db.prepare(sql).all(...ps) } finally { db.close() } }

async function prepDb() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true })
  await src.backup(TEMP_DB)
  src.close()
}

let child; let log = ''
async function startServer() {
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => { log += d.toString() })
  child.stderr.on('data', d => { log += d.toString() })
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    try { const r = await fetch(`${BASE}/api/auth/account-sets`); if (r.ok) return } catch { /* not up */ }
    await sleep(700)
  }
  console.log(log.slice(-3000))
  throw new Error('server did not come up')
}

let token = ''
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await r.text()
  let json; try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  return { status: r.status, ...json }
}
const get = p => api('GET', p)
const post = (p, b) => api('POST', p, b ?? {})
const put = (p, b) => api('PUT', p, b)

async function newDoc(doc) {
  const r = await post('/api/scm/docs', doc)
  if (r.code !== 0) throw new Error('建单失败 ' + r.message)
  const a = await post(`/api/scm/docs/${r.data.id}/audit`, { apply_item_default_warehouses: true })
  if (a.code !== 0) throw new Error('审核失败 ' + a.message)
  return r.data
}
const entries = vid => dbq('SELECT account_code, direction, amount, supplier_id, supplier_name, aux_data FROM voucher_entries WHERE voucher_id=? ORDER BY seq', vid)

async function main() {
  await prepDb()
  await startServer()
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: TEST_SET }),
  }).then(x => x.json())
  token = lr.token
  assert('登录测试账套', !!token)

  // ── 设置页 ──
  let s = (await get('/api/scm/voucher-setting')).data
  const catCus = s.categories.find(c => c.id === CAT_CUS)
  const catSup = s.categories.find(c => c.id === CAT_SUP)
  assert('设置页识别 1122→客户、2202→供应商，来源默认往来单位',
    catCus?.used_by.includes('1122') && catSup?.used_by.includes('2202') && catCus.source === 'partner' && catSup.source === 'partner',
    JSON.stringify({ catCus, catSup }))
  assert('默认匹配规则 = 名称完全一致', s.match_mode === 'name')

  const bad = await put('/api/scm/voucher-setting', { accounts: { 'scm:acc_revenue': '6001' } })
  assert('保存对方科目校验末级（6001 有下级被拒）', bad.status === 400, bad.message)
  const sv = await put('/api/scm/voucher-setting', { accounts: { 'scm:acc_revenue': '6001001', 'scm:acc_cost': '6401' }, match_mode: 'name' })
  assert('保存对方科目 + 匹配规则', sv.code === 0, sv.message)
  s = (await get('/api/scm/voucher-setting')).data
  assert('科目已保存到参数', s.accounts.find(a => a.param_key === 'scm:acc_revenue').value === '6001001')

  const legacy = await put('/api/scm/params', { params: [{ param_key: 'scm:acc_revenue', param_value: '' }] })
  s = (await get('/api/scm/voucher-setting')).data
  assert('系统参数页旧接口不再覆盖对方科目', legacy.code === 0 && s.accounts.find(a => a.param_key === 'scm:acc_revenue').value === '6001001')

  // ── 主数据（先取单据类型触发种子化） ──
  await get('/api/scm/docs/types')
  await post('/api/scm/warehouses', { code: 'AW1', name: '辅助测试仓' })
  await post('/api/scm/items', { code: 'AX1', name: '辅助测试物料', unit: '个', purchase_price: 100, sale_price: 150, default_warehouse_code: 'AW1', inv_account: '1406' })
  await post('/api/scm/partners', { code: 'ASUP1', name: '全新供应商甲', partner_type: 'supplier' })
  await post('/api/scm/partners', { code: 'ACUS1', name: '惠州市德赛电池科技', partner_type: 'customer' })      // 与辅助项「…有限公司」近似
  await post('/api/scm/partners', { code: 'ACUS2', name: '惠州市致远复杂新料科技有限公司', partner_type: 'customer' }) // 名称完全一致

  // ── 预览 ──
  const pv = (await get('/api/scm/voucher-setting/aux-preview?source_type=partner')).data
  const row = code => pv.rows.find(r => r.source_code === code)
  assert('预览：名称完全一致 → 已对应', row('ACUS2')?.status === 'matched' && row('ACUS2').how === 'name', JSON.stringify(row('ACUS2')))
  assert('预览：名称略有差异 → 有近似建议、不自动采用', row('ACUS1')?.status === 'suggested' && row('ACUS1').suggestions[0]?.name === '惠州市德赛电池科技有限公司', JSON.stringify(row('ACUS1')?.suggestions))
  assert('预览：全新单位 → 未匹配', row('ASUP1')?.status === 'unmatched')

  // ── 采购入库 → 生成凭证被拦截 → 自动新建 → 重试 ──
  const pi = await newDoc({ doc_type: 'PI', doc_date: D, partner_code: 'ASUP1', warehouse_code: 'AW1', lines: [{ item_code: 'AX1', qty: 10, price: 100, tax_rate: 13, tax_amount: 130 }] })
  let g = await post(`/api/scm/docs/${pi.id}/gen-voucher`)
  assert('全新供应商生成凭证被拦截 SCM_AUX_UNMATCHED', g.status === 400 && g.reason === 'SCM_AUX_UNMATCHED', g.message)
  assert('拦截提示指明单位与类别', /全新供应商甲/.test(g.message) && /供应商/.test(g.message))
  assert('拦截时不写凭证', dbq('SELECT voucher_id FROM scm_doc WHERE id=?', pi.id)[0].voucher_id == null)

  const bg = await post('/api/scm/docs/batch-actions', { action: 'gen_voucher', ids: [pi.id] })
  assert('批量生成同样拦截并透传 reason / data', bg.status === 400 && bg.reason === 'SCM_AUX_UNMATCHED' && bg.data?.items?.length === 1, bg.message)

  const cr = await post('/api/scm/voucher-setting/aux-create', { rows: [{ source_type: 'partner', source_code: 'ASUP1', category_id: CAT_SUP }] })
  assert('自动新建供应商辅助项', cr.data?.ok === 1, JSON.stringify(cr.data?.results))
  g = await post(`/api/scm/docs/${pi.id}/gen-voucher`)
  assert('新建后重新生成凭证成功', g.code === 0, g.message)
  const piAp = entries(g.data?.voucher_id).find(e => e.account_code === '2202')
  const supItem = dbq("SELECT id FROM aux_items WHERE type=? AND code='ASUP1'", CAT_SUP)[0]
  assert('2202 分录带上供应商辅助（aux_data.CAT002）', piAp && JSON.parse(piAp.aux_data || '{}').CAT002?.id === supItem?.id, JSON.stringify(piAp))
  const piInv = entries(g.data?.voucher_id).find(e => e.account_code === '1406')
  assert('存货科目没挂辅助 → 不填', piInv && piInv.aux_data == null)

  // ── 采纳近似建议 → 销售发货生成凭证 ──
  const so = await newDoc({ doc_type: 'SO', doc_date: D, partner_code: 'ACUS1', warehouse_code: 'AW1', lines: [{ item_code: 'AX1', qty: 2, price: 150, tax_rate: 13, tax_amount: 39 }] })
  g = await post(`/api/scm/docs/${so.id}/gen-voucher`)
  assert('近似但未确认 → 仍拦截，并带候选', g.status === 400 && g.data?.items?.[0]?.suggestions?.[0]?.code === '000002', JSON.stringify(g.data?.items?.[0]?.suggestions))
  const sugg = row('ACUS1').suggestions[0]
  const mp = await put('/api/scm/voucher-setting/aux-map', { items: [{ source_type: 'partner', source_code: 'ACUS1', category_id: CAT_CUS, aux_item_id: sugg.id, match_source: 'confirmed' }] })
  assert('采纳近似建议', mp.code === 0, mp.message)
  g = await post(`/api/scm/docs/${so.id}/gen-voucher`)
  assert('确认后销售发货生成凭证成功', g.code === 0, g.message)
  const soAr = entries(g.data?.voucher_id).find(e => e.account_code === '1122')
  assert('1122 分录带上客户辅助 = 采纳的项目', soAr && JSON.parse(soAr.aux_data || '{}').CAT001?.id === sugg.id, JSON.stringify(soAr))
  const soRev = entries(g.data?.voucher_id).find(e => e.account_code === '6001001')
  assert('收入记到设置页指定的 6001001', !!soRev)

  const pv2 = (await get('/api/scm/voucher-setting/aux-preview?source_type=partner&status=matched')).data
  const r1 = pv2.rows.find(r => r.source_code === 'ACUS1')
  assert('预览显示「已确认」', r1?.how === 'confirmed' && !!r1.map_id)
  const del = await api('DELETE', `/api/scm/voucher-setting/aux-map/${r1.map_id}`)
  const pv3 = (await get('/api/scm/voucher-setting/aux-preview?source_type=partner')).data
  assert('清除指定后恢复为近似建议', del.code === 0 && pv3.rows.find(r => r.source_code === 'ACUS1')?.status === 'suggested')

  // ── 按编号模式 ──
  await put('/api/scm/voucher-setting', { match_mode: 'code' })
  const pv4 = (await get('/api/scm/voucher-setting/aux-preview?source_type=partner')).data
  assert('切到「编号完全一致」后，名称一致但编号不同的 ACUS2 不再对应', pv4.rows.find(r => r.source_code === 'ACUS2')?.status !== 'matched')
  await put('/api/scm/voucher-setting', { match_mode: 'name' })

  // ── 来源设为不填 ──
  await put('/api/scm/voucher-setting', { source_map: { [CAT_CUS]: 'none' } })
  const so2 = await newDoc({ doc_type: 'SO', doc_date: D, partner_code: 'ACUS2', warehouse_code: 'AW1', lines: [{ item_code: 'AX1', qty: 1, price: 150, tax_rate: 13, tax_amount: 19.5 }] })
  g = await post(`/api/scm/docs/${so2.id}/gen-voucher`)
  assert('来源设为「不填」而 1122 要求客户辅助 → 拦截 no_source', g.status === 400 && g.data?.items?.[0]?.kind === 'no_source', g.message)
  await put('/api/scm/voucher-setting', { source_map: { [CAT_CUS]: 'partner' } })
  g = await post(`/api/scm/docs/${so2.id}/gen-voucher`)
  assert('恢复来源后名称完全一致直接出凭证', g.code === 0, g.message)

  // ── 一键自动预设：全部预设到最底层末级 ──
  const isLeaf = code => {
    const rows = dbq('SELECT id FROM accounts WHERE account_set_id=? AND code=?', TEST_SET, code)
    return rows.length === 1 && dbq('SELECT 1 FROM accounts WHERE account_set_id=? AND parent_id=?', TEST_SET, rows[0].id).length === 0
  }
  await post('/api/scm/items', { code: 'AX2', name: '无科目原料', unit: '个', item_type: '0', purchase_price: 10, default_warehouse_code: 'AW1' })
  await post('/api/scm/items', { code: 'AX3', name: '无科目成品', unit: '个', item_type: '9', purchase_price: 10, default_warehouse_code: 'AW1' })
  await put('/api/scm/voucher-setting', { accounts: { 'scm:acc_cost': '' } })   // 清空一个，验证未配置 → 末级
  const ps = (await get('/api/scm/voucher-setting/preset')).data
  const allProposals = [...ps.accounts, ...ps.items, ...ps.partners].filter(x => x.proposed)
  assert('预设建议全部为最底层末级科目', allProposals.length > 0 && allProposals.every(x => isLeaf(x.proposed)),
    allProposals.filter(x => !isLeaf(x.proposed)).map(x => x.proposed).join(',') || `${allProposals.length} 项`)
  assert('已配置且末级的收入科目 6001001 不在预设清单', !ps.accounts.some(a => a.param_key === 'scm:acc_revenue'))
  const costP = ps.accounts.find(a => a.param_key === 'scm:acc_cost')
  assert('清空的成本科目预设为末级', costP?.reason === '未配置' && isLeaf(costP.proposed), JSON.stringify(costP))
  const ax2 = ps.items.find(i => i.code === 'AX2'); const ax3 = ps.items.find(i => i.code === 'AX3')
  assert('原料物料存货科目预设到原材料末级', ax2 && isLeaf(ax2.proposed) && /原材料/.test(ax2.proposed_name), JSON.stringify(ax2))
  assert('成品物料存货科目预设到库存商品末级', ax3 && isLeaf(ax3.proposed) && /库存商品/.test(ax3.proposed_name), JSON.stringify(ax3))
  assert('已配末级存货科目的 AX1 不预设', !ps.items.some(i => i.code === 'AX1'))
  const supP = ps.partners.find(p => p.code === 'ASUP1')
  assert('供应商只预设应付科目', supP?.field === 'ap_account' && !ps.partners.some(p => p.code === 'ASUP1' && p.field === 'ar_account'), JSON.stringify(supP))
  assert('匹配规则 / 辅助来源恢复默认', ps.match_mode === 'name' && ps.source_map[CAT_CUS] === 'partner')

  const badSave = await put('/api/scm/voucher-setting', { item_accounts: [{ code: 'AX2', inv_account: '2221' }] })
  assert('保存时物料存货科目非末级被拒', badSave.status === 400, badSave.message)

  // 运行时：AX3 没配存货科目，生成凭证按类型取库存商品末级（不再写死 1405）
  const pi3 = await newDoc({ doc_type: 'PI', doc_date: D, partner_code: 'ASUP1', warehouse_code: 'AW1', lines: [{ item_code: 'AX3', qty: 1, price: 10, tax_rate: 13, tax_amount: 1.3 }] })
  g = await post(`/api/scm/docs/${pi3.id}/gen-voucher`)
  const pi3Inv = g.code === 0 ? entries(g.data.voucher_id).find(e => e.direction === 'debit' && !/^2221/.test(e.account_code)) : null
  assert('未配存货科目的物料生成凭证记到库存商品末级', !!pi3Inv && isLeaf(pi3Inv.account_code) && pi3Inv.account_code !== '1405', g.message || JSON.stringify(pi3Inv))

  const accMap = Object.fromEntries(ps.accounts.filter(a => a.proposed).map(a => [a.param_key, a.proposed]))
  const partnerAcc = {}
  for (const p of ps.partners.filter(x => x.proposed)) (partnerAcc[p.code] ||= { code: p.code })[p.field] = p.proposed
  const saved = await put('/api/scm/voucher-setting', {
    accounts: accMap, match_mode: ps.match_mode, source_map: ps.source_map,
    item_accounts: ps.items.filter(i => i.proposed).map(i => ({ code: i.code, inv_account: i.proposed })),
    partner_accounts: Object.values(partnerAcc),
  })
  assert('保存预设（含物料 / 往来科目）', saved.code === 0 && saved.data.items >= 2, JSON.stringify(saved.data))
  const ax2Now = dbq("SELECT inv_account FROM scm_item WHERE account_set_id=? AND code='AX2'", TEST_SET)[0]?.inv_account
  const sup1Now = dbq("SELECT ap_account FROM scm_partner WHERE account_set_id=? AND code='ASUP1'", TEST_SET)[0]?.ap_account
  assert('物料 / 往来单位科目已写入且为末级', isLeaf(ax2Now) && isLeaf(sup1Now), `${ax2Now} / ${sup1Now}`)
  const ps2 = (await get('/api/scm/voucher-setting/preset')).data
  assert('保存后再次预设：对方科目 / 物料 / 往来全部无需预设', !ps2.accounts.some(a => a.proposed) && !ps2.items.length && !ps2.partners.length,
    JSON.stringify({ a: ps2.accounts.length, i: ps2.items.length, p: ps2.partners.length }))

  console.log(`\n共 ${step} 项，失败 ${failed} 项`)
}

main()
  .catch(e => { console.error(e); failed++ })
  .finally(() => { child?.kill(); process.exitCode = failed ? 1 : 0 })

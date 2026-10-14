/**
 * 业务凭证中心冒烟（隔离库副本 + 3196 端口独立后端，不动开发库）
 *
 *   node scratch/bizVoucherCenterSmoke.mjs
 *
 * 用「进销存凭证测试」账套（ZT004，scratch/seedScmVoucherTestSet.mjs 建的 18 张已审核单据）。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-biz-voucher-smoke')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3196
const BASE = `http://127.0.0.1:${PORT}`
const SET_NAME = '进销存凭证测试'

let step = 0; let failed = 0
function assert(name, cond, detail) {
  step++; if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${step}. ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
function dbq(sql, ...ps) { const db = new Database(TEMP_DB, { readonly: true }); try { return db.prepare(sql).all(...ps) } finally { db.close() } }
function dbw(sql, ...ps) { const db = new Database(TEMP_DB); try { return db.prepare(sql).run(...ps) } finally { db.close() } }

let child; let log = ''
async function start() {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true }); await src.backup(TEMP_DB); src.close()
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'), env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', d => { log += d }); child.stderr.on('data', d => { log += d })
  for (let t0 = Date.now(); Date.now() - t0 < 90000; await sleep(700)) {
    try { if ((await fetch(`${BASE}/api/auth/account-sets`)).ok) return } catch { /* not up */ }
  }
  console.log(log.slice(-3000)); throw new Error('server did not come up')
}

let token = ''
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) })
  const txt = await r.text(); let json; try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  return { status: r.status, ...json }
}
const get = p => api('GET', p); const post = (p, b) => api('POST', p, b ?? {})

async function main() {
  await start()
  const sets = (await fetch(`${BASE}/api/auth/account-sets`).then(x => x.json())).data
  const set = sets.find(s => s.name === SET_NAME)
  if (!set) throw new Error(`副本里没有账套「${SET_NAME}」，先运行 scratch/seedScmVoucherTestSet.mjs`)
  token = (await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: set.id }) }).then(x => x.json())).token
  assert('登录 ZT004', !!token)

  // ── 汇总 ──
  const s0 = (await get('/api/biz-voucher/summary')).data
  assert('汇总：进销存待生成 17（调拨单不计）', s0.scm?.pending === 17 && s0.scm.generated === 0, JSON.stringify(s0.scm))
  assert('汇总：出纳待生成 3（收付款审核写入的流水）', s0.cashier?.pending === 3, JSON.stringify(s0.cashier))
  assert('汇总：固定资产无数据', s0.asset && s0.asset.pending === 0 && s0.asset.generated === 0, JSON.stringify(s0.asset))
  const sRange = (await get('/api/biz-voucher/summary?start_date=2026-09-01&end_date=2026-09-30')).data
  assert('汇总按期间过滤（9 月无业务）', sRange.scm.pending === 0 && sRange.cashier.pending === 0)

  // ── 列表 ──
  const l0 = (await get('/api/biz-voucher/scm-docs?status=pending&page_size=100')).data
  assert('进销存待生成列表 17 张，不含调拨单', l0.total === 17 && !l0.list.some(d => d.doc_type === 'TR'))
  assert('列表带单据类型名与往来单位名', l0.list.some(d => d.doc_type_name === '采购入库' && d.partner_name === '东莞精密材料有限公司'))
  const kw = (await get(`/api/biz-voucher/scm-docs?status=all&keyword=${encodeURIComponent('佛山')}`)).data
  assert('关键字按往来单位名搜索', kw.total === 2, `${kw.total}`)

  // ── 批量生成：逐张独立 ──
  const ids = l0.list.map(d => d.id)
  const g = (await post('/api/biz-voucher/scm/generate', { ids })).data
  const byNo = Object.fromEntries(g.results.map(r => [r.doc_no, r]))
  assert('17 张逐张生成：成功 11、失败 6（一张失败不影响其他）', g.ok === 11 && g.failed === 6, `ok=${g.ok} failed=${g.failed}`)
  const auxFails = ['202610-PI-003', '202610-PI-004', '202610-SO-002', '202610-SO-003', '202610-SO-004', '202610-RCV-002']
  assert('失败的正是辅助核算对应不上的 6 张', auxFails.every(no => byNo[no] && !byNo[no].ok && byNo[no].reason === 'SCM_AUX_UNMATCHED'),
    auxFails.map(no => `${no}:${byNo[no]?.reason || byNo[no]?.message}`).join(' '))
  assert('未填部门的销售单提示单据未填部门', /未填部门/.test(byNo['202610-SO-004']?.message || ''), byNo['202610-SO-004']?.message)
  const s1 = (await get('/api/biz-voucher/summary')).data
  assert('生成后汇总：待生成 6 / 已生成 11', s1.scm.pending === 6 && s1.scm.generated === 11, JSON.stringify(s1.scm))
  const genList = (await get('/api/biz-voucher/scm-docs?status=generated&page_size=100')).data.list
  assert('已生成列表带凭证号与凭证状态（未审核）', genList.length === 11 && genList.every(d => d.voucher_no && d.voucher_status === 'draft'))

  // 自动新建辅助项后重试失败的单据
  const items = []
  for (const r of g.results.filter(r => r.reason === 'SCM_AUX_UNMATCHED')) for (const p of r.data.items) if (p.kind === 'unmatched') items.push(p)
  const create = (await post('/api/scm/voucher-setting/aux-create', { rows: items.map(p => ({ source_type: p.sourceType, source_code: p.sourceCode, category_id: p.categoryId })) })).data
  const retry = (await post('/api/biz-voucher/scm/generate', { ids: g.results.filter(r => !r.ok).map(r => r.id) })).data
  assert('自动新建后重试：仅剩未填部门的 1 张失败', retry.ok === 5 && retry.failed === 1 && retry.results.find(r => !r.ok)?.doc_no === '202610-SO-004',
    `新建 ${create.ok}，重试 ok=${retry.ok} failed=${retry.failed}`)

  // ── 删除 ──
  const pi1 = genList.find(d => d.doc_no === '202610-PI-001')
  const del = (await post('/api/biz-voucher/scm/delete', { ids: [pi1.id] })).data
  assert('删除 PI-001 的凭证，返回受影响期间', del.ok === 1 && del.affectedGroups.length === 1, JSON.stringify(del.results))
  assert('凭证已删除，单据恢复待生成', dbq('SELECT COUNT(*) c FROM vouchers WHERE id=?', pi1.voucher_id)[0].c === 0 && dbq('SELECT voucher_id FROM scm_doc WHERE id=?', pi1.id)[0].voucher_id === null)
  const so1 = genList.find(d => d.doc_no === '202610-SO-001')
  dbw("UPDATE vouchers SET status='posted' WHERE id=?", so1.voucher_id)
  const delPosted = (await post('/api/biz-voucher/scm/delete', { ids: [so1.id] })).data
  assert('已记账凭证不能删除', delPosted.failed === 1 && /已记账/.test(delPosted.results[0].message), delPosted.results[0].message)
  const regen = (await post('/api/biz-voucher/scm/generate', { ids: [pi1.id] })).data
  assert('删除后可重新生成', regen.ok === 1, JSON.stringify(regen.results[0]))
  const bad = await post('/api/biz-voucher/scm/generate', { ids: [] })
  assert('空选择被拒', bad.status === 400)

  // ── 出纳（中心前端按账户分组调用出纳接口）──
  const cj = (await get('/api/cashier/journal/search?voucher_status=none&currency=ALL&page_size=100')).data
  assert('出纳待生成流水 3 条', cj.total === 3, `${cj.total}`)
  const groups = new Map()
  for (const r of cj.list) groups.set(r.account_code, [...(groups.get(r.account_code) || []), r.id])
  let made = 0
  for (const [account_code, gIds] of groups) {
    const r = await post('/api/cashier/generate-voucher', { account_code, ids: gIds })
    if (r.code === 0) made += r.data.syncedCount
  }
  assert('出纳按账户分组生成凭证 3 张', made === 3, `${made}`)
  const s2 = (await get('/api/biz-voucher/summary')).data
  assert('出纳汇总：待生成 0 / 已生成 3', s2.cashier.pending === 0 && s2.cashier.generated === 3, JSON.stringify(s2.cashier))
  const cjGen = (await get('/api/cashier/journal/search?voucher_status=draft,audited,posted&currency=ALL&page_size=100')).data.list
  const firstAcc = cjGen[0].account_code
  const cdel = await post('/api/cashier/delete-vouchers', { account_code: firstAcc, ids: cjGen.filter(r => r.account_code === firstAcc).map(r => r.id) })
  assert('出纳按账户删除凭证', cdel.code === 0 && cdel.data.deleted >= 1, JSON.stringify(cdel.data))

  console.log(`\n共 ${step} 项，失败 ${failed} 项`)
}

main().catch(e => { console.error(e); failed++ }).finally(() => { child?.kill(); process.exitCode = failed ? 1 : 0 })

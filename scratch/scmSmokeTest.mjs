/**
 * 进销存（SCM）回归冒烟脚本 —— 评审计划「阶段 0-2」
 *
 * 在独立数据库副本 + 独立端口上起真实服务，用 HTTP 走完整链路并断言：
 *   ① 采购入库（含税 + 整单折扣）→ 库存金额 / 往来
 *   ② 采购入库 → 下推采购发票（金额不一致）→ 反审核发票 → 来源单往来还原          [P0-1 / FIX-203]
 *   ③ 销售发货 → 销售退货 → 往来余额 = 发货 − 退货                                  [P0-2 / FIX-204]
 *   ④ 序列号物料：入库 → 调拨 → 反审核调拨 → 档案保留 / 可重新审核                  [P0-3 / FIX-205]
 *   ⑤ 序列号物料：组装消耗 → 该序列号不能再销售出库；反审核组装恢复                  [P0-4 / FIX-206]
 *   ⑥ 批次物料：组装消耗批次                                                        [P0-4 / FIX-206]
 *   ⑦ 折扣是否进入库存成本（P1-1，当前记录现状）
 *
 * 运行：node scratch/scmSmokeTest.mjs
 */
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-scm-smoke')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3198
const BASE = `http://127.0.0.1:${PORT}`
const TEST_SET = '1409b0d2-7e8c-4e27-ab5f-5e143be3e89d'   // ZT001 测试
const D = '2026-09-10'
const results = []
let step = 0
function ok(name, detail) { step++; results.push({ n: step, name, pass: true, detail }); console.log(`PASS ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function bad(name, detail) { step++; results.push({ n: step, name, pass: false, detail }); console.log(`FAIL ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
function assert(name, cond, detail) { (cond ? ok : bad)(name, detail) }
/** 已知缺陷（评审已登记、排在后续阶段修复）：不通过时记 KNOWN 而不是 FAIL，转绿后提示可升级为 assert */
function known(name, cond, detail) { step++; results.push({ n: step, name, pass: true, known: !cond, detail }); console.log(`${cond ? 'PASS(已修复，可改为 assert)' : 'KNOWN'} ${step}. ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const r2 = n => Math.round((Number(n) || 0) * 100) / 100

function prepDb() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true })
  return src.backup(TEMP_DB).then(() => src.close())
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
async function api(method, path, body, { allowError = false } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await r.text()
  let json
  try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  if (!r.ok && !allowError) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 300)}`)
  return { status: r.status, ...json }
}
const post = (p, b, o) => api('POST', p, b, o)
const get = p => api('GET', p)

// ── 业务辅助 ───────────────────────────────────────────────
async function ensure(path, body) {
  const r = await post(path, body, { allowError: true })
  if (r.status !== 200 && !/已存在/.test(r.message || '')) throw new Error(`${path} ${r.status} ${r.message}`)
}
async function createDoc(doc) {
  const r = await post('/api/scm/docs', doc)
  return r.data   // { id, doc_no }
}
async function audit(id, extra = {}) { return post(`/api/scm/docs/${id}/audit`, { apply_item_default_warehouses: true, ...extra }, { allowError: true }) }
async function unaudit(id) { return post(`/api/scm/docs/${id}/unaudit`, {}, { allowError: true }) }
async function ledger(partner) { return (await get(`/api/scm/arap/${partner}`)).data }
async function serial(sn) { return (await get(`/api/scm/serials?serial_no=${encodeURIComponent(sn)}`)).data.find(s => s.serial_no === sn) }
async function stock(wh, item) {
  const list = (await get(`/api/scm/stock?warehouse_code=${wh}&keyword=${item}`)).data
  const rows = Array.isArray(list) ? list : (list.list || [])
  return rows.find(r => r.item_code === item && r.warehouse_code === wh) || { qty: 0, amount: 0, avg_cost: 0 }
}
function dbq(sql, ...ps) { const db = new Database(TEMP_DB, { readonly: true }); try { return db.prepare(sql).all(...ps) } finally { db.close() } }

async function main() {
  await prepDb()
  await startServer()

  // 登录
  {
    const lr = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: TEST_SET }),
    }).then(x => x.json())
    token = lr.token
    assert('admin 登录测试账套', !!token)
  }

  // 主数据
  const types = (await get('/api/scm/docs/types')).data
  assert('单据类型已种子化', types.some(t => t.code === 'PI') && types.some(t => t.code === 'AS'), `${types.length} 种`)
  for (const [code, name] of [['W1', '主仓'], ['W2', '分仓']]) await ensure('/api/scm/warehouses', { code, name })
  await ensure('/api/scm/partners', { code: 'SUP1', name: '供应商甲', partner_type: 'supplier', ar_account: '1122', ap_account: '2202' })
  await ensure('/api/scm/partners', { code: 'CUS1', name: '客户乙', partner_type: 'customer', ar_account: '1122', ap_account: '2202' })
  await ensure('/api/scm/items', { code: 'M1', name: '普通物料', unit: '个', purchase_price: 100, sale_price: 150, default_warehouse_code: 'W1' })
  await ensure('/api/scm/items', { code: 'SN1', name: '序列号物料', unit: '台', serial_flag: 1, purchase_price: 500, default_warehouse_code: 'W1' })
  await ensure('/api/scm/items', { code: 'BT1', name: '批次物料', unit: '箱', batch_flag: 1, purchase_price: 20, default_warehouse_code: 'W1' })
  await ensure('/api/scm/items', { code: 'FP1', name: '组装成品', unit: '套', serial_flag: 1, default_warehouse_code: 'W1' })
  ok('主数据就绪', '2 仓 / 2 往来 / 4 物料')

  // ── ① 采购入库：含税 + 整单折扣 ─────────────────────────
  {
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', discount_rate: 9.5,
      lines: [{ item_code: 'M1', qty: 10, price: 100, tax_rate: 13, tax_amount: 123.5 }, { item_code: 'M1', qty: 10, price: 100, tax_rate: 13, tax_amount: 123.5 }] })
    const r = await audit(pi.id)
    assert('① PI 含税+整单折扣 审核通过', r.code === 0, r.message)
    const lines = dbq('SELECT amount, tax_amount, unit_cost FROM scm_doc_line WHERE doc_id=? ORDER BY seq', pi.id)
    const sumAmt = r2(lines.reduce((s, l) => s + l.amount, 0))
    assert('① 整单折扣已分摊到行：Σ行金额 = 1900', sumAmt === 1900, `Σ=${sumAmt}`)
    const lg = await ledger('SUP1')
    // 整单折扣同时缩放税额：(2000 + 247) × 0.95 = 2134.65
    assert('① 应付挂账 = 折后价税合计 2134.65', Math.abs(r2(lg.closing) - 2134.65) < 0.02, `closing=${lg.closing}`)
    const st = await stock('W1', 'M1')
    // P1-1：入库成本取行单价（折前 100）还是折后（95）？当前实现取折前 → 库存金额 2000 ≠ 存货 1900
    assert('⑦ [FIX-207] 库存金额 == 折后行金额 1900（折扣进成本）', r2(st.amount) === 1900, `库存金额=${st.amount} 均价=${st.avg_cost}（≠1900 即折扣未进成本）`)
  }

  // ── ② 下推发票 → 反审核 → 来源单还原（FIX-203）──────────
  {
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 10, price: 100, tax_rate: 13, tax_amount: 130 }] })
    await audit(pi.id)
    const before = r2((await ledger('SUP1')).closing)
    const piLine = dbq('SELECT id FROM scm_doc_line WHERE doc_id=?', pi.id)[0]
    const rp = await createDoc({ doc_type: 'RP', doc_date: D, partner_code: 'SUP1', source_doc_id: pi.id,
      lines: [{ item_code: 'M1', qty: 10, price: 80, tax_rate: 13, tax_amount: 104, source_line_id: piLine.id }] })
    const ra = await audit(rp.id)
    assert('② 下推采购发票（904）审核通过', ra.code === 0, ra.message)
    const mid = r2((await ledger('SUP1')).closing)
    assert('② 发票审核后来源单暂估额校正为发票额（余额 −226）', r2(before - mid) === 226, `before=${before} after=${mid}`)
    const ru = await unaudit(rp.id)
    assert('② 发票反审核通过', ru.code === 0, ru.message)
    const after = r2((await ledger('SUP1')).closing)
    assert('② [FIX-203] 反审核后来源单暂估额回到 1130，余额还原', after === before, `before=${before} after=${after}`)
    const piLog = dbq("SELECT amount, remark FROM scm_ar_ap_log WHERE doc_no=(SELECT doc_no FROM scm_doc WHERE id=?)", pi.id)[0]
    assert('② 来源单台账仍在且金额 = 1130', piLog && r2(piLog.amount) === 1130, JSON.stringify(piLog))
  }

  // ── ③ 销售发货 → 销售退货（FIX-204）────────────────────
  {
    const so = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 10, price: 1000, tax_rate: 13, tax_amount: 1300 }] })
    const ra = await audit(so.id)
    assert('③ 销售发货 11300 审核通过', ra.code === 0, ra.message)
    const sr = await createDoc({ doc_type: 'SR', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 2, price: 1000, tax_rate: 13, tax_amount: 260 }] })
    const rs = await audit(sr.id)
    assert('③ 销售退货 2260 审核通过', rs.code === 0, rs.message)
    const lg = await ledger('CUS1')
    assert('③ [FIX-204] 往来余额 = 11300 − 2260 = 9040', r2(lg.closing) === 9040, `closing=${lg.closing}`)
    const srRow = lg.detail.find(d => d.doc_type === 'SR')
    assert('③ 退货行归「调整」列、不计入收款', srRow && srRow.adjustment_amount === 2260 && srRow.settlement_amount === 0, JSON.stringify(srRow && { a: srRow.adjustment_amount, s: srRow.settlement_amount }))
    const aging = (await get('/api/scm/arap-aging?as_of=2026-09-30')).data.find(a => a.partner_code === 'CUS1')
    assert('③ 账龄表余额同步 9040', aging && r2(aging.balance) === 9040, JSON.stringify(aging))
    const credit = (await get('/api/scm/partners/CUS1/credit')).data
    assert('③ 信用占用 = 9040', r2(credit.used_ar) === 9040, JSON.stringify(credit))
    const ru = await unaudit(sr.id)
    assert('③ 退货反审核后余额回到 11300', ru.code === 0 && r2((await ledger('CUS1')).closing) === 11300, ru.message)
  }

  // ── ④ 序列号：入库 → 调拨 → 反审核调拨（FIX-205）────────
  {
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1',
      lines: [{ item_code: 'SN1', qty: 2, price: 500, serial_nos: ['S-001', 'S-002'] }] })
    const ra = await audit(pi.id)
    assert('④ 序列号入库 S-001/S-002', ra.code === 0, ra.message)
    const tr = await createDoc({ doc_type: 'TR', doc_date: D, warehouse_code: 'W1',
      lines: [{ item_code: 'SN1', qty: 1, warehouse_code: 'W2', serial_nos: ['S-001'] }] })
    const rt = await audit(tr.id)
    assert('④ 调拨 S-001 W1→W2 审核通过', rt.code === 0, rt.message)
    assert('④ 调拨后 S-001 在 W2', (await serial('S-001'))?.warehouse_code === 'W2')
    const ru = await unaudit(tr.id)
    assert('④ 调拨反审核通过', ru.code === 0, ru.message)
    const s = await serial('S-001')
    assert('④ [FIX-205] 反审核后档案保留、回到 W1、入库单号仍为 PI', s && s.status === 'in_stock' && s.warehouse_code === 'W1' && s.in_doc_no === pi.doc_no, JSON.stringify(s))
    const rt2 = await audit(tr.id)
    assert('④ [FIX-205] 调拨可重新审核', rt2.code === 0 && (await serial('S-001'))?.warehouse_code === 'W2', rt2.message)
  }

  // ── ⑤ 序列号：组装消耗 → 不能再出库（FIX-206）──────────
  {
    const as = await createDoc({ doc_type: 'AS', doc_date: D, warehouse_code: 'W1',
      lines: [
        { item_code: 'FP1', qty: 1, line_role: 'product', product_group: 1, warehouse_code: 'W1', serial_nos: ['FP-001'] },
        { item_code: 'SN1', qty: 1, product_group: 1, warehouse_code: 'W1', serial_nos: ['S-002'] },
        { item_code: 'M1', qty: 2, product_group: 1, warehouse_code: 'W1' },
      ] })
    const ra = await audit(as.id)
    assert('⑤ 组装单（成品行模式）审核通过', ra.code === 0, ra.message)
    const s2 = await serial('S-002'); const fp = await serial('FP-001')
    assert('⑤ [FIX-206] 子件 S-002 已核销（out）、成品 FP-001 登记在库', s2?.status === 'out' && fp?.status === 'in_stock', JSON.stringify({ s2: s2?.status, fp: fp?.status }))
    // 再补一台在库（S-003），使库存数量足够、只有序列号台账能拦住 S-002
    const pi2 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1',
      lines: [{ item_code: 'SN1', qty: 1, price: 500, serial_nos: ['S-003'] }] })
    await audit(pi2.id)
    const so = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1',
      lines: [{ item_code: 'SN1', qty: 1, price: 800, serial_nos: ['S-002'] }] })
    const rs = await audit(so.id)
    assert('⑤ [FIX-206] 被组装消耗的 S-002 不能再销售出库', rs.code !== 0 && /不在库|无法出库/.test(rs.message || ''), rs.message)
    const ru = await unaudit(as.id)
    assert('⑤ 组装反审核：S-002 恢复在库、FP-001 撤销建档', ru.code === 0 && (await serial('S-002'))?.status === 'in_stock' && !(await serial('FP-001')), ru.message)
  }

  // ── ⑥ 批次：组装消耗批次（FIX-206）─────────────────────
  {
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1',
      lines: [{ item_code: 'BT1', qty: 10, price: 20, batch_no: 'B-2026-01' }] })
    await audit(pi.id)
    const as = await createDoc({ doc_type: 'AS', doc_date: D, warehouse_code: 'W1',
      lines: [
        { item_code: 'M1', qty: 1, line_role: 'product', product_group: 1, warehouse_code: 'W1' },
        { item_code: 'BT1', qty: 4, product_group: 1, warehouse_code: 'W1' },
      ] })
    const ra = await audit(as.id)
    assert('⑥ 组装消耗批次物料 审核通过', ra.code === 0, ra.message)
    const b = dbq("SELECT qty FROM scm_stock_batch WHERE account_set_id=? AND item_code='BT1' AND batch_no='B-2026-01'", TEST_SET)[0]
    assert('⑥ [FIX-206] 批次 B-2026-01 余量 10 − 4 = 6', b && Number(b.qty) === 6, JSON.stringify(b))
  }

  // ── 阶段 B ──────────────────────────────────────────────
  // ⑧ 手工销售退货按库存均价入库（FIX-208）
  {
    const before = await stock('W1', 'M1')
    const sr = await createDoc({ doc_type: 'SR', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 2, price: 1000, tax_rate: 13, tax_amount: 260 }] })
    const rs = await audit(sr.id)
    assert('⑧ 手工销售退货审核通过', rs.code === 0, rs.message)
    const after = await stock('W1', 'M1')
    const line = dbq('SELECT unit_cost FROM scm_doc_line WHERE doc_id=?', sr.id)[0]
    assert('⑧ [FIX-208] 退货按库存均价入库（不是售价 1000）', Math.abs(r2(after.amount - before.amount) - r2(before.avg_cost * 2)) < 0.02 && r2(line.unit_cost) === r2(before.avg_cost),
      `均价=${before.avg_cost} 金额增量=${r2(after.amount - before.amount)} 行成本=${line.unit_cost}`)
    await unaudit(sr.id)
  }

  // ⑨ 工单：重复成品拒绝、已审核工单不可直删（FIX-209/210）
  {
    const dup = await post('/api/scm/production-plans', { code: 'MO-DUP', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1',
      products: [{ item_code: 'FP1', plan_qty: 1, lines: [{ item_code: 'M1', qty: 1 }] }, { item_code: 'FP1', plan_qty: 2, lines: [{ item_code: 'M1', qty: 1 }] }] }, { allowError: true })
    assert('⑨ [FIX-210] 同一工单重复成品被拒绝', dup.status === 400 && /重复/.test(dup.message || ''), dup.message)
    const mo = await post('/api/scm/production-plans', { code: 'MO-DEL', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1',
      products: [{ item_code: 'FP1', plan_qty: 1, lines: [{ item_code: 'M1', qty: 1 }] }] })
    const rel = await post(`/api/scm/production-plans/${mo.data.id}/release`, {}, { allowError: true })
    assert('⑨ 工单审核通过', rel.code === 0, rel.message)
    const del = await api('DELETE', `/api/scm/production-plans/${mo.data.id}`, undefined, { allowError: true })
    assert('⑨ [FIX-209] 已审核工单不可直接删除', del.status === 400 && /草稿/.test(del.message || ''), del.message)
    // ⑩ 无工单的退料单被拦（FIX-212）
    const pj = await post('/api/scm/docs', { doc_type: 'PJ', doc_date: D, warehouse_code: 'W1', lines: [{ item_code: 'M1', qty: 1, price: 0 }] }, { allowError: true })
    assert('⑩ [FIX-212] 无工单的退料单保存被拒', pj.status === 400 && /退料必须关联/.test(pj.message || ''), pj.message)
    // 退料超过净已领被拦
    const issue = await post(`/api/scm/production-plans/${mo.data.id}/gen-issue`, {}, { allowError: true })
    if (issue.code === 0) {
      await audit(issue.data.id)
      const over = await post('/api/scm/docs', { doc_type: 'PJ', doc_date: D, warehouse_code: 'W1', plan_id: mo.data.id, lines: [{ item_code: 'M1', qty: 5, price: 0 }] }, { allowError: true })
      assert('⑩ [FIX-212] 退料超过净已领被拒', over.status === 400 && /超出/.test(over.message || ''), over.message)
      const okPj = await post('/api/scm/docs', { doc_type: 'PJ', doc_date: D, warehouse_code: 'W1', plan_id: mo.data.id, lines: [{ item_code: 'M1', qty: 1, price: 0 }] }, { allowError: true })
      assert('⑩ 退料 ≤ 净已领可保存', okPj.status === 200, okPj.message)
    } else {
      bad('⑩ 工单生成领料单', issue.message)
    }
  }

  // ⑪ 草稿采购订单批量下推：下游可保存、审核时提示先审上游（FIX-219）
  {
    const po = await createDoc({ doc_type: 'PO', doc_date: D, partner_code: 'SUP1',
      lines: [{ item_code: 'M1', qty: 3, price: 100, tax_rate: 13, tax_amount: 39 }] })
    const push = await post('/api/scm/docs/batch-push-purchase', { ids: [po.id] }, { allowError: true })
    assert('⑪ 草稿 PO 批量下推生成 PI 草稿', push.code === 0, push.message)
    const created = Array.isArray(push.data) ? push.data : (push.data?.docs || push.data?.list || push.data?.created || [])
    const piId = created[0]?.id
    if (piId) {
      const pi = (await get(`/api/scm/docs/${piId}`)).data
      const save = await api('PUT', `/api/scm/docs/${piId}`, { ...pi, warehouse_code: 'W1', lines: (pi.lines || []).map(l => ({ ...l, warehouse_code: 'W1' })) }, { allowError: true })
      assert('⑪ [FIX-219] 引用草稿 PO 的 PI 草稿可以保存', save.status === 200, save.message)
      const ra = await audit(piId)
      assert('⑪ [FIX-219] 审核时提示先审核上游', ra.code !== 0 && /先审核上游/.test(ra.message || ''), ra.message)
      await audit(po.id)
      const ra2 = await audit(piId)
      assert('⑪ 上游审核后下游可审核', ra2.code === 0, ra2.message)
    } else {
      bad('⑪ 批量下推未返回下游单据 id', JSON.stringify(push).slice(0, 200))
    }
  }

  // ⑫ 下推发票差额调整凭证（FIX-216）
  {
    for (const [code, name, direction] of [['1405', '库存商品', 'debit'], ['2221', '应交税费', 'credit']]) {
      const r = await post('/api/base/accounts', { code, name, direction, level: 1 }, { allowError: true })
      if (r.status !== 200 && !/已存在/.test(r.message || '')) bad('⑫ 建科目 ' + code, r.message)
    }
    // 进项/销项税科目由 resolveScmAccount 按名称探测（测试账套里是 2221001001/2221001005）
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 10, price: 100, tax_rate: 13, tax_amount: 130 }] })
    await audit(pi.id)
    const gv = await post(`/api/scm/docs/${pi.id}/gen-voucher`, {}, { allowError: true })
    assert('⑫ 采购入库生成凭证', gv.code === 0, gv.message)
    const piLine = dbq('SELECT id FROM scm_doc_line WHERE doc_id=?', pi.id)[0]
    const rp = await createDoc({ doc_type: 'RP', doc_date: D, partner_code: 'SUP1', source_doc_id: pi.id,
      lines: [{ item_code: 'M1', qty: 10, price: 80, tax_rate: 13, tax_amount: 104, source_line_id: piLine.id }] })
    await audit(rp.id)
    const gv2 = await post(`/api/scm/docs/${rp.id}/gen-voucher`, {}, { allowError: true })
    assert('⑫ [FIX-216] 下推发票按差额生成调整凭证', gv2.code === 0, gv2.message)
    if (gv2.code === 0) {
      const es = dbq('SELECT account_code, direction, amount FROM voucher_entries WHERE voucher_id=? ORDER BY seq', gv2.data.voucher_id)
      const ap = es.find(e => e.account_code === '2202' && e.direction === 'debit')
      assert('⑫ 差额分录：借应付 226', ap && r2(ap.amount) === 226, JSON.stringify(es))
    }
  }

  // ⑬ 账龄截止日（FIX-213）
  {
    const soFuture = await createDoc({ doc_type: 'SO', doc_date: '2026-12-01', partner_code: 'CUS1', warehouse_code: 'W1',
      lines: [{ item_code: 'M1', qty: 1, price: 100, tax_rate: 13, tax_amount: 13 }] })
    await audit(soFuture.id)
    const bal930 = (await get('/api/scm/arap-aging?as_of_date=2026-09-30')).data.find(a => a.partner_code === 'CUS1')
    const balAll = (await get('/api/scm/arap-aging?as_of_date=2026-12-31')).data.find(a => a.partner_code === 'CUS1')
    assert('⑬ [FIX-213] 截止 9-30 不含 12 月单据', bal930 && balAll && r2(balAll.balance - bal930.balance) === 113, `9-30=${bal930?.balance} 12-31=${balAll?.balance}`)
    assert('⑬ 账龄返回未到期列', bal930 && 'not_due' in bal930)
  }

  // ── 阶段 D ──────────────────────────────────────────────
  // ⑭ 主数据删除引用校验（P2-1）
  {
    const items = (await get('/api/scm/items?keyword=M1&page=1&page_size=10')).data
    const m1 = (items.list || items).find(i => i.code === 'M1')
    const del = await api('DELETE', `/api/scm/items/${m1.id}`, undefined, { allowError: true })
    assert('⑭ [P2-1] 有库存/单据引用的物料不能删除', del.status === 409 && /不能删除/.test(del.message || ''), del.message)
    const partners = (await get('/api/scm/partners')).data
    const cus = (partners.list || partners).find(p => p.code === 'CUS1')
    const delP = await api('DELETE', `/api/scm/partners/${cus.id}`, undefined, { allowError: true })
    assert('⑭ [P2-1] 有未核销往来的客户不能删除', delP.status === 409 && /未核销往来/.test(delP.message || ''), delP.message)
    const whs = (await get('/api/scm/warehouses')).data
    const w1 = (whs.list || whs).find(w => w.code === 'W1')
    const delW = await api('DELETE', `/api/scm/warehouses/${w1.id}`, undefined, { allowError: true })
    assert('⑭ [P2-1] 有库存结存的仓库不能删除', delW.status === 409 && /库存结存/.test(delW.message || ''), delW.message)
  }
  // ⑮ 分页参数容错（P2-4）
  {
    const r = await api('GET', '/api/scm/docs?page=abc&page_size=-5', undefined, { allowError: true })
    assert('⑮ [P2-4] page=abc 不再 500，回落到第 1 页', r.status === 200 && r.data.page === 1 && r.data.page_size === 50, `status=${r.status} page=${r.data?.page}`)
  }
  // ⑯ 允许负库存仓库参数（P2-7）
  {
    await ensure('/api/scm/warehouses', { code: 'W9', name: '负库存仓' })
    const cur = (await get('/api/scm/params')).data
    const list = Array.isArray(cur) ? cur : (cur.list || [])
    const others = list.filter(p => p.param_key !== 'scm:negative_stock_warehouses')
    const save = await api('PUT', '/api/scm/params', { params: [...others, { param_key: 'scm:negative_stock_warehouses', param_value: JSON.stringify(['W9']) }] }, { allowError: true })
    if (save.status !== 200) bad('⑯ 保存负库存仓库参数', save.message)
    const so = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W9',
      lines: [{ item_code: 'M1', qty: 3, price: 100, tax_rate: 13, tax_amount: 39, warehouse_code: 'W9' }] })
    const ra = await audit(so.id)
    assert('⑯ [P2-7] 允许负库存的仓库可无库存出库', ra.code === 0, ra.message)
    const st = await stock('W9', 'M1')
    assert('⑯ 负库存仓结存为 −3', Number(st.qty) === -3, `qty=${st.qty}`)
    const so2 = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W2',
      lines: [{ item_code: 'M1', qty: 3, price: 100, tax_rate: 13, tax_amount: 39, warehouse_code: 'W2' }] })
    const ra2 = await audit(so2.id)
    assert('⑯ 未允许负库存的仓库仍拦截', ra2.code !== 0 && /库存不足/.test(ra2.message || ''), ra2.message)
  }
  // ⑰ 库存明细账筛选后期末 = 实际结存（P2-10）
  {
    const all = (await get('/api/scm/stock/ledger?item_code=M1&warehouse_code=W1')).data
    const onlyPI = (await get('/api/scm/stock/ledger?item_code=M1&warehouse_code=W1&doc_type=PI')).data
    assert('⑰ [P2-10] 按单据类型筛选后期末数量仍等于实际结存', onlyPI.summary.closing_qty === all.summary.closing_qty && onlyPI.rows.every(r => r.doc_type === 'PI'),
      `all=${all.summary.closing_qty} onlyPI=${onlyPI.summary.closing_qty} rows=${onlyPI.rows.length}`)
    const sum = (await get('/api/scm/stock/summary?warehouse_code=W1')).data.summary
    assert('⑰ [P2-11] 收发存汇总带仓库参数返回该仓数据', Array.isArray(sum) && sum.length > 0 && sum.every(r => r.warehouse_code === 'W1'), `rows=${sum?.length}`)
  }

  // 汇总
  const fails = results.filter(r => !r.pass)
  console.log(`\n==== ${results.length} 项断言，${fails.length} 项失败 ====`)
  for (const f of fails) console.log(`  FAIL ${f.n}. ${f.name} — ${f.detail || ''}`)
  return fails.length
}

let exitCode = 1
try {
  exitCode = await main()
} catch (e) {
  console.error('ERROR:', e?.message || e)
  console.log('--- server log tail ---\n' + log.slice(-3000))
} finally {
  if (child) child.kill()
}
process.exit(exitCode)

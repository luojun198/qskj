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

  // ── 多币种双轨（P2-14）──────────────────────────────────
  {
    const cur = (await get('/api/scm/currencies')).data
    assert('⑱ 币种列表含本位币 RMB 与 USD', cur.base === 'RMB' && cur.list.some(c => c.code === 'USD'), JSON.stringify(cur.list.map(c => c.code)))
    const rate = (await get('/api/scm/currency-rate?currency=USD&date=' + D)).data
    assert('⑱ USD 记账汇率按币种表带出 6.8', Number(rate.rate) === 6.8 && rate.is_base === false, JSON.stringify(rate))
    await ensure('/api/scm/items', { code: 'M9', name: '进口物料', unit: '个', purchase_price: 100, default_warehouse_code: 'W1' })
    // 美元采购入库：未填汇率 → 保存时按币种表解析 6.8
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', currency: 'USD',
      lines: [{ item_code: 'M9', qty: 10, price: 100, tax_rate: 13, tax_amount: 130 }] })
    const ra = await audit(pi.id)
    assert('⑱ 美元采购入库审核通过', ra.code === 0, ra.message)
    const d = dbq('SELECT currency, exchange_rate FROM scm_doc WHERE id=?', pi.id)[0]
    assert('⑱ 单据汇率已锁定 6.8', d.currency === 'USD' && Number(d.exchange_rate) === 6.8, JSON.stringify(d))
    const st = await stock('W1', 'M9')
    assert('⑱ 库存成本折本位币：均价 680、金额 6800', r2(st.avg_cost) === 680 && r2(st.amount) === 6800, `avg=${st.avg_cost} amount=${st.amount}`)
    const log = dbq("SELECT currency, exchange_rate, amount_fc, amount FROM scm_ar_ap_log WHERE doc_no=(SELECT doc_no FROM scm_doc WHERE id=?)", pi.id)[0]
    assert('⑱ 应付台账：原币 1130 / 本位币 7684', log && log.currency === 'USD' && r2(log.amount_fc) === 1130 && r2(log.amount) === 7684, JSON.stringify(log))
    // 付款源单：USD 付款单只列美元源单；人民币付款单看不到它
    const srcUsd = (await get(`/api/scm/arap/payment-sources?partner_code=SUP1&payment_doc_type=PAY&currency=USD`)).data
    const srcCny = (await get(`/api/scm/arap/payment-sources?partner_code=SUP1&payment_doc_type=PAY&currency=CNY`)).data
    assert('⑱ 付款源单按币别过滤', srcUsd.some(s => s.source_doc_id === pi.id && r2(s.open_amount) === 1130) && !srcCny.some(s => s.source_doc_id === pi.id),
      `usd=${srcUsd.length} cny=${srcCny.length}`)
    // 生成凭证：借存货 6800 / 借进项 884 / 贷应付 7684，应付分录带原币 1130 与汇率 6.8
    const gv = await post(`/api/scm/docs/${pi.id}/gen-voucher`, {}, { allowError: true })
    assert('⑱ 美元入库生成凭证', gv.code === 0, gv.message)
    if (gv.code === 0) {
      const es = dbq('SELECT account_code, direction, amount, currency_code, exchange_rate, foreign_amount FROM voucher_entries WHERE voucher_id=?', gv.data.voucher_id)
      const ap = es.find(e => e.account_code === '2202')
      assert('⑱ 应付分录本位币 7684 / 原币 USD 1130 / 汇率 6.8', ap && r2(ap.amount) === 7684 && ap.currency_code === 'USD' && r2(ap.foreign_amount) === 1130 && Number(ap.exchange_rate) === 6.8, JSON.stringify(es))
    }
    // 全部币种报表折本位币
    const rep = await post('/api/scm/report/purchase/fixed-query', { report_code: 'summary', grouping: 'supplier', filters: { start_date: D, end_date: D, currency: 'ALL' } }, { allowError: true })
    if (rep.code === 0) {
      const sup = (rep.data.rows || []).find(r => r.partner_code === 'SUP1')
      assert('⑱ 采购汇总「全部币种」折本位币（含 USD 6800）', sup && Number(sup.purchase_amount) >= 6800, JSON.stringify(sup))
    } else {
      bad('⑱ 采购固定报表 ALL', rep.message)
    }
  }

  // ── 阶段 C：BOM 版本/生效期、替代料、结案结转 ───────────────
  {
    await ensure('/api/scm/items', { code: 'FP2', name: '成品乙', unit: '套', source_type: 'self', default_warehouse_code: 'W1' })
    await ensure('/api/scm/items', { code: 'M2', name: '替代物料', unit: '个', purchase_price: 90, default_warehouse_code: 'W1' })
    // 两个版本：V1 已失效、V2 生效中；V2 里 M1 与 M2 为替代组（M1 主料）
    const v1 = await post('/api/scm/boms', { code: 'BOM-FP2-V1', name: 'V1', item_code: 'FP2', version: '1.0', effective_date: '2026-01-01', expire_date: '2026-06-30', is_default: 0,
      lines: [{ item_code: 'M1', qty: 5 }] }, { allowError: true })
    const v2 = await post('/api/scm/boms', { code: 'BOM-FP2-V2', name: 'V2', item_code: 'FP2', version: '2.0', effective_date: '2026-07-01', is_default: 0,
      lines: [{ item_code: 'M1', qty: 2, sub_group: 'G1', sub_priority: 1 }, { item_code: 'M2', qty: 2, sub_group: 'G1', sub_priority: 2 }] }, { allowError: true })
    assert('⑲ 两个版本 BOM 建立', v1.code === 0 && v2.code === 0, (v1.message || '') + (v2.message || ''))
    const ex = (await get(`/api/scm/boms/${v2.data.id}/explode?qty=1`)).data
    assert('⑲ [C-1] 替代料组折叠为主料一行并带替代料', ex.lines.length === 1 && ex.lines[0].item_code === 'M1' && ex.lines[0].substitutes?.[0]?.item_code === 'M2', JSON.stringify(ex.lines))
    // 缺料/MRP 用 V2（V1 已失效）：用销售订单驱动 MRP
    const soa = await createDoc({ doc_type: 'SOa', doc_date: D, partner_code: 'CUS1', lines: [{ item_code: 'FP2', qty: 3, price: 500 }] })
    await audit(soa.id)
    const mrp = await post('/api/scm/mrp-docs', { doc_date: D, include_safety_stock: false, sources: [{ kind: 'sales_order', id: soa.id }] }, { allowError: true })
    if (mrp.code === 0) {
      const lines = dbq('SELECT item_code, qty, field_values FROM scm_doc_line WHERE doc_id=?', mrp.data.id)
      const fp = lines.find(l => l.item_code === 'FP2'); const fv = fp ? JSON.parse(fp.field_values) : {}
      // M1 在库充足时净需求为 0、不落结果行，只校验选版
      assert('⑲ [C-1] MRP 按生效期取 V2（V1 已失效）', fv.bom_code === 'BOM-FP2-V2', JSON.stringify(lines.map(l => [l.item_code, l.qty])) + ' bom=' + fv.bom_code)
    } else {
      bad('⑲ MRP 计算', mrp.message)
    }
    // 工单：领替代料 M2 也按主料 M1 的需求上限计
    const mo = await post('/api/scm/production-plans', { code: 'MO-SUB', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1',
      products: [{ item_code: 'FP2', plan_qty: 2, bom_id: v2.data.id, lines: ex.lines.map(l => ({ item_code: l.item_code, qty: l.qty_per_unit })) }] })
    await post(`/api/scm/production-plans/${mo.data.id}/release`, {}, { allowError: true })
    const overSub = await post('/api/scm/docs', { doc_type: 'PL', doc_date: D, warehouse_code: 'W1', plan_id: mo.data.id, lines: [{ item_code: 'M2', qty: 5 }] }, { allowError: true })
    assert('⑲ [C-1] 领替代料超过主料需求(4)被拦', overSub.status === 400 && /禁止超领/.test(overSub.message || ''), overSub.message)
    const okSub = await post('/api/scm/docs', { doc_type: 'PL', doc_date: D, warehouse_code: 'W1', plan_id: mo.data.id, lines: [{ item_code: 'M2', qty: 1 }] }, { allowError: true })
    assert('⑲ [C-1] 领替代料在上限内可保存', okSub.status === 200, okSub.message)
    // 结案结转：领了 1 个 M2（有成本）后不完工直接强制关闭 → 生成 CA 单、在制归零
    const piM2 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'M2', qty: 10, price: 90 }] })
    await audit(piM2.id)
    const ra = await audit(okSub.data.id)
    assert('⑳ 领料单审核通过', ra.code === 0, ra.message)
    const closeNoForce = await post(`/api/scm/production-plans/${mo.data.id}/close`, {}, { allowError: true })
    assert('⑳ 有在制余额时不带 force 拒绝关闭', closeNoForce.status === 400 && /在制余额/.test(closeNoForce.message || ''), closeNoForce.message)
    const closed = await post(`/api/scm/production-plans/${mo.data.id}/close`, { force: true }, { allowError: true })
    assert('⑳ [P2-17] 强制关闭生成结案结转单', closed.code === 0 && closed.data.closeout_doc?.doc_no, JSON.stringify(closed.data))
    const ca = dbq("SELECT d.doc_no, d.status, l.item_code, l.qty, l.amount FROM scm_doc d JOIN scm_doc_line l ON l.doc_id=d.id WHERE d.doc_type='CA' AND d.plan_id=?", mo.data.id)
    assert('⑳ 结转单已审核、金额 = 领料成本 90、数量 0', ca.length === 1 && ca[0].status === 'audited' && Number(ca[0].qty) === 0 && r2(ca[0].amount) === 90, JSON.stringify(ca))
    const rep = (await get(`/api/scm/report/production/execution?plan_code=MO-SUB`)).data
    const row = (rep.rows || []).find(r => r.plan_code === 'MO-SUB')
    assert('⑳ 生产执行表在制归零', row && Math.abs(Number(row.wip ?? row.wip_amount ?? row.total_wip ?? 0)) < 0.005, JSON.stringify(row))
    const fpStock = await stock('W1', 'FP2')
    assert('⑳ 成品库存金额吸收在制 90（数量 0）', r2(fpStock.amount) === 90 && Number(fpStock.qty) === 0, JSON.stringify(fpStock))
    const gv = await post(`/api/scm/docs/${closed.data.closeout_doc.id}/gen-voucher`, {}, { allowError: true })
    assert('⑳ 结转单可生成凭证（借存货 90 / 贷生产成本 90）', gv.code === 0, gv.message)
  }

  // ── 往来汇率重估（与总账期末调汇配合）──────────────────
  {
    // ⑱ 已有 USD 采购入库 1130 USD @6.8 = 7684 未核销；期末汇率手填 7.0 → 7910，调整 +226
    const pv = (await get('/api/scm/arap/fx-reval/preview?year=2026&period=9&rates=' + encodeURIComponent(JSON.stringify({ USD: 7 })))).data
    const usdRow = pv.rows.find(r => r.currency === 'USD' && r.partner_code === 'SUP1')
    assert('㉑ 重估预览列出 USD 未清应付 1130 @6.8 → 7.0，调整 226', usdRow && r2(usdRow.open_fc) === 1130 && r2(usdRow.adjustment) === 226, JSON.stringify(usdRow))
    const run = await post('/api/scm/arap/fx-reval', { year: 2026, period: 9, rates: { USD: 7 } }, { allowError: true })
    assert('㉑ 执行重估', run.code === 0 && run.data.count >= 1, run.message)
    const lg = await ledger('SUP1')
    const pi = lg.detail.find(d => d.currency === 'USD' && d.direction === 'in')
    assert('㉑ 台账本位币改为 7910、汇率 7.0', pi && r2(pi.amount) === 7910 && Number(pi.exchange_rate) === 7, JSON.stringify(pi && { amount: pi.amount, rate: pi.exchange_rate }))
    const again = await post('/api/scm/arap/fx-reval', { year: 2026, period: 9, rates: { USD: 7 } }, { allowError: true })
    assert('㉑ 同期重复重估被拒', again.status === 400 && /已做过/.test(again.message || ''), again.message)
    const list = (await get('/api/scm/arap/fx-reval')).data
    const rv = await post(`/api/scm/arap/fx-reval/${list[0].id}/revoke`, {}, { allowError: true })
    const lg2 = await ledger('SUP1')
    const pi2 = lg2.detail.find(d => d.currency === 'USD' && d.direction === 'in')
    assert('㉑ 撤销后恢复 7684 @6.8', rv.code === 0 && pi2 && r2(pi2.amount) === 7684 && Number(pi2.exchange_rate) === 6.8, rv.message || JSON.stringify(pi2 && { amount: pi2.amount, rate: pi2.exchange_rate }))
  }

  // ── 质检：检验标准 / 抽样 / 自动判定 / IQC 入库闸 ─────────────
  {
    const std = await post('/api/scm/qc-standards', { item_code: 'M1', qc_type: 'IQC', name: 'M1 来料标准', sampling_mode: 'percent', sampling_value: 10, min_sample: 3, accept_defects: 1,
      items: [{ name: '直径', value_type: 'numeric', lower_limit: 9.8, upper_limit: 10.2, unit: 'mm', is_key: 1 }, { name: '外观', value_type: 'bool', is_key: 0 }] }, { allowError: true })
    assert('㉒ 新建检验标准', std.code === 0, std.message)
    const rs = (await get('/api/scm/qc-standards/resolve?item_code=M1&qc_type=IQC&qty=50')).data
    assert('㉒ 解析标准并给出抽样数 5（50×10%）', rs && rs.items.length === 2 && rs.sample_size === 5, JSON.stringify(rs && { n: rs.items.length, sample: rs.sample_size }))
    // 开参数：采购入库须先到货检验
    const cur = (await get('/api/scm/params')).data
    const others = cur.filter(p => p.param_key !== 'scm:qc_required_for_receipt')
    await api('PUT', '/api/scm/params', { params: [...others, { param_key: 'scm:qc_required_for_receipt', param_value: '1' }] }, { allowError: true })
    const pi = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'M1', qty: 20, price: 100 }] })
    const blocked = await audit(pi.id)
    assert('㉒ [IQC 闸] 无合格 IQC 时采购入库被拦', blocked.code !== 0 && /到货检验/.test(blocked.message || ''), blocked.message)
    // 关键项超限 → 自动判不合格
    const bad = await post('/api/scm/qc-docs', { qc_type: 'IQC', qc_date: D, source_doc_id: pi.id, source_doc_no: pi.doc_no, result: 'pass',
      lines: [{ item_code: 'M1', inspect_qty: 20, qualified_qty: 20, defect_qty: 0, results: [{ name: '直径', value_type: 'numeric', lower_limit: 9.8, upper_limit: 10.2, is_key: 1, value_num: 10.5 }, { name: '外观', value_type: 'bool', is_key: 0, value_bool: 1 }] }] }, { allowError: true })
    const badDoc = (await get(`/api/scm/qc-docs/${bad.data.id}`)).data
    assert('㉒ 关键项超限自动判「不合格」（人工填合格被覆盖）', badDoc.result === 'fail' && badDoc.lines[0].judged === false, `result=${badDoc.result} judged=${badDoc.lines[0].judged}`)
    await post(`/api/scm/qc-docs/${bad.data.id}/audit`, {}, { allowError: true })
    const stillBlocked = await audit(pi.id)
    assert('㉒ [IQC 闸] 不合格 IQC 不放行', stillBlocked.code !== 0, stillBlocked.message)
    // 合格：直径 10.0、不良 1 ≤ 允收 1
    const good = await post('/api/scm/qc-docs', { qc_type: 'IQC', qc_date: D, source_doc_id: pi.id, source_doc_no: pi.doc_no, result: 'fail',
      lines: [{ item_code: 'M1', inspect_qty: 20, qualified_qty: 19, defect_qty: 1, results: [{ name: '直径', value_type: 'numeric', lower_limit: 9.8, upper_limit: 10.2, is_key: 1, value_num: 10.0 }, { name: '外观', value_type: 'bool', is_key: 0, value_bool: 0 }] }] }, { allowError: true })
    const goodDoc = (await get(`/api/scm/qc-docs/${good.data.id}`)).data
    assert('㉒ 关键项合格、非关键项不合格、不良 1 ≤ 允收 1 → 自动判「合格」', goodDoc.result === 'pass' && goodDoc.lines[0].results.length === 2, `result=${goodDoc.result}`)
    await post(`/api/scm/qc-docs/${good.data.id}/audit`, {}, { allowError: true })
    const short = await audit(pi.id)
    assert('㉒ [IQC 闸] 合格数 19 < 入库 20 拦截', short.code !== 0 && /少于入库数/.test(short.message || ''), short.message)
    // 调入库数为 19 后放行
    const piDoc = (await get(`/api/scm/docs/${pi.id}`)).data
    await api('PUT', `/api/scm/docs/${pi.id}`, { ...piDoc, lines: piDoc.lines.map(l => ({ ...l, qty: 19 })) }, { allowError: true })
    const ok19 = await audit(pi.id)
    assert('㉒ [IQC 闸] 合格数覆盖后入库审核通过', ok19.code === 0, ok19.message)
    await api('PUT', '/api/scm/params', { params: [...others, { param_key: 'scm:qc_required_for_receipt', param_value: '0' }] }, { allowError: true })
  }

  // ── 工序委外（OP）─────────────────────────────────────────
  {
    const types2 = (await get('/api/scm/docs/types')).data
    assert('㉓ 存量账套补齐 OP / CA 单据类型', types2.some(t => t.code === 'OP') && types2.some(t => t.code === 'CA'), types2.map(t => t.code).join(','))
    await ensure('/api/scm/partners', { code: 'VEN1', name: '工序委外厂', partner_type: 'supplier', ap_account: '2202', is_outsource: 1 })
    await ensure('/api/scm/items', { code: 'FP3', name: '工序委外成品', unit: '台', source_type: 'self', default_warehouse_code: 'W1' })
    const mo = await post('/api/scm/production-plans', { code: 'MO-OP', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1',
      products: [{ item_code: 'FP3', plan_qty: 5, lines: [{ item_code: 'M1', qty: 1 }] }] })
    await post(`/api/scm/production-plans/${mo.data.id}/release`, {}, { allowError: true })
    // 关联委外工单应被拒（OP 只能挂自制工单）：用 MO-SUB（自制，已关闭）以外的委外单验证略；这里直接建单
    const op = await post('/api/scm/docs', { doc_type: 'OP', doc_date: D, partner_code: 'VEN1', plan_id: mo.data.id,
      lines: [{ item_code: 'FP3', qty: 5, price: 8, tax_rate: 13, tax_amount: 5.2, remark: '工序：电镀' }] }, { allowError: true })
    assert('㉓ 工序委外单保存', op.status === 200, op.message)
    const ra = await audit(op.data.id)
    assert('㉓ 工序委外单审核', ra.code === 0, ra.message)
    const lg = await ledger('VEN1')
    assert('㉓ 加工费挂委外厂应付 45.2', r2(lg.closing) === 45.2, `closing=${lg.closing}`)
    const plan = (await get(`/api/scm/production-plans/${mo.data.id}`)).data
    const oh = Number(plan.cost?.overheadTotal ?? plan.cost_summary?.overheadTotal ?? plan.overhead_total ?? NaN)
    assert('㉓ 工单成本汇总制费含加工费 40', oh === 40, JSON.stringify(plan.cost || plan.cost_summary || {}).slice(0, 200))
    const gv = await post(`/api/scm/docs/${op.data.id}/gen-voucher`, {}, { allowError: true })
    assert('㉓ 工序委外凭证 借制造费用/进项 贷应付', gv.code === 0, gv.message)
    const noPlan = await post('/api/scm/docs', { doc_type: 'OP', doc_date: D, partner_code: 'VEN1', lines: [{ item_code: 'FP3', qty: 1, price: 8 }] }, { allowError: true })
    assert('㉓ 无工单的工序委外单被拒', noPlan.status === 400 && /工序委外必须关联/.test(noPlan.message || ''), noPlan.message)
  }

  // ── ㉔ FIFO / LIFO 计价（成本层）────────────────────────────────
  {
    async function setCosting(v) {
      const cur = (await get('/api/scm/params')).data
      const list = Array.isArray(cur) ? cur : (cur.list || [])
      const others = list.filter(p => p.param_key !== 'scm:costing_method')
      return api('PUT', '/api/scm/params', { params: [...others, { param_key: 'scm:costing_method', param_value: v }] }, { allowError: true })
    }
    await ensure('/api/scm/items', { code: 'MF', name: 'FIFO 物料', unit: '个', purchase_price: 10, sale_price: 30, default_warehouse_code: 'W1' })
    const sv = await setCosting('fifo')
    assert('㉔ 计价方式可切换为先进先出', sv.status === 200, sv.message)
    const pi1 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MF', qty: 10, price: 10, tax_rate: 0, tax_amount: 0 }] })
    const pi2 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MF', qty: 10, price: 12, tax_rate: 0, tax_amount: 0 }] })
    const a1 = await audit(pi1.id); const a2 = await audit(pi2.id)
    assert('㉔ FIFO 下采购入库审核通过（不再被计价守卫拦截）', a1.code === 0 && a2.code === 0, a1.message || a2.message)
    const ls = await get('/api/scm/stock/layers?item_code=MF&warehouse_code=W1')
    assert('㉔ 两笔入库形成两层（10@10、10@12）', ls.costing_method === 'fifo' && ls.data.length === 2 && ls.data[0].unit_cost === 10 && ls.data[1].unit_cost === 12, JSON.stringify(ls.data).slice(0, 200))
    const so = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1', lines: [{ item_code: 'MF', qty: 15, price: 30, tax_rate: 0, tax_amount: 0, warehouse_code: 'W1' }] })
    const rs = await audit(so.id)
    assert('㉔ FIFO 销售出库审核', rs.code === 0, rs.message)
    const mv = dbq("SELECT unit_cost, amount FROM scm_stock_move WHERE doc_no=? AND direction='out'", so.doc_no)[0]
    assert('㉔ 出库成本按先进先出 = 10×10 + 5×12 = 160', mv && r2(mv.amount) === 160, JSON.stringify(mv))
    const st = await stock('W1', 'MF')
    assert('㉔ 结存 = 5 × 12 = 60（非移动平均 55）', Number(st.qty) === 5 && r2(st.amount) === 60, `qty=${st.qty} amount=${st.amount}`)
    const ls2 = (await get('/api/scm/stock/layers?item_code=MF&warehouse_code=W1')).data
    assert('㉔ 第一层耗尽后仅剩第二层 5 件', ls2.length === 1 && ls2[0].qty_left === 5 && ls2[0].unit_cost === 12, JSON.stringify(ls2))
    const ru = await unaudit(pi1.id)
    assert('㉔ 反审核已被消耗的入库单被拒', ru.code !== 0 && /已被后续出库消耗/.test(ru.message || ''), ru.message)
    const ru2 = await unaudit(so.id)
    assert('㉔ 反审核出库单恢复层', ru2.code === 0 && (await get('/api/scm/stock/layers?item_code=MF&warehouse_code=W1')).data.length === 2, ru2.message)
    await setCosting('moving_avg')
  }

  // ── ㉕ 指定成本（个别计价）/ 全月平均 ─────────────────────────
  {
    async function setCosting(v) {
      const cur = (await get('/api/scm/params')).data
      const list = Array.isArray(cur) ? cur : (cur.list || [])
      const others = list.filter(p => p.param_key !== 'scm:costing_method')
      return api('PUT', '/api/scm/params', { params: [...others, { param_key: 'scm:costing_method', param_value: v }] }, { allowError: true })
    }
    // 指定成本：按批次识别入库层
    await ensure('/api/scm/items', { code: 'MS', name: '指定成本物料', unit: '个', purchase_price: 10, sale_price: 30, default_warehouse_code: 'W1', batch_flag: 1 })
    assert('㉕ 计价方式可切换为指定成本', (await setCosting('specified')).status === 200)
    const p1 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MS', qty: 10, price: 10, tax_rate: 0, tax_amount: 0, batch_no: 'BA' }] })
    const p2 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MS', qty: 10, price: 14, tax_rate: 0, tax_amount: 0, batch_no: 'BB' }] })
    const a1 = await audit(p1.id); const a2 = await audit(p2.id)
    assert('㉕ 指定成本下入库审核通过', a1.code === 0 && a2.code === 0, a1.message || a2.message)
    const so = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1', lines: [{ item_code: 'MS', qty: 3, price: 30, tax_rate: 0, tax_amount: 0, warehouse_code: 'W1', batch_no: 'BB' }] })
    const rs = await audit(so.id)
    assert('㉕ 指定批次 BB 出库审核', rs.code === 0, rs.message)
    const mv = dbq("SELECT unit_cost, amount FROM scm_stock_move WHERE doc_no=? AND direction='out'", so.doc_no)[0]
    assert('㉕ 出库成本取 BB 批次 3×14 = 42（非先进先出 30）', mv && r2(mv.amount) === 42, JSON.stringify(mv))
    const ls = (await get('/api/scm/stock/layers?item_code=MS')).data
    assert('㉕ 成本层带批次且 BB 层余 7', ls.some(l => l.batch_no === 'BB' && l.qty_left === 7) && ls.some(l => l.batch_no === 'BA' && l.qty_left === 10), JSON.stringify(ls.map(l => [l.batch_no, l.qty_left])))
    // 全月平均：暂估 → 月末重算
    await ensure('/api/scm/items', { code: 'MM', name: '全月平均物料', unit: '个', purchase_price: 10, sale_price: 30, default_warehouse_code: 'W1' })
    assert('㉕ 计价方式可切换为全月平均', (await setCosting('month_avg')).status === 200)
    const m1 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MM', qty: 10, price: 10, tax_rate: 0, tax_amount: 0 }] })
    assert('㉕ 全月平均下入库审核通过', (await audit(m1.id)).code === 0)
    const mso = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1', lines: [{ item_code: 'MM', qty: 4, price: 30, tax_rate: 0, tax_amount: 0, warehouse_code: 'W1' }] })
    assert('㉕ 暂估出库审核', (await audit(mso.id)).code === 0)
    const m2 = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MM', qty: 10, price: 20, tax_rate: 0, tax_amount: 0 }] })
    await audit(m2.id)
    const period = D.slice(0, 7)
    const pv = await get(`/api/scm/costing/month-avg/preview?period=${period}`)
    const row = pv.data?.rows?.find(r => r.item_code === 'MM')
    assert('㉕ 试算：全月平均 = 300/20 = 15，出库 4 由 40 调为 60', row && row.avg_cost === 15 && row.old_out_amount === 40 && row.new_out_amount === 60 && row.delta === 20, JSON.stringify(row))
    const mvBefore = dbq("SELECT amount FROM scm_stock_move WHERE doc_no=? AND direction='out'", mso.doc_no)[0]
    assert('㉕ 试算不写库', r2(mvBefore.amount) === 40, JSON.stringify(mvBefore))
    const calc = await post('/api/scm/costing/month-avg/calc', { period }, { allowError: true })
    assert('㉕ 计算并写入成功', calc.code === 0, calc.message)
    const mvAfter = dbq("SELECT unit_cost, amount FROM scm_stock_move WHERE doc_no=? AND direction='out'", mso.doc_no)[0]
    const stMM = await stock('W1', 'MM')
    assert('㉕ 出库流水改为 15×4=60，结存 16×15=240', r2(mvAfter.amount) === 60 && Number(stMM.qty) === 16 && r2(stMM.amount) === 240, `mv=${JSON.stringify(mvAfter)} stock=${stMM.qty}/${stMM.amount}`)
    const periods = (await get('/api/scm/costing/periods')).data
    assert('㉕ 期间记录为已计算', periods.some(p => p.period === period && p.status === 'calculated'), JSON.stringify(periods.map(p => [p.period, p.status])))
    const mso2 = await createDoc({ doc_type: 'SO', doc_date: D, partner_code: 'CUS1', warehouse_code: 'W1', lines: [{ item_code: 'MM', qty: 1, price: 30, tax_rate: 0, tax_amount: 0, warehouse_code: 'W1' }] })
    await audit(mso2.id)
    const periods2 = (await get('/api/scm/costing/periods')).data
    assert('㉕ 期内再出库后期间标为需重算', periods2.some(p => p.period === period && p.status === 'stale'), JSON.stringify(periods2.map(p => [p.period, p.status])))
    await setCosting('moving_avg')
    const noCalc = await post('/api/scm/costing/month-avg/calc', { period }, { allowError: true })
    assert('㉕ 非全月平均账套拒绝写入计算', noCalc.status === 400, noCalc.message)
  }

  // ── ㉖ 生产回归（生产评审 阶段 0 + 阶段 A）────────────────────────
  {
    const PL = (p) => `/api/scm/production-plans${p || ''}`
    await ensure('/api/scm/items', { code: 'FP4', name: '多工序成品', unit: '台', source_type: 'self', default_warehouse_code: 'W1' })
    await ensure('/api/scm/work-centers', { code: 'WC1', name: '装配线', labor_rate: 20, overhead_rate: 10 })
    await ensure('/api/scm/work-centers', { code: 'WC9', name: '闲置中心', labor_rate: 1, overhead_rate: 1 })
    const rt = await post('/api/scm/routings', { code: 'RT-FP4', item_code: 'FP4', status: 'active',
      lines: [{ process_name: '下料', work_center_code: 'WC1', std_hours: 1 }, { process_name: '焊接', work_center_code: 'WC1', std_hours: 1 }, { process_name: '总装', work_center_code: 'WC1', std_hours: 2 }] }, { allowError: true })
    assert('㉖ 工艺路线保存（3 道工序）', rt.status === 200 || /已存在/.test(rt.message || ''), rt.message)
    // 日期校验（P2-4）
    const badDate = await post(PL(), { code: 'MO-BAD', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1', start_date: '2026-09-20', end_date: '2026-09-10',
      products: [{ item_code: 'FP4', plan_qty: 5, lines: [{ item_code: 'M1', qty: 1 }] }] }, { allowError: true })
    assert('㉖ [P2-4] 开工晚于完工被拒', badDate.status === 400 && /开工日期/.test(badDate.message || ''), badDate.message)
    // 草稿工单不能关闭（P1-4）、草稿不能报工（P1-3）
    const mo = await post(PL(), { code: 'MO-PROC', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1',
      products: [{ item_code: 'FP4', plan_qty: 5, lines: [{ item_code: 'M1', qty: 1 }] }] })
    const closeDraft = await post(PL(`/${mo.data.id}/close`), {}, { allowError: true })
    assert('㉖ [P1-4] 草稿工单不能关闭', closeDraft.status === 400 && /仅已审核工单可关闭/.test(closeDraft.message || ''), closeDraft.message)
    const wrDraft = await post('/api/scm/work-reports', { plan_id: mo.data.id, qty: 1, work_center_code: 'WC1', work_hours: 1 }, { allowError: true })
    assert('㉖ [P1-3] 草稿工单不能报工', wrDraft.status === 400 && /未审核/.test(wrDraft.message || ''), wrDraft.message)
    assert('㉖ 工单审核', (await post(PL(`/${mo.data.id}/release`), {}, { allowError: true })).code === 0)
    const detail = (await get(PL(`/${mo.data.id}`))).data
    const prodId = detail.products[0].id
    // 多工序报工：三道各报 5（计划 5）都放行；同工序再报被拒（P1-1）
    const wr = async (process, qty, scrap = 0) => post('/api/scm/work-reports', { plan_id: mo.data.id, product_id: prodId, item_code: 'FP4', process_name: process, work_center_code: 'WC1', work_hours: 1, qty, scrap_qty: scrap }, { allowError: true })
    // 阶段 C2 后有工艺路线的工单按工序流转：逐道审核后再报下一道
    const r1 = await wr('下料', 5); await post(`/api/scm/work-reports/${r1.data?.id}/audit`, {}, { allowError: true })
    const r2w = await wr('焊接', 5); await post(`/api/scm/work-reports/${r2w.data?.id}/audit`, {}, { allowError: true })
    const r3 = await wr('总装', 4, 1)
    assert('㉖ [P1-1] 三道工序各报满计划数均放行', r1.status === 200 && r2w.status === 200 && r3.status === 200, [r1.message, r2w.message, r3.message].filter(Boolean).join(' | '))
    const over = await wr('焊接', 1)
    assert('㉖ [P1-1] 同一工序再报 1 件被拒（按成品×工序计数）', over.status === 400 && /工序「焊接」/.test(over.message || ''), over.message)
    await post(`/api/scm/work-reports/${r3.data.id}/audit`, {}, { allowError: true })
    // 完工默认数 = 末道工序「总装」合格数 4（不是 5+5+4）
    const draftPF = await post(PL(`/${mo.data.id}/gen-finish`), {}, { allowError: true })
    assert('㉖ [P1-1] 完工入库默认数取末道工序合格数 4', draftPF.code === 0 && Number(dbq('SELECT total_qty FROM scm_doc WHERE id=?', draftPF.data.id)[0]?.total_qty) === 4, JSON.stringify(dbq('SELECT total_qty FROM scm_doc WHERE id=?', draftPF.data?.id)))
    // 关闭前有草稿完工单 → 拒绝（P1-2）
    const closeDraftDoc = await post(PL(`/${mo.data.id}/close`), { force: true }, { allowError: true })
    assert('㉖ [P1-2] 存在未审核单据时拒绝关闭并列出单号', closeDraftDoc.status === 400 && /未审核单据/.test(closeDraftDoc.message || '') && (closeDraftDoc.data?.draft_docs || []).length === 1, closeDraftDoc.message)
    await api('DELETE', `/api/scm/docs/${draftPF.data.id}`, undefined, { allowError: true })
    const wrOpen = await wr('返修', 1)
    const closeDraftWr = await post(PL(`/${mo.data.id}/close`), { force: true }, { allowError: true })
    assert('㉖ [P2-6] 存在未审核报工时拒绝关闭', closeDraftWr.status === 400 && /未审核报工/.test(closeDraftWr.message || ''), closeDraftWr.message)
    await api('DELETE', `/api/scm/work-reports/${wrOpen.data.id}`, undefined, { allowError: true })
    // 工作中心引用检查（P1-5）
    const wcs = (await get('/api/scm/work-centers')).data
    const delUsed = await api('DELETE', `/api/scm/work-centers/${wcs.find(w => w.code === 'WC1').id}`, undefined, { allowError: true })
    assert('㉖ [P1-5] 被工艺路线/报工引用的工作中心不能删', delUsed.status === 400 && /引用/.test(delUsed.message || ''), delUsed.message)
    const delFree = await api('DELETE', `/api/scm/work-centers/${wcs.find(w => w.code === 'WC9').id}`, undefined, { allowError: true })
    assert('㉖ 未引用的工作中心可删', delFree.code === 0, delFree.message)
    // 只带 bom_id 无用料行的成品 → 下达时快照（P1-8）
    const bomFp4 = await post('/api/scm/boms', { code: 'BOM-FP4', name: 'FP4', item_code: 'FP4', version: '1.0', is_default: 1, lines: [{ item_code: 'M1', qty: 2, scrap_rate: 0 }] }, { allowError: true })
    const bomId = bomFp4.data?.id || (await get('/api/scm/boms')).data.find(b => b.code === 'BOM-FP4')?.id
    const moSnap = await post(PL(), { code: 'MO-SNAP', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1', products: [{ item_code: 'FP4', plan_qty: 3, bom_id: bomId }] }, { allowError: true })
    const relSnap = await post(PL(`/${moSnap.data.id}/release`), {}, { allowError: true })
    const sug = (await get(PL(`/${moSnap.data.id}/issue-suggestion`))).data
    assert('㉖ [P1-8] 只带 BOM 的成品下达后自动快照用料，领料建议需求 = 2×3 = 6', relSnap.code === 0 && relSnap.data.snapshot_products === 1 && sug.lines.length === 1 && sug.lines[0].need === 6, JSON.stringify({ rel: relSnap.data, lines: sug.lines }))
    // 关闭已审核工单后报工被拒（P1-3）
    const closedOk = await post(PL(`/${moSnap.data.id}/close`), { force: true }, { allowError: true })
    assert('㉖ 无在制、无草稿的工单可直接关闭', closedOk.code === 0, closedOk.message)
    const wrClosed = await post('/api/scm/work-reports', { plan_id: moSnap.data.id, qty: 1, work_center_code: 'WC1', work_hours: 1 }, { allowError: true })
    assert('㉖ [P1-3] 已关闭工单不能报工', wrClosed.status === 400 && /已关闭/.test(wrClosed.message || ''), wrClosed.message)
  }

  // ── ㉗ 生产阶段 B：列表分页筛选 / 路线唯一 / 齐套分配 / 工时差异 / 三张报表 / 实际日期 ────
  {
    const PL = (p) => `/api/scm/production-plans${p || ''}`
    // 工单列表：不带 page 仍返回数组；带 page 返回分页结构；筛选生效
    const arr = await get(PL())
    const paged = await get(PL('?page=1&page_size=2&plan_type=self'))
    assert('㉗ [P1-6] 工单列表兼容数组 / 分页双形态', Array.isArray(arr.data) && Array.isArray(paged.data.list) && paged.data.list.length <= 2 && paged.data.total >= paged.data.list.length && paged.data.list.every(p => (p.plan_type || 'self') === 'self'), JSON.stringify({ arr: arr.data.length, total: paged.data.total }))
    const kw = await get(PL('?page=1&page_size=50&keyword=MO-PROC'))
    assert('㉗ [P1-6] 关键字筛选命中工单号', kw.data.total === 1 && kw.data.list[0].code === 'MO-PROC', JSON.stringify(kw.data.list.map(p => p.code)))
    const late = await post(PL(), { code: 'MO-LATE', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1', start_date: '2026-01-01', end_date: '2026-01-31', products: [{ item_code: 'FP4', plan_qty: 2, lines: [{ item_code: 'M1', qty: 1 }] }] })
    await post(PL(`/${late.data.id}/release`), {}, { allowError: true })
    const overdue = await get(PL('?page=1&page_size=50&overdue=1'))
    assert('㉗ [P2-10] 逾期筛选命中已审核且交期已过的工单', overdue.data.list.some(p => p.code === 'MO-LATE' && p.is_overdue === 1), JSON.stringify(overdue.data.list.map(p => p.code)))
    // 实际开工：审核领料单后回写
    const issue = await post(PL(`/${late.data.id}/gen-issue`), {}, { allowError: true })
    const ai = await audit(issue.data.id)
    const lateDetail = (await get(PL(`/${late.data.id}`))).data.plan
    assert('㉗ [P2-10] 审核领料后实际开工日期 = 领料单日期', ai.code === 0 && lateDetail.actual_start_date === dbq('SELECT doc_date FROM scm_doc WHERE id=?', issue.data.id)[0].doc_date && !lateDetail.actual_end_date, JSON.stringify({ s: lateDetail.actual_start_date, e: lateDetail.actual_end_date }))
    // 报工分页 + 详情
    const wrp = await get('/api/scm/work-reports?page=1&page_size=2&status=audited')
    assert('㉗ [P1-7] 报工分页视图带合计', Array.isArray(wrp.data.list) && wrp.data.total >= 3 && wrp.data.summary && Number(wrp.data.summary.qty) >= 14, JSON.stringify({ total: wrp.data.total, sum: wrp.data.summary }))
    const one = await get(`/api/scm/work-reports/${wrp.data.list[0].id}`)
    assert('㉗ [P3] GET /work-reports/:id', one.code === 0 && one.data.id === wrp.data.list[0].id && one.data.plan_code, one.message)
    // 工艺路线：同成品第二条启用被拒
    const rt2 = await post('/api/scm/routings', { code: 'RT-FP4-2', item_code: 'FP4', status: 'active', lines: [{ process_name: 'X', std_hours: 1 }] }, { allowError: true })
    assert('㉗ [P2-1] 同成品第二条启用路线被拒', rt2.status === 400 && /已有启用的工艺路线/.test(rt2.message || ''), rt2.message)
    const rt2ok = await post('/api/scm/routings', { code: 'RT-FP4-2', item_code: 'FP4', status: 'inactive', lines: [{ process_name: 'X', std_hours: 1 }] }, { allowError: true })
    assert('㉗ [P2-1] 停用状态可保存', rt2ok.status === 200, rt2ok.message)
    const rts = (await get('/api/scm/routings?item_code=FP4')).data
    assert('㉗ [P3] 路线列表带工序数 / 标准总工时', rts.some(r => r.code === 'RT-FP4' && r.process_count === 3 && Number(r.std_hours_total) === 4), JSON.stringify(rts.map(r => [r.code, r.process_count, r.std_hours_total])))
    // 齐套分配：两张工单同缺一料，分配模式下后序缺口更大
    await ensure('/api/scm/items', { code: 'MK', name: '齐套料', unit: '个', purchase_price: 1, default_warehouse_code: 'W1' })
    const piK = await createDoc({ doc_type: 'PI', doc_date: D, partner_code: 'SUP1', warehouse_code: 'W1', lines: [{ item_code: 'MK', qty: 10, price: 1, tax_rate: 0, tax_amount: 0 }] }); await audit(piK.id)
    const k1 = await post(PL(), { code: 'MO-K1', plan_type: 'self', priority: 9, yl_warehouse: 'W1', fp_warehouse: 'W1', products: [{ item_code: 'FP4', plan_qty: 8, lines: [{ item_code: 'MK', qty: 1 }] }] })
    const k2 = await post(PL(), { code: 'MO-K2', plan_type: 'self', priority: 1, yl_warehouse: 'W1', fp_warehouse: 'W1', products: [{ item_code: 'FP4', plan_qty: 8, lines: [{ item_code: 'MK', qty: 1 }] }] })
    await post(PL(`/${k1.data.id}/release`), {}, { allowError: true }); await post(PL(`/${k2.data.id}/release`), {}, { allowError: true })
    const indep = (await get('/api/scm/production-plans/kitting?plan_type=self')).data
    const alloc = (await get('/api/scm/production-plans/kitting?plan_type=self&mode=allocate')).data
    const iK2 = indep.find(p => p.plan_code === 'MO-K2'); const aK1 = alloc.find(p => p.plan_code === 'MO-K1'); const aK2 = alloc.find(p => p.plan_code === 'MO-K2')
    assert('㉗ [P2-5] 独立模式两张都齐套；分配模式高优先级齐套、低优先级缺 6', iK2?.is_kitted && aK1?.is_kitted && !aK2?.is_kitted && aK2?.materials.find(m => m.item_code === 'MK')?.shortage === 6,
      JSON.stringify({ iK2: iK2?.is_kitted, aK1: aK1?.is_kitted, aK2: aK2?.materials }))
    // 工时差异 / 三张报表
    const cv = (await get(`/api/scm/report/cost-variance?start_date=2026-01-01&end_date=2026-12-31`)).data
    assert('㉗ [P2-8] 标准成本差异带工时字段', Array.isArray(cv) && (cv.length === 0 || ('std_hours' in cv[0] && 'act_hours' in cv[0] && 'hours_efficiency' in cv[0])), JSON.stringify(cv[0] || {}).slice(0, 200))
    const hrs = (await get(`/api/scm/report/production/hours?group_by=work_center&start_date=2026-01-01&end_date=2026-12-31`)).data
    const wc1 = hrs.rows.find(r => r.group_key === 'WC1')
    // MO-PROC 三道各 1 工时：下料 5 件×1h + 焊接 5×1h + 总装 5(4+1)×2h = 20 标准工时 vs 3 实际
    assert('㉗ [C-4①] 工时统计按工作中心：实际 3h、标准 20h', wc1 && wc1.work_hours === 3 && wc1.std_hours === 20 && wc1.report_count === 3, JSON.stringify(wc1))
    const daily = (await get(`/api/scm/report/production/daily?start_date=2026-01-01&end_date=2026-12-31`)).data
    assert('㉗ [C-4②] 生产日报有行且报工合格合计 ≥ 14', daily.rows.length > 0 && Number(daily.summary.report_qty) >= 14 && Number(daily.summary.issue_qty) > 0, JSON.stringify(daily.summary))
    const cost = (await get('/api/scm/report/production/cost?page=1&page_size=50&plan_code=MO-LATE')).data
    assert('㉗ [C-4③] 工单成本明细：MO-LATE 料成本 = 领料 2 件成本、在制 = 料成本', cost.rows.length === 1 && cost.rows[0].material_cost > 0 && cost.rows[0].material_wip === cost.rows[0].material_cost && cost.rows[0].finished_qty === 0, JSON.stringify(cost.rows[0]))
    const xls = await fetch(`${BASE}/api/scm/report/production/cost/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })
    assert('㉗ [C-4③] 工单成本明细导出 xlsx', xls.status === 200 && /spreadsheet/.test(xls.headers.get('content-type') || ''), String(xls.status))
  }

  // ── ㉘ 生产阶段 C1：工单变更单 ─────────────────────────────────────
  {
    const PL = (p) => `/api/scm/production-plans${p || ''}`
    // MO-LATE：计划 2、已领 M1 2（1×2）；用料 M1 qty 1
    const late = (await get(PL('?page=1&page_size=50&keyword=MO-LATE'))).data.list[0]
    const base = (await get(PL(`/${late.id}/change-base`))).data
    assert('㉘ 变更单基础数据：快照 + 已领量', base.snapshot.products.length === 1 && base.issued.M1 === 2 && base.draft === null, JSON.stringify(base.issued))
    const prod = base.snapshot.products[0]
    // 减到 1 → M1 需求 1 < 已领 2 → 拒
    const tooLow = await post('/api/scm/plan-changes', { plan_id: late.id, reason: '减产', products: [{ id: prod.id, item_code: prod.item_code, plan_qty: 1, lines: prod.lines }] }, { allowError: true })
    assert('㉘ [C-1] 减到低于已领用被拒（先退料）', tooLow.status === 400 && /低于已领用 2，请先退料/.test(tooLow.message || ''), tooLow.message)
    // 无差异 → 拒
    const same = await post('/api/scm/plan-changes', { plan_id: late.id, reason: '无', head: base.snapshot.head, products: [{ id: prod.id, item_code: prod.item_code, plan_qty: prod.plan_qty, lines: prod.lines }] }, { allowError: true })
    assert('㉘ [C-1] 与当前工单一致时拒绝建单', same.status === 400 && /无需变更/.test(same.message || ''), same.message)
    // 追加到 5、交期改到年底、新增用料 M2 0.5 → 草稿
    const pc = await post('/api/scm/plan-changes', { plan_id: late.id, reason: '客户追加', head: { end_date: '2026-12-31' },
      products: [{ id: prod.id, item_code: prod.item_code, plan_qty: 5, lines: [...prod.lines, { item_code: 'M2', qty: 0.5 }] }] }, { allowError: true })
    assert('㉘ [C-1] 变更单保存为草稿并返回差异', pc.status === 200 && pc.data.change_no && pc.data.diff.length === 3, JSON.stringify(pc.data?.diff))
    const dup = await post('/api/scm/plan-changes', { plan_id: late.id, reason: 'x', products: [{ id: prod.id, item_code: prod.item_code, plan_qty: 6, lines: prod.lines }] }, { allowError: true })
    assert('㉘ [C-1] 同一工单只允许一张草稿变更单', dup.status === 400 && /已有未审核的变更单/.test(dup.message || ''), dup.message)
    const beforePlan = (await get(PL(`/${late.id}`))).data.plan
    assert('㉘ [C-1] 草稿未生效：工单计划数仍为 2', Number(beforePlan.plan_qty) === 2 && beforePlan.end_date === '2026-01-31')
    const au = await post(`/api/scm/plan-changes/${pc.data.id}/audit`, {}, { allowError: true })
    assert('㉘ [C-1] 审核生效', au.code === 0, au.message)
    const afterDetail = (await get(PL(`/${late.id}`))).data
    const p0 = afterDetail.products[0]
    assert('㉘ [C-1] 工单已更新：计划 5、交期 12-31、成品 id 保留、用料含 M2、逾期标记消失', Number(afterDetail.plan.plan_qty) === 5 && afterDetail.plan.end_date === '2026-12-31' && p0.id === prod.id && p0.bom_lines.some(l => l.item_code === 'M2') && afterDetail.changes.length === 1 && afterDetail.changes[0].status === 'audited',
      JSON.stringify({ qty: afterDetail.plan.plan_qty, end: afterDetail.plan.end_date, lines: p0.bom_lines.map(l => l.item_code) }))
    const sug = (await get(PL(`/${late.id}/issue-suggestion`))).data
    assert('㉘ [C-1] 领料建议按新用料：M1 需求 5 已领 2、M2 需求 2.5', sug.lines.find(l => l.item_code === 'M1')?.suggest === 3 && sug.lines.find(l => l.item_code === 'M2')?.need === 2.5, JSON.stringify(sug.lines.map(l => [l.item_code, l.need, l.issued])))
    const noUnaudit = await api('DELETE', `/api/scm/plan-changes/${pc.data.id}`, undefined, { allowError: true })
    assert('㉘ [C-1] 已审核变更单不可删除', noUnaudit.status === 400, noUnaudit.message)
    const list = (await get('/api/scm/plan-changes?page=1&page_size=20&keyword=MO-LATE')).data
    assert('㉘ [C-1] 变更单列表带差异摘要', list.total === 1 && /计划数/.test(list.list[0].diff_summary), JSON.stringify(list.list[0]?.diff_summary))
    // 已关闭工单不可变更
    const closedPlan = (await get(PL('?page=1&page_size=50&keyword=MO-SNAP'))).data.list[0]
    const cc = await post('/api/scm/plan-changes', { plan_id: closedPlan.id, reason: 'x', products: [{ item_code: 'FP4', plan_qty: 9, lines: [{ item_code: 'M1', qty: 1 }] }] }, { allowError: true })
    assert('㉘ [C-1] 已关闭工单不可变更', cc.status === 400 && /仅已审核工单可做变更/.test(cc.message || ''), cc.message)
  }

  // ── ㉙ 生产阶段 C2：工单工序快照 / 流转校验 / 工序在制 / 产能负荷 / 交期推算 ────
  {
    const PL = (p) => `/api/scm/production-plans${p || ''}`
    // 工作中心日产能
    const wcs = (await get('/api/scm/work-centers')).data
    const wc1 = wcs.find(w => w.code === 'WC1')
    const upWc = await api('PUT', `/api/scm/work-centers/${wc1.id}`, { ...wc1, daily_capacity_hours: 8 }, { allowError: true })
    assert('㉙ [C-3] 工作中心可维护日产能', upWc.code === 0 && (await get('/api/scm/work-centers')).data.find(w => w.code === 'WC1').daily_capacity_hours === 8, upWc.message)
    // 新工单（FP4 有 3 道工序路线）下达 → 工序快照
    const mo = await post(PL(), { code: 'MO-PROC2', plan_type: 'self', yl_warehouse: 'W1', fp_warehouse: 'W1', end_date: '2026-10-30', products: [{ item_code: 'FP4', plan_qty: 4, lines: [{ item_code: 'M1', qty: 1 }] }] })
    await post(PL(`/${mo.data.id}/release`), {}, { allowError: true })
    const det = (await get(PL(`/${mo.data.id}`))).data
    assert('㉙ [C-2] 下达后按工艺路线快照 3 道工序，计划数 4', det.processes.length === 3 && det.processes.every(x => x.plan_qty === 4) && det.processes.map(x => x.process_name).join() === '下料,焊接,总装', JSON.stringify(det.processes.map(x => [x.seq, x.process_name, x.plan_qty])))
    assert('㉙ [C-3] 交期推算：剩余 (1+1+2)×4=16h ÷ 8 = 2 天', det.schedule && det.schedule.remain_hours === 16 && det.schedule.est_days === 2, JSON.stringify(det.schedule))
    const prodId = det.products[0].id
    const wr = async (process, qty, scrap = 0) => post('/api/scm/work-reports', { plan_id: mo.data.id, product_id: prodId, item_code: 'FP4', process_name: process, work_center_code: 'WC1', work_hours: 1, qty, scrap_qty: scrap }, { allowError: true })
    // 流转：前道未审核完成 → 后道被拒
    const early = await wr('焊接', 1)
    assert('㉙ [C-2] 前道未完成时后道报工被拒', early.status === 400 && /超过前道「下料」已审核完成数 0/.test(early.message || ''), early.message)
    const r1 = await wr('下料', 3, 1)
    assert('㉙ [C-2] 报工挂到工序行（process_id）', r1.status === 200 && r1.data.process_id, JSON.stringify(r1.data))
    await post(`/api/scm/work-reports/${r1.data.id}/audit`, {}, { allowError: true })
    const r2w = await wr('焊接', 3)
    assert('㉙ [C-2] 前道完成 3 后后道可报 3', r2w.status === 200, r2w.message)
    const over = await wr('焊接', 1)
    assert('㉙ [C-2] 后道累计 4 > 前道完成 3 被拒（草稿也占用）', over.status === 400 && /累计报工 4 超过前道/.test(over.message || ''), over.message)
    // 反审核前道：后道已报 3，前道完成回到 0 → 拒
    const unA = await post(`/api/scm/work-reports/${r1.data.id}/unaudit`, {}, { allowError: true })
    assert('㉙ [C-2] 后道已报工时前道不可反审核', unA.status === 400 && /后道工序「焊接」已报工 3/.test(unA.message || ''), unA.message)
    await post(`/api/scm/work-reports/${r2w.data.id}/audit`, {}, { allowError: true })
    const wip = (await get(`/api/scm/report/production/process-wip?plan_code=MO-PROC2`)).data
    assert('㉙ [C-4④] 工序在制表：下料 转入4 完成3 不良1 在制0；焊接 转入3 完成3 在制0；总装 转入3 在制3', JSON.stringify(wip.map(x => [x.process_name, x.in_qty, x.done_qty, x.scrap_qty, x.wip_qty])) === JSON.stringify([['下料', 4, 3, 1, 0], ['焊接', 3, 3, 0, 0], ['总装', 3, 0, 0, 3]]), JSON.stringify(wip.map(x => [x.process_name, x.in_qty, x.done_qty, x.scrap_qty, x.wip_qty])))
    const cap = (await get('/api/scm/report/production/capacity')).data
    const wk = cap.rows.find(r => r.work_center_code === 'WC1' && r.plans.includes('MO-PROC2'))
    assert('㉙ [C-3] 产能负荷表：WC1 该周含 MO-PROC2 剩余工时（总装 3×2=6h 等）', wk && wk.capacity_hours === 40 && wk.load_hours >= 6 && wk.utilization != null, JSON.stringify(cap.rows))
    // 关闭流转校验后可超报
    const cur = (await get('/api/scm/params')).data
    const list = Array.isArray(cur) ? cur : (cur.list || [])
    await api('PUT', '/api/scm/params', { params: [...list.filter(p => p.param_key !== 'scm:process_flow_strict'), { param_key: 'scm:process_flow_strict', param_value: '0' }] }, { allowError: true })
    const loose = await wr('总装', 4)
    assert('㉙ [决策 1] 关闭工序流转校验后仅受计划数约束', loose.status === 200, loose.message)
    await api('PUT', '/api/scm/params', { params: [...list.filter(p => p.param_key !== 'scm:process_flow_strict'), { param_key: 'scm:process_flow_strict', param_value: '1' }] }, { allowError: true })
    // 变更单追加计划数 → 工序行计划数同步
    const pc = await post('/api/scm/plan-changes', { plan_id: mo.data.id, reason: '追加', products: [{ id: prodId, item_code: 'FP4', plan_qty: 6, lines: [{ item_code: 'M1', qty: 1 }] }] }, { allowError: true })
    await post(`/api/scm/plan-changes/${pc.data.id}/audit`, {}, { allowError: true })
    const det2 = (await get(PL(`/${mo.data.id}`))).data
    assert('㉙ [C-2] 变更单审核后工序行计划数同步为 6', det2.processes.every(x => x.plan_qty === 6), JSON.stringify(det2.processes.map(x => x.plan_qty)))
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

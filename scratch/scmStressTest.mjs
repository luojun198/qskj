/**
 * 进销存 / 生产 压力测试（数据量大时列表刷新、报表、导出是否卡慢）
 *
 * 用法：node scratch/scmStressTest.mjs [--docs=30000] [--items=3000] [--plans=3000]
 *  1. 复制开发库到临时目录，直接用 SQL 批量造数（物料 / 往来 / 单据 + 明细 + 库存流水 + 往来台账 / 工单 + 报工）
 *  2. 起真实服务（端口 3199），逐个接口计时；> WARN_MS 标黄，> FAIL_MS 标红
 *  3. 输出耗时表；退出码 = 红项数
 */
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([a-z]+)=(.+)$/); return m ? [m[1], Number(m[2])] : [a, true] }))
const N_DOCS = args.docs || 30000
const N_ITEMS = args.items || 3000
const N_PLANS = args.plans || 3000
const LINES_PER_DOC = 5
const WARN_MS = 1500, FAIL_MS = 5000

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-scm-stress')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3199
const BASE = `http://127.0.0.1:${PORT}`
const AID = '1409b0d2-7e8c-4e27-ab5f-5e143be3e89d'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function prepDb() {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true }); await src.backup(TEMP_DB); src.close()
}

/** 直接 SQL 造数 */
function seed() {
  const db = new Database(TEMP_DB)
  db.pragma('journal_mode = WAL'); db.pragma('synchronous = OFF')
  const t0 = Date.now()
  const uuid = () => randomUUID()
  const dateOf = i => { const d = new Date(2026, 0, 1 + (i % 260)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  db.transaction(() => {
    // 仓库 / 往来 / 物料
    const insW = db.prepare("INSERT OR IGNORE INTO scm_warehouse (id,account_set_id,code,name) VALUES (?,?,?,?)")
    for (let i = 1; i <= 5; i++) insW.run(uuid(), AID, `SW${i}`, `压测仓${i}`)
    const insP = db.prepare("INSERT OR IGNORE INTO scm_partner (id,account_set_id,code,name,partner_type,ar_account,ap_account,enabled) VALUES (?,?,?,?,?,'1122','2202',1)")
    for (let i = 1; i <= 300; i++) insP.run(uuid(), AID, `SP${String(i).padStart(4, '0')}`, `压测往来${i}`, i % 2 ? 'supplier' : 'customer')
    const insI = db.prepare("INSERT OR IGNORE INTO scm_item (id,account_set_id,code,name,spec,unit,purchase_price,sale_price,source_type,enabled,is_leaf,level,default_warehouse_code,field_values) VALUES (?,?,?,?,?,'个',?,?,?,1,1,1,'SW1','{}')")
    for (let i = 1; i <= N_ITEMS; i++) insI.run(uuid(), AID, `SI${String(i).padStart(5, '0')}`, `压测物料${i}`, `规格${i % 50}`, 10 + (i % 90), 20 + (i % 150), i % 10 === 0 ? 'self' : 'purchase')
    // 单据 + 明细 + 库存流水 + 往来
    const types = ['PI', 'SO', 'PL', 'PF', 'TR', 'PO', 'SOa', 'PR', 'SR']
    const insD = db.prepare(`INSERT INTO scm_doc (id,account_set_id,doc_type,doc_no,doc_date,partner_code,warehouse_code,operator,maker,status,total_qty,total_amount,total_tax,remark,auditor,audited_at,field_values,created_at)
      VALUES (?,?,?,?,?,?,?,'压测','压测',?,?,?,?,?,?,?,'{}',datetime('now'))`)
    const insL = db.prepare(`INSERT INTO scm_doc_line (id,account_set_id,doc_id,seq,item_code,warehouse_code,qty,price,amount,tax_rate,tax_amount,unit_cost,field_values) VALUES (?,?,?,?,?,?,?,?,?,13,?,?,'{}')`)
    const insM = db.prepare(`INSERT INTO scm_stock_move (id,account_set_id,move_date,doc_type,doc_no,line_seq,warehouse_code,item_code,direction,qty,unit_cost,amount,balance_qty,balance_amount,balance_avg_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,0)`)
    const insA = db.prepare(`INSERT INTO scm_ar_ap_log (id,account_set_id,partner_code,doc_type,doc_no,doc_date,due_date,direction,amount,ar_account,ap_account,verified_amount,currency,exchange_rate,amount_fc,verified_fc) VALUES (?,?,?,?,?,?,?,'in',?,'1122','2202',0,'CNY',1,?,0)`)
    const stock = new Map()
    for (let i = 0; i < N_DOCS; i++) {
      const t = types[i % types.length]
      const id = uuid(); const date = dateOf(i)
      const no = `${date.slice(0, 4)}${date.slice(5, 7)}-${t}-${String(i).padStart(6, '0')}`
      const partner = `SP${String(1 + (i % 300)).padStart(4, '0')}`
      const wh = `SW${1 + (i % 5)}`
      const status = i % 7 === 0 ? 'draft' : 'audited'
      let tq = 0, ta = 0, tt = 0
      const lines = []
      for (let s = 1; s <= LINES_PER_DOC; s++) {
        const it = `SI${String(1 + ((i * 7 + s * 13) % N_ITEMS)).padStart(5, '0')}`
        const qty = 1 + ((i + s) % 20); const price = 10 + ((i * s) % 200); const amt = qty * price
        lines.push({ s, it, qty, price, amt })
        tq += qty; ta += amt; tt += Math.round(amt * 13) / 100
      }
      insD.run(id, AID, t, no, date, partner, wh, status, tq, ta, tt, i % 11 === 0 ? `压测备注${i}` : null, status === 'audited' ? '压测' : null, status === 'audited' ? date + ' 10:00:00' : null)
      const affectsStock = ['PI', 'SO', 'PL', 'PF', 'TR', 'PR', 'SR'].includes(t)
      const dir = ['PI', 'PF', 'SR'].includes(t) ? 'in' : 'out'
      for (const l of lines) {
        insL.run(uuid(), AID, id, l.s, l.it, wh, l.qty, l.price, l.amt, Math.round(l.amt * 13) / 100, l.price)
        if (status === 'audited' && affectsStock) {
          insM.run(uuid(), AID, date, t, no, l.s, wh, l.it, dir, l.qty, l.price, l.amt)
          const k = `${wh}|${l.it}`; const st = stock.get(k) || { qty: 0, amt: 0 }
          st.qty += dir === 'in' ? l.qty : -l.qty; st.amt += dir === 'in' ? l.amt : -l.amt; stock.set(k, st)
        }
      }
      if (status === 'audited' && (t === 'PI' || t === 'SO')) insA.run(uuid(), AID, partner, t, no, date, date, ta + tt, ta + tt)
    }
    const insS = db.prepare("INSERT OR REPLACE INTO scm_stock (id,account_set_id,warehouse_code,item_code,qty,amount,avg_cost) VALUES (?,?,?,?,?,?,?)")
    for (const [k, st] of stock) { const [wh, it] = k.split('|'); const q = Math.max(st.qty, 1); insS.run(uuid(), AID, wh, it, q, Math.max(st.amt, q * 10), Math.max(st.amt, q * 10) / q) }
    // 工单 + 成品 + 用料 + 报工
    const insPl = db.prepare("INSERT INTO scm_production_plan (id,account_set_id,code,item_code,plan_qty,start_date,end_date,status,plan_type,yl_warehouse,fp_warehouse,priority,finished_qty) VALUES (?,?,?,?,?,?,?,?,'self','SW1','SW2',?,0)")
    const insPp = db.prepare("INSERT INTO scm_production_plan_product (id,account_set_id,plan_id,seq,item_code,plan_qty,fp_warehouse,finished_qty,scrap_qty) VALUES (?,?,?,1,?,?,'SW2',0,0)")
    const insPlL = db.prepare("INSERT INTO scm_production_plan_line (id,account_set_id,plan_id,product_id,seq,item_code,qty,scrap_rate) VALUES (?,?,?,?,?,?,?,0)")
    const insWr = db.prepare("INSERT INTO scm_work_report (id,account_set_id,plan_id,product_id,report_no,report_date,item_code,process_name,work_center_code,qty,scrap_qty,work_hours,labor_amount,overhead_amount,status) VALUES (?,?,?,?,?,?,?,'总装',NULL,?,0,1,20,10,'audited')")
    for (let i = 0; i < N_PLANS; i++) {
      const id = uuid(); const pid = uuid(); const fp = `SI${String(1 + ((i * 10) % N_ITEMS)).padStart(5, '0')}`
      const status = i % 3 === 0 ? 'closed' : 'released'
      insPl.run(id, AID, `SPP-${String(i).padStart(5, '0')}`, fp, 10, dateOf(i), dateOf(i + 20), status, i % 9)
      insPp.run(pid, AID, id, fp, 10)
      for (let s = 1; s <= 4; s++) insPlL.run(uuid(), AID, id, pid, s, `SI${String(1 + ((i * 3 + s) % N_ITEMS)).padStart(5, '0')}`, s)
      for (let r = 0; r < 3; r++) insWr.run(uuid(), AID, id, pid, `SWR-${i}-${r}`, dateOf(i + r), fp, 3)
    }
  })()
  const counts = {}
  for (const t of ['scm_doc', 'scm_doc_line', 'scm_stock_move', 'scm_stock', 'scm_ar_ap_log', 'scm_production_plan', 'scm_work_report']) counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c
  db.close()
  console.log(`造数完成 ${Date.now() - t0}ms：`, JSON.stringify(counts))
  return counts
}

let child, log = ''
async function startServer() {
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], { cwd: join(ROOT, 'server'), env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', d => { log += d.toString() }); child.stderr.on('data', d => { log += d.toString() })
  const t0 = Date.now()
  while (Date.now() - t0 < 120000) { try { const r = await fetch(`${BASE}/api/auth/account-sets`); if (r.ok) return } catch { /* */ } await sleep(700) }
  console.log(log.slice(-3000)); throw new Error('server did not start')
}

let token = ''
const rows = []
async function timeIt(name, method, path, body, opts = {}) {
  const t0 = performance.now()
  let status = 0, size = 0, note = ''
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(opts.timeout || 60000) })
    status = r.status
    const buf = Buffer.from(await r.arrayBuffer()); size = buf.length
    if (opts.note) { try { note = opts.note(JSON.parse(buf.toString('utf8'))) } catch { note = '' } }
    if (opts.binary) note = `${(size / 1024 / 1024).toFixed(2)} MB`
  } catch (e) { note = 'ERR ' + (e.name === 'TimeoutError' ? '超时(60s)，服务被同步查询阻塞' : (e.message || e)) }
  const ms = Math.round(performance.now() - t0)
  const level = ms > FAIL_MS || status >= 500 || status === 0 ? 'FAIL' : ms > WARN_MS ? 'WARN' : 'ok'
  rows.push({ name, ms, status, size, note, level })
  console.log(`${level.padEnd(4)} ${String(ms).padStart(6)}ms  ${String(status).padStart(3)}  ${(size / 1024).toFixed(0).padStart(7)}KB  ${name}${note ? '  — ' + note : ''}`)
  return ms
}

async function main() {
  await prepDb()
  const counts = seed()
  await startServer()
  const lr = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: AID }) }).then(x => x.json())
  token = lr.token; if (!token) throw new Error('login failed')
  const listNote = d => `total=${d.data?.total ?? d.data?.length}`
  const D1 = '2026-01-01', D2 = '2026-12-31'

  console.log('\n── 单据列表 / 详情 ──')
  await timeIt('预热（单据类型）', 'GET', '/api/scm/docs/types')
  await timeIt('单据列表 第1页（无筛选）', 'GET', '/api/scm/docs?page=1&page_size=30', undefined, { note: listNote })
  await timeIt('单据列表 第1页（无筛选，二次）', 'GET', '/api/scm/docs?page=1&page_size=30', undefined, { note: listNote })
  await timeIt('单据列表 第1页 doc_type=PI', 'GET', '/api/scm/docs?doc_type=PI&page=1&page_size=30', undefined, { note: listNote })
  await timeIt('单据列表 末页（OFFSET 大）', 'GET', `/api/scm/docs?page=${Math.ceil(N_DOCS / 30)}&page_size=30`, undefined, { note: listNote })
  await timeIt('单据列表 关键字模糊', 'GET', '/api/scm/docs?keyword=%E5%8E%8B%E6%B5%8B%E5%A4%87%E6%B3%A8&page=1&page_size=30', undefined, { note: listNote })
  await timeIt('单据列表 预收预付筛选', 'GET', '/api/scm/docs?doc_type=RCV&payment_mode=advance&page=1&page_size=30', undefined, { note: listNote })
  await timeIt('单据翻页 ids（全量 id 数组）', 'GET', '/api/scm/docs/ids?doc_type=SO', undefined, { note: d => `ids=${d.data?.length}` })
  const one = await fetch(`${BASE}/api/scm/docs?doc_type=PI&status=audited&page=1&page_size=1`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
  const docId = one.data.list[0].id
  await timeIt('单据详情', 'GET', `/api/scm/docs/${docId}`)
  await timeIt('单据上下游', 'GET', `/api/scm/docs/${docId}/downstream`)
  await timeIt('单据成本明细', 'GET', `/api/scm/docs/${docId}/cost-detail`)

  console.log('\n── 库存 ──')
  await timeIt('库存查询（全部，数组）', 'GET', '/api/scm/stock', undefined, { note: listNote })
  await timeIt('库存查询（分页）', 'GET', '/api/scm/stock?page=1&page_size=50', undefined, { note: listNote })
  await timeIt('库存查询 keyword', 'GET', '/api/scm/stock?keyword=SI00001', undefined, { note: listNote })
  await timeIt('收发存汇总（全年）', 'GET', `/api/scm/stock/summary?start_date=${D1}&end_date=${D2}`)
  await timeIt('收发存汇总（单仓）', 'GET', `/api/scm/stock/summary?start_date=${D1}&end_date=${D2}&warehouse_code=SW1`)
  await timeIt('库存明细账 第1页（全年）', 'GET', `/api/scm/stock/ledger?start_date=${D1}&end_date=${D2}&page=1&page_size=50`, undefined, { note: listNote })
  await timeIt('库存明细账 单物料', 'GET', `/api/scm/stock/ledger?start_date=${D1}&end_date=${D2}&item_code=SI00001&page=1&page_size=50`, undefined, { note: listNote })
  await timeIt('库存明细账 导出（全年全部）', 'POST', '/api/scm/stock/ledger/export', { start_date: D1, end_date: D2 }, { binary: true })
  await timeIt('库存预警', 'GET', '/api/scm/report/stock-alert')
  await timeIt('库存成本层', 'GET', '/api/scm/stock/layers')
  await timeIt('齐套分析（分配模式）', 'GET', '/api/scm/production-plans/kitting?plan_type=self&mode=allocate', undefined, { note: d => `plans=${d.data?.length}` })

  console.log('\n── 往来 ──')
  await timeIt('往来单位台账', 'GET', '/api/scm/arap/SP0001')
  await timeIt('往来账龄', 'GET', '/api/scm/arap-aging')
  await timeIt('往来余额汇总', 'GET', '/api/scm/arap')
  await timeIt('付款源单', 'GET', '/api/scm/arap/payment-sources?partner_code=SP0001&payment_doc_type=PAY')

  console.log('\n── 生产 ──')
  await timeIt('工单列表 第1页（分页）', 'GET', '/api/scm/production-plans?page=1&page_size=50&plan_type=self', undefined, { note: listNote })
  await timeIt('工单列表 数组形态（旧选择器）', 'GET', '/api/scm/production-plans', undefined, { note: listNote })
  await timeIt('工单列表 关键字', 'GET', '/api/scm/production-plans?page=1&page_size=50&keyword=SPP-0010', undefined, { note: listNote })
  const plan = (await fetch(`${BASE}/api/scm/production-plans?page=1&page_size=1&status=released`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())).data.list[0]
  await timeIt('工单详情', 'GET', `/api/scm/production-plans/${plan.id}`)
  await timeIt('报工列表 第1页', 'GET', '/api/scm/work-reports?page=1&page_size=50', undefined, { note: listNote })
  await timeIt('生产执行及在制结存表 第1页', 'GET', '/api/scm/report/production/execution?page=1&page_size=50', undefined, { note: listNote })
  await timeIt('生产执行表 导出全部', 'POST', '/api/scm/report/production/execution/export', {}, { binary: true })
  await timeIt('工单成本明细表 第1页', 'GET', '/api/scm/report/production/cost?page=1&page_size=50', undefined, { note: listNote })
  await timeIt('工单成本明细表 导出全部', 'POST', '/api/scm/report/production/cost/export', {}, { binary: true })
  await timeIt('工时统计（按工作中心 全年）', 'GET', `/api/scm/report/production/hours?start_date=${D1}&end_date=${D2}`)
  await timeIt('生产日报（全年）', 'GET', `/api/scm/report/production/daily?start_date=${D1}&end_date=${D2}`)
  await timeIt('标准成本差异（全年）', 'GET', `/api/scm/report/cost-variance?start_date=${D1}&end_date=${D2}`)
  await timeIt('自动排程 试算', 'POST', '/api/scm/schedule/run', { dry_run: true }, { note: d => `plans=${d.data?.plan_count}` })
  await timeIt('销售订单执行表', 'GET', '/api/scm/report/sales/execution?status=all&page=1&page_size=50', undefined, { note: listNote })
  await timeIt('销售订单关联表 第1页', 'GET', '/api/scm/sales-order-relations?page=1&page_size=20', undefined, { note: d => `roots=${d.data?.roots?.length}` })

  console.log('\n── 销售 / 采购报表 ──')
  await timeIt('销售汇总（固定报表 全年）', 'POST', '/api/scm/report/sales/fixed-query', { report_code: 'summary', start_date: D1, end_date: D2 })
  // 原路径 /api/scm/report/purchase/order-tracking 是前端页面路径，接口不存在（404），从未真正测到
  await timeIt('采购订单执行表', 'POST', '/api/scm/report/purchase/fixed-query', { report_code: 'order_tracking', start_date: D1, end_date: D2 })

  const fails = rows.filter(r => r.level === 'FAIL'), warns = rows.filter(r => r.level === 'WARN')
  console.log(`\n==== 数据量：${JSON.stringify(counts)}`)
  console.log(`==== ${rows.length} 项接口，红（>${FAIL_MS}ms 或 5xx）${fails.length} 项，黄（>${WARN_MS}ms）${warns.length} 项 ====`)
  for (const r of [...fails, ...warns].sort((a, b) => b.ms - a.ms)) console.log(`  ${r.level} ${r.ms}ms ${r.status} ${r.name} ${r.note}`)
  return fails.length
}

let exitCode = 1
try { exitCode = await main() } catch (e) { console.error('ERROR:', e?.message || e); console.log(log.slice(-3000)) } finally { if (child) child.kill() }
process.exit(exitCode)

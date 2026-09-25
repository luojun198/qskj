/**
 * 总账 / 凭证 / 出纳 十万级压力测试
 *
 * 用法：node scratch/glStressTest.mjs [--vouchers=100000] [--cashier=100000] [--batch=3000] [--export=100000]
 *  1. 复制开发库到临时目录，SQL 批量造数（凭证 + 分录 + 出纳流水 + 部门辅助）
 *  2. 起真实服务（端口 3199），逐个接口计时（3 次取中位）；> WARN_MS 标黄，> FAIL_MS 标红
 *  3. 覆盖：页面刷新（分页查询）、汇总报表、导出（全量拉取 + 服务端 xlsx）、导入（出纳/银行对账单）、批量审核过账、并发
 *  4. 输出耗时表 + Node 服务进程 RSS 采样；退出码 = 红项数
 */
import Database from 'better-sqlite3'
import { spawn, execSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([a-z]+)=(.+)$/); return m ? [m[1], isNaN(Number(m[2])) ? m[2] : Number(m[2])] : [a, true] }))
const N_VOUCHERS = args.vouchers || 100000
const N_CASHIER = args.cashier || 100000
const N_BATCH = args.batch || 3000
const N_EXPORT = args.export || 100000
const WARN_MS = 1500, FAIL_MS = 5000
/**
 * --target=dev：直接在开发库「测试」账套造数并压测正在运行的开发服务（3105），数据保留供人工复查。
 *   - 执行前用 SQLite 备份接口完整备份开发库；已有压测数据则拒绝重复造数
 *   - 已记账凭证落在 9 月（账套 2026-09-01 启用）；批量审核 / 记账样本放在 10 月，不碰账套原有的 9 月草稿
 *   - 单独建「压测凭证」类型，不占用「记账凭证」编号；造数后重建科目余额汇总表
 * 不传则保持原行为：复制开发库到临时目录、另起 3199 服务。
 */
const TARGET_DEV = args.target === 'dev'
/**
 * --reuse（仅 dev）：复用已造好的压测数据复测，不再整批造数；只在 --batchmonth（默认 11）月新插 N_BATCH 张草稿供批量审核 / 记账。
 * 建议配合 --stages=ABCEF（跳过会再灌 20 万行出纳数据的导入阶段）。
 */
const REUSE = TARGET_DEV && !!args.reuse
const BATCH_MONTH = String(args.batchmonth || 11).padStart(2, '0')

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'cw-gl-stress')
const TEMP_DB = TARGET_DEV ? SRC_DB : join(WORK, 'finance.db')
const SERVER_LOG = join(WORK, 'server.log')
const PORT = TARGET_DEV ? 3105 : 3199
const BASE = `http://127.0.0.1:${PORT}`
const AID = TARGET_DEV ? '1409b0d2-7e8c-4e27-ab5f-5e143be3e89d' /* 测试 */ : '96e41c72-0699-45b0-ad49-35048b1e875e'
const BATCH_RANGE = TARGET_DEV
  ? (args.reuse ? [`2026-${String(args.batchmonth || 11).padStart(2, '0')}-01`, `2026-${String(args.batchmonth || 11).padStart(2, '0')}-${new Date(2026, Number(args.batchmonth || 11), 0).getDate()}`] : ['2026-10-01', '2026-10-31'])
  : ['2026-09-01', '2026-09-30']
const sleep = ms => new Promise(r => setTimeout(r, ms))
const dateOf = i => {
  if (TARGET_DEV) return `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`
  const d = new Date(2026, i % 12, 1 + (i % 28)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let rssExport = null
function round2n(n) { return Math.round(n * 100) / 100 }

// ── 工具 ──
const fmt = n => (n == null ? '-' : typeof n === 'string' ? n : n.toLocaleString('zh-CN'))
function rssOf(port) {
  try {
    const pid = execSync(`powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    if (!pid) return null
    const mb = execSync(`powershell -NoProfile -Command "[math]::Round((Get-Process -Id ${pid}).WorkingSet64/1MB,0)"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return Number(mb)
  } catch { return null }
}
function median(arr) { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

// ── 造数 ──
function prepDb() {
  rmSync(WORK, { recursive: true, force: true }); mkdirSync(WORK, { recursive: true })
  if (REUSE) return Promise.resolve()
  if (TARGET_DEV) {
    const chk = new Database(SRC_DB, { readonly: true })
    const existed = chk.prepare("SELECT COUNT(*) c FROM vouchers WHERE account_set_id=? AND maker_name='压测'").get(AID).c
    if (existed > 0) { chk.close(); throw new Error(`测试账套已有 ${existed} 张压测凭证，拒绝重复造数（如需重来请先从备份恢复）`) }
    const bak = join(ROOT, 'data', 'finance-0523.bak-20260925-preGlStress.db')
    console.log(`开发库备份 → ${bak}`)
    return chk.backup(bak).then(() => chk.close())
  }
  const src = new Database(SRC_DB, { readonly: true })
  return src.backup(TEMP_DB).then(() => src.close())
}

/** --reuse：只补批量操作用的草稿凭证（沿用首次造数的科目与「压测凭证」类型） */
function seedBatchOnly() {
  const db = new Database(TEMP_DB)
  const round2 = n => Math.round(n * 100) / 100
  const leafs = db.prepare("SELECT a.id, a.code, a.name, a.direction FROM accounts a WHERE a.account_set_id=? AND a.is_enabled=1 AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.account_set_id=a.account_set_id AND c.parent_id=a.id) ORDER BY a.code").all(AID)
  const debtors = leafs.filter(a => a.direction === 'debit'), creditors = leafs.filter(a => a.direction === 'credit')
  const cashAcc = db.prepare("SELECT id, code, name FROM accounts WHERE account_set_id=? AND code LIKE '1001%' AND is_enabled=1 ORDER BY code LIMIT 1").get(AID)
  const vt = db.prepare("SELECT id FROM voucher_types WHERE account_set_id=? AND name='压测凭证'").get(AID)
  if (!vt) throw new Error('未找到「压测凭证」类型，请先完整造数一次')
  const existing = db.prepare("SELECT COUNT(*) c FROM vouchers WHERE account_set_id=? AND maker_name='压测' AND voucher_date LIKE ?").get(AID, `2026-${BATCH_MONTH}-%`).c
  if (existing > 0) throw new Error(`2026-${BATCH_MONTH} 已有 ${existing} 张压测凭证，请换 --batchmonth`)
  const insV = db.prepare(`INSERT INTO vouchers (id,account_set_id,voucher_no,voucher_type_id,voucher_date,year,period,status,total_amount,maker_name,remark,created_at,updated_at,attachments,source)
    VALUES (?,?,?,?,?,?,?,'draft',?,'压测','压测',datetime('now'),datetime('now'),0,'manual')`)
  const insE = db.prepare(`INSERT INTO voucher_entries (id,account_set_id,voucher_id,seq,account_id,account_code,account_name,direction,amount,amount_cents,summary,currency_code,exchange_rate)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'CNY',1)`)
  const t0 = Date.now()
  db.transaction(() => {
    for (let i = 0; i < N_BATCH; i++) {
      const id = randomUUID()
      const date = `2026-${BATCH_MONTH}-${String(1 + (i % 28)).padStart(2, '0')}`
      const acc = debtors[(i * 7) % debtors.length], accC = creditors[(i * 11) % creditors.length]
      const amt = round2(100 + ((i * 97) % 99900))
      insV.run(id, AID, `压${BATCH_MONTH}-${String(i + 1).padStart(6, '0')}`, vt.id, date, 2026, Number(BATCH_MONTH), amt)
      insE.run(randomUUID(), AID, id, 1, acc.id, acc.code, acc.name, 'debit', amt, Math.round(amt * 100), `批量压测${i}`)
      insE.run(randomUUID(), AID, id, 2, accC.id, accC.code, accC.name, 'credit', amt, Math.round(amt * 100), `批量压测${i}`)
    }
  })()
  console.log(`复用模式：新插 2026-${BATCH_MONTH} 草稿凭证 ${N_BATCH} 张（${(Date.now() - t0) / 1000}s）`)
  db.close()
  return { counts: {}, cashAcc }
}

function seed() {
  if (REUSE) return seedBatchOnly()
  const db = new Database(TEMP_DB)
  db.pragma('journal_mode = WAL'); db.pragma('synchronous = OFF')
  const t0 = Date.now()
  const uuid = () => randomUUID()

  // 末级科目（无下级科目的启用科目）
  const leafs = db.prepare("SELECT a.id, a.code, a.name, a.direction FROM accounts a WHERE a.account_set_id=? AND a.is_enabled=1 AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.account_set_id=a.account_set_id AND c.parent_id=a.id) ORDER BY a.code").all(AID)
  const debtors = leafs.filter(a => a.direction === 'debit')
  const creditors = leafs.filter(a => a.direction === 'credit')
  const cashAcc = db.prepare("SELECT id, code, name FROM accounts WHERE account_set_id=? AND code LIKE '1001%' AND is_enabled=1 ORDER BY code LIMIT 1").get(AID)
  const bankAcc = db.prepare("SELECT id, code, name FROM accounts WHERE account_set_id=? AND (code LIKE '1002%' OR code LIKE '1012%') AND is_enabled=1 ORDER BY code LIMIT 1").get(AID)
  const deptCatId = db.prepare("SELECT id FROM aux_categories WHERE account_set_id=? AND code='dept' LIMIT 1").get(AID)?.id
  // 原实现未按账套过滤，可能取到别的账套的凭证类型
  let voucherType = db.prepare("SELECT id FROM voucher_types WHERE account_set_id=? AND name='记账凭证' LIMIT 1").get(AID)
    || db.prepare("SELECT id FROM voucher_types WHERE name='记账凭证' LIMIT 1").get()
  if (TARGET_DEV) {
    voucherType = db.prepare("SELECT id FROM voucher_types WHERE account_set_id=? AND name='压测凭证'").get(AID)
    if (!voucherType) {
      voucherType = { id: randomUUID() }
      db.prepare("INSERT INTO voucher_types (id, account_set_id, name, code, description, sort_order) VALUES (?, ?, '压测凭证', 'YC', '十万级压测造数专用', 99)").run(voucherType.id, AID)
    }
  }

  console.log(`科目：末级 ${leafs.length}（借 ${debtors.length}/贷 ${creditors.length}），现金 ${cashAcc?.code}，银行 ${bankAcc?.code}`)

  const deptByCode = new Map()
  db.transaction(() => {
    // 部门 500 个
    const insDept = db.prepare("INSERT INTO aux_items (id,account_set_id,type,code,name,status) VALUES (?,?,?,?,?,'active')")
    for (let i = 1; i <= 500; i++) {
      const code = `YCD${String(i).padStart(4, '0')}`
      const id = uuid()
      deptByCode.set(code, { id, name: `压测部门${i}` })
      insDept.run(id, AID, deptCatId, code, `压测部门${i}`)
    }

    // 凭证 + 分录
    const insV = db.prepare(`INSERT INTO vouchers (id,account_set_id,voucher_no,voucher_type_id,voucher_date,year,period,status,total_amount,maker_name,remark,created_at,updated_at,attachments,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,'压测',datetime('now'),datetime('now'),0,'manual')`)
    const insE = db.prepare(`INSERT INTO voucher_entries (id,account_set_id,voucher_id,seq,account_id,account_code,account_name,direction,amount,amount_cents,summary,dept_id,dept_name,currency_code,exchange_rate)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'CNY',1)`)
    const insCB = db.prepare(`INSERT INTO cashier_journal (id,account_set_id,account_code,currency,biz_date,seq,summary,debit,credit,settle_type,bill_no,counter_unit,created_by,created_at)
      VALUES (?,?,?, 'RMB', ?,?,?,?,?,?,?,?, '压测', datetime('now'))`)
    const round2 = n => Math.round(n * 100) / 100
    let eTotal = 0
    for (let i = 0; i < N_VOUCHERS; i++) {
      const id = uuid()
      // 批量操作压测样本：最后 N_BATCH 张固定 9 月且为 draft，其余分散全年 posted
      const isDraft = i >= N_VOUCHERS - N_BATCH
      const date = isDraft ? `2026-${TARGET_DEV ? '10' : '09'}-${String(1 + (i % 28)).padStart(2, '0')}` : dateOf(i)
      const period = Number(date.slice(5, 7))
      const status = isDraft ? 'draft' : 'posted'
      const lines = []
      const nLines = 2 + (i % 2) // 2~3 条分录
      let debitSum = 0
      for (let s = 0; s < nLines - 1; s++) {
        const acc = debtors[(i * 7 + s * 13) % debtors.length]
        const amt = round2(100 + ((i * 97 + s * 911) % 99900) + ((i * 31 + s) % 100) / 100)
        const dept = (i + s) % 3 === 0 ? `YCD${String(1 + ((i + s) % 500)).padStart(4, '0')}` : null
        lines.push({ acc, dir: 'debit', amt, dept })
        debitSum += amt
      }
      // 末条贷方平衡
      const accC = creditors[(i * 11) % creditors.length]
      lines.push({ acc: accC, dir: 'credit', amt: round2(debitSum), dept: null })
      const totalAmt = round2(debitSum)
      insV.run(id, AID, `${TARGET_DEV ? '压' : '记'}-${String(i + 1).padStart(8, '0')}`, voucherType.id, date, 2026, period, status, totalAmt, '压测')
      let seq = 1
      for (const l of lines) {
        const deptItem = l.dept ? deptByCode.get(l.dept) : null
        insE.run(uuid(), AID, id, seq++, l.acc.id, l.acc.code, l.acc.name, l.dir, l.amt, Math.round(l.amt * 100), `压测摘要${i}`, deptItem?.id || null, deptItem?.name || null)
      }
      // 出纳流水（借/贷交替）
      if (i < N_CASHIER) {
        const accCode = i % 2 === 0 ? cashAcc.code : bankAcc.code
        const amt = round2(200 + ((i * 53) % 50000))
        if (i % 3 === 0) insCB.run(uuid(), AID, accCode, date, i + 1, `出纳流水${i}`, amt, 0, '转账', `BILL${i}`, `往来${i % 300}`)
        else insCB.run(uuid(), AID, accCode, date, i + 1, `出纳流水${i}`, 0, amt, '现金', `BILL${i}`, `往来${i % 300}`)
      }
    }
  })()
  // 造数后刷新规划器统计：生产库每小时 PRAGMA optimize 会做同样的事，否则规划器按开发库的小表统计选计划
  db.exec('ANALYZE')
  const counts = {
    vouchers: db.prepare('SELECT COUNT(*) c FROM vouchers WHERE account_set_id=?').get(AID).c,
    entries: db.prepare('SELECT COUNT(*) c FROM voucher_entries WHERE account_set_id=?').get(AID).c,
    cashier: db.prepare('SELECT COUNT(*) c FROM cashier_journal WHERE account_set_id=?').get(AID).c,
    depts: db.prepare("SELECT COUNT(*) c FROM aux_items ai JOIN aux_categories ac ON ac.id=ai.type WHERE ai.account_set_id=? AND ac.code='dept'").get(AID).c,
  }
  console.log(`造数完成 ${(Date.now() - t0) / 1000}s：凭证 ${fmt(counts.vouchers)} / 分录 ${fmt(counts.entries)} / 出纳 ${fmt(counts.cashier)} / 部门 ${fmt(counts.depts)}`)
  db.close()
  if (TARGET_DEV) {
    // 直接插入的「已记账」凭证没走过账，科目余额汇总表需重建，否则读汇总表的页面与凭证对不上
    const t1 = Date.now()
    execSync(`npx tsx src/scripts/rebuildAccountBalances.ts ${AID}`, { cwd: join(ROOT, 'server'), stdio: 'inherit' })
    console.log(`科目余额汇总表重建完成 ${(Date.now() - t1) / 1000}s`)
  }
  return { counts, deptByCode, cashAcc: { id: cashAcc.id, code: cashAcc.code, name: cashAcc.name }, bankAcc }
}

// ── 服务 ──
let child
async function waitServer(timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${BASE}/api/auth/account-sets`); if (r.ok) return true } catch { /* not up yet */ }
    await sleep(700)
  }
  throw new Error('server 未在超时内启动; 日志: ' + SERVER_LOG)
}

async function startServer() {
  if (TARGET_DEV) { await waitServer(); return }  // 直接用正在运行的开发服务
  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d.toString(); appendFileSync(SERVER_LOG, d.toString()) })
  child.stderr.on('data', d => { log += d.toString(); appendFileSync(SERVER_LOG, d.toString()) })
  try { await waitServer() } catch (e) {
    writeFileSync(SERVER_LOG, log)
    console.log('--- server log ---\n' + log.slice(-4000)); throw e
  }
  writeFileSync(SERVER_LOG, log)
}

let token = '', asid = AID
async function api(method, path, body, opts = {}) {
  const t0 = Date.now()
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-set-id': asid },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  })
  if (opts.download) {
    const buf = Buffer.from(await r.arrayBuffer())
    return { ms: Date.now() - t0, status: r.status, bytes: buf.length }
  }
  const txt = await r.text()
  let json
  try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  if (!r.ok && !opts.allowError) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 200)}`)
  return { ...json, ms: Date.now() - t0, status: r.status }
}

// ── 计时报告 ──
const results = []
function judge(n, ms, extra = '') {
  const level = n >= FAIL_MS ? 'RED' : n >= WARN_MS ? 'YELLOW' : 'GREEN'
  const tag = level === 'RED' ? '红' : level === 'YELLOW' ? '黄' : '绿'
  return { level, tag, extra }
}
function record(name, ms, detail = '') {
  const { level, tag, extra } = judge(ms)
  results.push({ name, ms, level, detail: detail + (extra ? ` ${extra}` : '') })
  console.log(`${tag} ${fmt(ms)}ms  ${name}${detail ? ' — ' + detail : ''}${extra ? ' ' + extra : ''}`)
}
async function timed(name, fn, runs = 3, detail = '') {
  const times = []
  let last
  for (let i = 0; i < runs; i++) {
    last = await fn()
    times.push(last.ms ?? last)
    console.log(`    第${i + 1}次: ${fmt(last.ms ?? last)}ms / RSS ${fmt(rssOf(PORT))}MB`)
    await sleep(300)
  }
  record(name, median(times), detail + (last.detail ? ` ${last.detail}` : ''))
  return last
}

async function main() {
  console.log(`\n=== CW Finance 十万级压力测试（总账/凭证/出纳）===`)
  console.log(`规模：凭证 ${fmt(N_VOUCHERS)} 张、出纳流水 ${fmt(N_CASHIER)} 行、导出 ${fmt(N_EXPORT)} 行、批量 ${fmt(N_BATCH)} 张\n`)

  await prepDb()
  const { counts, cashAcc } = seed()
  console.log(`压测科目：${cashAcc.code} ${cashAcc.name} (${cashAcc.id})\n`)
  const rssBefore = rssOf(PORT)
  await startServer()
  const rssAfterBoot = rssOf(PORT)

  // 登录
  {
    const lr = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: asid }),
    }).then(x => x.json())
    token = lr.token
    if (!token) throw new Error('登录失败: ' + JSON.stringify(lr).slice(0, 200))
    console.log('admin 登录成功\n')
  }

  const rss0 = rssOf(PORT)
  const stages = (args.stages || 'ABCDEF').toUpperCase()

  // ── A. 页面刷新类（常规分页） ──
  if (stages.includes('A')) {
  console.log('── A. 页面刷新（常规分页） ──')
  await timed('明细账 首页100行', () => api('GET', `/api/ledger/detail?year=2026&account_id=${cashAcc.id}&page=1&pageSize=100`))
  await timed('明细账 翻第50页', () => api('GET', `/api/ledger/detail?year=2026&account_id=${cashAcc.id}&page=50&pageSize=100`))
  await timed('序时账 首页100行', () => api('GET', `/api/ledger/chronological?year=2026&page=1&pageSize=100`))
  await timed('凭证列表 首页50行', () => api('GET', `/api/voucher/vouchers?page=1&pageSize=50`))
  await timed('凭证列表 200行', () => api('GET', `/api/voucher/vouchers?page=1&pageSize=200`))
  await timed('出纳日记账 首页100行', () => api('GET', `/api/cashier/journal?page=1&page_size=100&account_code=${cashAcc.code}`))
  await timed('出纳日记账 筛选9月', () => api('GET', `/api/cashier/journal?page=1&page_size=100&account_code=${cashAcc.code}&start_date=2026-09-01&end_date=2026-09-30`))
  await timed('工作台 overview', () => api('GET', `/api/dashboard/overview`))
  }

  // ── B. 汇总类 ──
  if (stages.includes('B')) {
  console.log('\n── B. 汇总报表 ──')
  await timed('科目余额表 /ledger/general（前端口径：全年日期）', () => api('GET', `/api/ledger/general?start_date=2026-01-01&end_date=2026-12-31`), 3, `RSS ${fmt(rssOf(PORT))}MB`)
  await timed('科目余额表 /ledger/general（缺日期参数，仅 year）', () => api('GET', `/api/ledger/general?year=2026`), 3, 'FIX-250 前 209s')
  await timed('科目余额表 /ledger/general（单月区间 9 月）', () => api('GET', `/api/ledger/general?start_date=2026-09-01&end_date=2026-09-30`), 3, 'FIX-250 前窄区间劣化计划')
  await timed('科目余额表 /ledger/general（单月 + 含未记账）', () => api('GET', `/api/ledger/general?start_date=2026-09-01&end_date=2026-09-30&include_unposted=true`), 3)
  await timed('数量金额表 /ledger/quantity-balance（单月）', () => api('GET', `/api/ledger/quantity-balance?start_date=2026-09-01&end_date=2026-09-30`), 3)
  await timed('外币余额表 /ledger/foreign-balance（单月）', () => api('GET', `/api/ledger/foreign-balance?start_date=2026-09-01&end_date=2026-09-30`), 3)
  await timed('总分类账 /ledger/general-ledger（全年）', () => api('GET', `/api/ledger/general-ledger?year=2026`))
  await timed('辅助项目余额表（500部门）', () => api('POST', `/api/ledger/aux-balance`, { aux_category_ids: 'dept', start_date: '2026-01-01', end_date: '2026-12-31' }), 2)
  }

  // ── C. 导出链路 ──
  if (stages.includes('C')) {
  console.log('\n── C. 导出链路 ──')
  // C1 前端全量拉取模拟（分页循环拉 10 万行）
  {
    const t0 = Date.now()
    let rows = 0, page = 1, total = 0
    while (true) {
      const r = await api('GET', `/api/ledger/chronological?year=2026&page=${page}&pageSize=10000${page > 1 ? '&skip_count=1' : ''}`)
      total = total || r.total
      rows += (r.data || []).length
      if (!r.data?.length || r.data.length < 10000 || rows >= (total || Infinity)) break
      page++
      if (page > 30) break
    }
    record('序时账全量拉取（fetch 循环，10万行）', Date.now() - t0, `${fmt(rows)} 行 / total ${fmt(total)}`)
  }
  // C2 服务端 xlsx 生成（模拟前端已解析矩阵）
  {
    const cols = ['日期', '凭证号', '摘要', '科目编码', '科目名称', '借方金额', '贷方金额', '余额', '制单人', '审核人']
    const rowsM = []
    for (let i = 0; i < N_EXPORT; i++) {
      rowsM.push([
        `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
        `记-${String(i + 1).padStart(8, '0')}`,
        `压测摘要第${i + 1}行`,
        `100${String(1 + (i % 9)).padStart(2, '0')}`,
        `压测科目${i % 9 + 1}`,
        (100 + (i * 7 % 9900)) / 1,
        i % 2 === 0 ? (100 + (i * 7 % 9900)) / 1 : null,
        (5000 + (i * 13 % 50000)) / 1,
        '压测', i % 3 === 0 ? '压测' : null,
      ])
    }
    const spec = { fileName: '序时账_2026.xlsx', sheetName: '序时账', title: '序时账', subtitle: '压测', columns: cols.map(c => ({ label: c, width: 100 })), rows: rowsM, stripe: true }
    const payload = JSON.stringify(spec)
    console.log(`  导出 payload ${fmt(Math.round(payload.length / 1024 / 1024 * 10) / 10)}MB / ${fmt(N_EXPORT)} 行 × 10 列`)
    const t0 = Date.now()
    const r = await api('POST', '/api/export/styled-xlsx', payload, { download: true })
    record('服务端 xlsx 导出（10万行）', Date.now() - t0, `HTTP ${r.status} / 文件 ${fmt(Math.round(r.bytes / 1024))}KB`)
    rssExport = rssOf(PORT)
  }
  // C3 参数模式导出（FIX-254）：前端只发筛选参数，服务端查询 + 月合计 + 流式生成；期间探测轻接口是否被阻塞
  {
    const keys = ['voucher_date', 'voucher_type_name', 'voucher_no', 'account_code', 'account_name', 'summary', 'debit', 'credit', 'maker_name']
    const spec = { fileName: '序时账_2026_参数模式.xlsx', sheetName: '序时账', title: '序时账', subtitle: '压测', columns: keys.map(k => ({ key: k, label: k, width: 100, ...(k === 'debit' || k === 'credit' ? { type: 'amount', align: 'right' } : {}) })), source: { type: 'chronological', params: { year: 2026 } } }
    const probe = []
    let probing = true
    const prober = (async () => {
      while (probing) { const t = Date.now(); await api('GET', '/api/base/voucher-types').catch(() => null); probe.push(Date.now() - t); await sleep(200) }
    })()
    const t0 = Date.now()
    const r = await api('POST', '/api/export/styled-xlsx', JSON.stringify(spec), { download: true })
    probing = false; await prober
    record('参数模式导出 序时账全年（24 万行，服务端直出）', Date.now() - t0, `HTTP ${r.status} / 文件 ${fmt(Math.round(r.bytes / 1024))}KB / RSS ${fmt(rssOf(PORT))}MB`)
    const sorted = [...probe].sort((a, b) => a - b)
    record('参数模式导出期间并发轻接口 P95', sorted[Math.floor(sorted.length * 0.95)] ?? 0, `${probe.length} 次探测，最大 ${fmt(sorted[sorted.length - 1] ?? 0)}ms`)
  }
  }

  // ── D. 导入 ──
  if (stages.includes('D')) {
  console.log('\n── D. 导入 ──')
  // D1 出纳日记账批量导入（前端解析后的 rows JSON，10 万行）
  {
    const rows = []
    for (let i = 0; i < N_CASHIER; i++) {
      const date = dateOf(i)
      const amt = round2n(200 + ((i * 53) % 5000))
      rows.push({ biz_date: date, seq: i + 1, summary: `导入流水${i}`, debit: i % 3 === 0 ? amt : 0, credit: i % 3 === 0 ? 0 : amt, settle_type: '转账', bill_no: `IMP${i}` })
    }
    const payload = JSON.stringify({ account_code: cashAcc.code, rows })
    console.log(`  导入 payload ${fmt(Math.round(payload.length / 1024 / 1024 * 10) / 10)}MB / ${fmt(N_CASHIER)} 行`)
    const r = await timed('出纳日记账批量导入（10万行一次提交）', () => api('POST', '/api/cashier/journal/import', payload), 1)
    const ins = r?.data?.inserted
    if (ins !== undefined) console.log(`  落库 ${fmt(ins)} 行，错误 ${fmt(r?.data?.errors?.length || 0)} 条`)
  }
  // D2 银行对账单导入（真实 xlsx 上传 → 服务端解析 → 确认落库）
  {
    const XLSX = await import('xlsx')
    const wb = XLSX.utils.book_new()
    const header = ['交易日期', '借方', '贷方', '结算方式', '票据号']
    const data = [header]
    for (let i = 0; i < N_CASHIER; i++) {
      data.push([dateOf(i), i % 2 ? round2n(100 + (i % 900)) : null, i % 2 ? null : round2n(100 + (i % 900)), '网银', `BS${i}`])
    }
    const ws = XLSX.utils.aoa_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, '对账单')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    console.log(`  对账单 xlsx ${fmt(Math.round(buf.length / 1024 / 1024 * 10) / 10)}MB / ${fmt(N_CASHIER)} 行`)
    // 上传
    const t0 = Date.now()
    const fd = new FormData()
    fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '压测对账单.xlsx')
    const up = await fetch(`${BASE}/api/cashier/bank-statement/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }, body: fd })
    const upj = await up.json().catch(() => ({}))
    record('银行对账单上传+解析（10万行xlsx）', Date.now() - t0, `HTTP ${up.status} / total_rows ${fmt(upj?.data?.total_rows)}`)
    if (upj?.data?.preview_id) {
      const confirm = await timed('银行对账单确认落库（10万行）', () => api('POST', '/api/cashier/bank-statement/import/confirm', {
        preview_id: upj.data.preview_id, account_code: cashAcc.code,
        mapping: { biz_date: 0, debit: 1, credit: 2, settle_type: 3, bill_no: 4 },
      }), 1)
      console.log(`  落库 ${fmt(confirm?.data?.inserted)} 行，错误 ${fmt(confirm?.data?.errors?.length || 0)} 条`)
    }
  }
  }

  // ── E. 批量审核 + 过账（写路径，异步任务） ──
  if (stages.includes('E')) {
  console.log('\n── E. 批量审核/过账（异步任务） ──')
  {
    const r = await api('POST', '/api/voucher/vouchers/batch-audit-async', { dateRange: BATCH_RANGE })
    if (r?.data?.taskId) {
      const done = await pollTask(r.data.taskId, 300000)
      record(`批量审核 ${fmt(N_BATCH)} 张（异步任务总耗时）`, done.ms, `完成 ${fmt(done.processed)} / 失败 ${fmt(done.failed)}`)
    } else console.log('  批量审核任务创建失败：' + JSON.stringify(r).slice(0, 200))
  }
  {
    const r = await api('POST', '/api/voucher/vouchers/batch-post-async', { dateRange: BATCH_RANGE })
    if (r?.data?.taskId) {
      // FIX-252：批量记账期间每 200ms 打一次明细账首页，观察其他请求是否被阻塞
      // 轻接口（凭证类型列表）反映「事件循环被占多久」，明细账首页反映真实业务请求体验
      const probe = { light: [], detail: [] }
      let probing = true
      const prober = (async () => {
        while (probing) {
          let t = Date.now()
          await api('GET', '/api/base/voucher-types').catch(() => null)
          probe.light.push(Date.now() - t)
          t = Date.now()
          await api('GET', `/api/ledger/detail?year=2026&account_id=${cashAcc.id}&page=1&pageSize=100`).catch(() => null)
          probe.detail.push(Date.now() - t)
          await sleep(200)
        }
      })()
      const done = await pollTask(r.data.taskId, 600000)
      probing = false
      await prober
      record(`批量记账 ${fmt(N_BATCH)} 张（异步任务总耗时）`, done.ms, `完成 ${fmt(done.processed)} / 失败 ${fmt(done.failed)}`)
      for (const [name, arr] of [['轻接口', probe.light], ['明细账首页', probe.detail]]) {
        const sorted = [...arr].sort((a, b) => a - b)
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
        record(`批量记账期间并发请求 P95（${name}）`, p95, `${arr.length} 次探测，中位 ${fmt(sorted[Math.floor(sorted.length / 2)] ?? 0)}ms，最大 ${fmt(sorted[sorted.length - 1] ?? 0)}ms`)
      }
    } else console.log('  批量记账任务创建失败：' + JSON.stringify(r).slice(0, 200))
  }
  }

  // ── F. 并发压力 ──
  if (stages.includes('F')) {
  console.log('\n── F. 并发（多用户同时操作） ──')
  {
    const times = []
    const t0 = Date.now()
    for (let round = 0; round < 5; round++) {
      const batch = []
      for (let i = 0; i < 10; i++) {
        batch.push(api('GET', `/api/ledger/detail?year=2026&account_id=${cashAcc.id}&page=${1 + i}&pageSize=100`).then(r => r.ms))
      }
      times.push(...await Promise.all(batch))
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95)] || times[times.length - 1]
    record('50 次并发明细账查询（10路×5轮）', Date.now() - t0, `单请求中位 ${fmt(times[Math.floor(times.length / 2)])}ms / P95 ${fmt(p95)}ms`)
  }
  {
    const t0 = Date.now()
    await Promise.all([
      api('GET', `/api/ledger/general?start_date=2026-01-01&end_date=2026-12-31`),
      api('GET', `/api/ledger/general?start_date=2026-01-01&end_date=2026-12-31`),
      api('GET', `/api/ledger/general-ledger?year=2026`),
      api('GET', `/api/ledger/chronological?year=2026&page=1&pageSize=100`),
      api('GET', `/api/cashier/journal?page=1&page_size=100&account_code=${cashAcc.code}`),
    ])
    record('5 路混合并发（余额表×2+总账+序时+出纳）', Date.now() - t0, '全部完成')
  }
  }

  const rssEnd = rssOf(PORT)
  console.log(`\n服务进程 RSS：启动后 ${fmt(rssAfterBoot)}MB → 造数前(3199) ${fmt(rss0)}MB → 导出后 ${fmt(rssExport)}MB → 全部完成后 ${fmt(rssEnd)}MB`)

  // ── 汇总 ──
  const red = results.filter(r => r.level === 'RED')
  const yellow = results.filter(r => r.level === 'YELLOW')
  console.log(`\n=== 压测结果汇总 ===`)
  console.log(`共 ${results.length} 项：绿 ${results.length - red.length - yellow.length}、黄 ${yellow.length}、红 ${red.length}`)
  for (const r of results) console.log(`${r.level === 'RED' ? '[红]' : r.level === 'YELLOW' ? '[黄]' : '[绿]'} ${String(Math.round(r.ms)).padStart(8)}ms  ${r.name}  ${r.detail}`)

  try { child.kill() } catch { }
  console.log(TARGET_DEV ? `\n数据已保留在开发库「测试」账套；造数前备份 data/finance-0523.bak-20260925-preGlStress.db` : `\n副本库与日志位于 ${WORK}`)
  console.log(red.length > 0 ? `\n结论：存在 ${red.length} 项超时(>5s)，需优化` : yellow.length > 0 ? `\n结论：无致命项，${yellow.length} 项偏慢(>1.5s)` : '\n结论：全部通过')
  process.exit(red.length > 0 ? 1 : 0)
}

async function pollTask(taskId, timeoutMs) {
  const t0 = Date.now()
  let processed = 0, failed = 0, last = null
  while (Date.now() - t0 < timeoutMs) {
    const r = await api('GET', `/api/voucher/tasks/${taskId}`).catch(() => null)
    last = r?.data
    if (last) {
      processed = last.processed ?? last.progress?.processed ?? processed
      failed = last.failed ?? last.progress?.failed ?? failed
      if (last.status === 'completed' || last.status === 'done' || last.status === 'success') return { ms: Date.now() - t0, processed, failed }
      if (last.status === 'failed' || last.status === 'error') return { ms: Date.now() - t0, processed, failed, error: last.error }
    }
    await sleep(1000)
  }
  return { ms: Date.now() - t0, processed, failed, timeout: true }
}

main().catch(e => { console.error('压测失败:', e); try { child?.kill() } catch { }; process.exit(2) })

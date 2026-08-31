/*
 * 追加式 seed：给账套「出纳测试 ZT003」新增 2 个「成品套装」及其多级 BOM。
 * 套装把已有整机主机（9001/9002）当作 2 级子装配，再加键盘/鼠标/显示器组成成品。
 *
 * 与完整重建脚本 seedScmComputerCatalog.cjs 不同：本脚本【只追加、不清空】，幂等可重跑
 * （按 code 判断已存在则跳过），不会动现有 62 物料 / 单据 / 库存 / 计划。
 *
 * 用法： node server/src/scripts/seedScmKitProducts.cjs <时间戳>
 *   <时间戳> 用于备份文件名（如 20260623-1530）。脚本内不使用 Date.now()。
 *
 * 口径：套装 item_type='9'（成品）、source_type='self'、is_leaf=1、level=2、挂 90 整机成品目录、unit='套'。
 * 说明：系统的缺料单多级下推按 item_code 递归找 BOM，套装→主机→配件会被逐级炸开。
 */
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const { randomUUID } = require('crypto')

const ROOT = path.resolve(__dirname, '..', '..', '..')
const DB_PATH = path.join(ROOT, 'data', 'finance.db')
const AID = '1be2a318-ddae-4863-b87a-db4e2407f525' // 出纳测试 ZT003

const stamp = process.argv[2] || 'manual'
const uid = () => randomUUID()

// ── 套装成品定义 ─────────────────────────────────────────
// unit 用「套」；售价取主机 + 外设零售价之和向上取整。
const KITS = [
  { code: '9004', name: '全能游戏套装', spec: '游戏主机+27"2K240Hz+机械键鼠', sale: 17999 },
  { code: '9005', name: '高性价比办公套装', spec: '办公主机+24"+办公键鼠', sale: 6999 },
]

// ── 套装 BOM（多级：成品套装 → 主机[自带 BOM] + 外设叶子） ──
// 外设 code = 二级目录编码 + 两位序号：显示器 2001x、键鼠 2002x。
// 9001 全能游戏主机 / 9002 高性价比办公主机 自身已有 BOM0001/0002（3 级）。
const KIT_BOMS = [
  {
    code: 'BOM0004', name: '全能游戏套装 装配清单', item_code: '9004',
    lines: [
      ['9001', 1, '台'],   // 全能游戏主机（2 级子装配，自带 BOM0001）
      ['200103', 1, '台'], // 三星 奥德赛 G7 显示器
      ['200202', 1, '个'], // 雷蛇 黑寡妇V4 机械键盘
      ['200201', 1, '个'], // 罗技 G502 X 游戏鼠标
    ],
  },
  {
    code: 'BOM0005', name: '高性价比办公套装 装配清单', item_code: '9005',
    lines: [
      ['9002', 1, '台'],   // 高性价比办公主机（2 级子装配，自带 BOM0002）
      ['200104', 1, '台'], // LG 24GN600 显示器
      ['200203', 1, '个'], // 樱桃 MX3.0S 机械键盘
      ['200204', 1, '个'], // 罗技 MX Master 3S 无线鼠标
    ],
  },
]

// ── 备份 ─────────────────────────────────────────────────
const backupDir = path.join(ROOT, 'data', 'backup')
fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, `finance.before-kit-seed-${stamp}.db`)
fs.copyFileSync(DB_PATH, backupPath)
console.log('✓ 已备份数据库 →', backupPath)

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

// ── 预备语句 ─────────────────────────────────────────────
const getItemByCode = db.prepare('SELECT id, name, is_leaf FROM scm_item WHERE account_set_id=? AND code=?')
const getBomByCode = db.prepare('SELECT id FROM scm_bom WHERE account_set_id=? AND code=?')
const insItem = db.prepare(`
  INSERT INTO scm_item
    (id, account_set_id, code, name, spec, unit, category_code, subcategory_code,
     item_type, source_type, purchase_price, sale_price, parent_id, level, is_leaf, field_values)
  VALUES
    (@id, @aid, @code, @name, @spec, @unit, @category_code, @subcategory_code,
     @item_type, @source_type, @purchase_price, @sale_price, @parent_id, @level, @is_leaf, '{}')
`)
const insBom = db.prepare(
  'INSERT INTO scm_bom (id, account_set_id, code, name, item_code, status) VALUES (?,?,?,?,?,?)'
)
const insBomLine = db.prepare(
  'INSERT INTO scm_bom_line (id, account_set_id, bom_id, seq, item_code, qty, unit, scrap_rate, remark) VALUES (?,?,?,?,?,?,?,?,?)'
)

let nKit = 0, nKitSkip = 0, nBom = 0, nBomSkip = 0, nBomLine = 0

const run = db.transaction(() => {
  // 90 整机成品目录作为套装父节点
  const dir90 = getItemByCode.get(AID, '90')
  if (!dir90) throw new Error('未找到「90 整机成品」目录，请先运行 seedScmComputerCatalog.cjs 建立基础档案')

  // 1. 套装成品（幂等）
  for (const k of KITS) {
    if (getItemByCode.get(AID, k.code)) { nKitSkip++; continue }
    insItem.run({
      id: uid(), aid: AID, code: k.code, name: k.name, spec: k.spec, unit: '套',
      category_code: 'C03', subcategory_code: null, item_type: '9', source_type: 'self',
      purchase_price: 0, sale_price: k.sale, parent_id: dir90.id, level: 2, is_leaf: 1,
    })
    nKit++
  }

  // 2. 套装 BOM + 明细（幂等）
  for (const b of KIT_BOMS) {
    if (getBomByCode.get(AID, b.code)) { nBomSkip++; continue }
    const bid = uid()
    insBom.run(bid, AID, b.code, b.name, b.item_code, 'active'); nBom++
    b.lines.forEach((l, i) => {
      const [icode, qty, unit] = l
      insBomLine.run(uid(), AID, bid, i + 1, icode, qty, unit, 0, null); nBomLine++
    })
  }
})
run()

// ── 汇总 ─────────────────────────────────────────────────
console.log('\n=== 追加完成 ===')
console.log(`  套装成品 新增 ${nKit} / 跳过 ${nKitSkip}`)
console.log(`  套装 BOM 新增 ${nBom}（明细 ${nBomLine} 行）/ 跳过 ${nBomSkip}`)

// ── 自检 ─────────────────────────────────────────────────
console.log('\n=== 自检 ===')
let ok = true

// 套装成品都存在且为成品叶子
for (const k of KITS) {
  const it = getItemByCode.get(AID, k.code)
  if (!it) { console.log(`  ✗ 套装 ${k.code} 未落库`); ok = false }
}

// BOM 行无悬空引用
const orphan = db.prepare(`
  SELECT l.item_code FROM scm_bom_line l
  JOIN scm_bom b ON b.id = l.bom_id
  WHERE l.account_set_id=? AND b.code IN ('BOM0004','BOM0005') AND NOT EXISTS (
    SELECT 1 FROM scm_item i WHERE i.account_set_id=l.account_set_id AND i.code=l.item_code)
`).all(AID)
console.log('  BOM 行悬空引用 :', orphan.length ? JSON.stringify(orphan) : '无 ✓')
if (orphan.length) ok = false

// 多级结构验证：getBom(code) 取 active BOM 的直接子件，与缺料单多级下推一致
const getBomLines = (code) => {
  const bom = db.prepare("SELECT id FROM scm_bom WHERE account_set_id=? AND item_code=? AND status='active' ORDER BY code LIMIT 1").get(AID, code)
  if (!bom) return null
  return db.prepare('SELECT item_code FROM scm_bom_line WHERE bom_id=? ORDER BY seq').all(bom.id).map(r => r.item_code)
}
const kit4 = getBomLines('9004')
const host1 = getBomLines('9001')
console.log('  9004 套装直接子件 :', kit4 ? JSON.stringify(kit4) : '无 BOM')
console.log('  其中 9001 主机     :', kit4 && kit4.includes('9001') ? '是（2 级子装配）✓' : '缺失 ✗')
console.log('  9001 主机子件数    :', host1 ? `${host1.length} 行（3 级配件）${host1.length === 8 ? '✓' : ''}` : '无 BOM ✗')
if (!kit4 || !kit4.includes('9001') || !host1) ok = false

// 低层码递归小验证：套装应能逐级炸到底层采购件（叶子无 BOM）
const leafSet = new Set()
const visit = (code, depth) => {
  if (depth > 10) return
  const ls = getBomLines(code)
  if (!ls) { leafSet.add(code); return }
  for (const c of ls) visit(c, depth + 1)
}
visit('9004', 0)
const hasCpu = [...leafSet].some(c => c.startsWith('1001'))
console.log('  9004 递归到底层叶子 :', leafSet.size, '种；含 CPU(1001x)：', hasCpu ? '是 ✓' : '否 ✗')
if (!hasCpu) ok = false

db.close()
console.log(ok ? '\n✓ 全部完成，自检通过。' : '\n✗ 自检发现问题，请检查上面输出。')
process.exit(ok ? 0 : 1)

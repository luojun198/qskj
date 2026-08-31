/*
 * 供应链完全初始化：清空账套「出纳测试 ZT003」乱分类的物料档案，
 * 按电脑组件重建一套两系统（parent_id 目录树 + category_code 分类）完全对齐的干净档案 + BOM。
 *
 * 用法： node server/src/scripts/seedScmComputerCatalog.cjs <时间戳>
 *   <时间戳> 用于备份文件名（如 20260622-1530）。脚本内不使用 Date.now()。
 *
 * 口径：item_type '0'=原辅材料 '6'=半成品 '9'=成品；source_type purchase/outsource/self；
 *      is_leaf 0=目录 1=末级物料。采购配件=0+purchase；整机成品=9+self。
 * 保留：scm_partner / scm_warehouse / scm_unit / scm_doc_type / scm_bin。
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

// ── 1. 备份 ──────────────────────────────────────────────
const backupDir = path.join(ROOT, 'data', 'backup')
fs.mkdirSync(backupDir, { recursive: true })
const backupPath = path.join(backupDir, `finance.before-scm-seed-${stamp}.db`)
fs.copyFileSync(DB_PATH, backupPath)
console.log('✓ 已备份数据库 →', backupPath)

const db = new Database(DB_PATH)
db.pragma('foreign_keys = ON')

// ── 删除目标表（按 FK 依赖顺序，仅本账套） ─────────────────
const DELETE_TABLES = [
  'scm_bom_line', 'scm_bom',
  'scm_doc_line', 'scm_doc',
  'scm_stock_move', 'scm_batch_move', 'scm_serial_move', 'scm_serial',
  'scm_stock_batch', 'scm_stock',
  'scm_production_plan', 'scm_work_report', 'scm_ar_ap_log',
  'scm_item_unit', 'scm_item', 'scm_item_category',
]
const tableExists = (t) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)
const countOf = (t) =>
  tableExists(t) ? db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE account_set_id=?`).get(AID).n : '(无表)'

console.log('\n=== 删除前各表行数（本账套） ===')
for (const t of DELETE_TABLES) console.log(`  ${t}: ${countOf(t)}`)

// ── 分类定义 ─────────────────────────────────────────────
// 顶类
const CATS = [
  { code: 'C01', name: '电脑配件', parent: null },
  { code: 'C02', name: '外设', parent: null },
  { code: 'C03', name: '整机成品', parent: null },
  // 子类（电脑配件）
  { code: 'C0101', name: 'CPU', parent: 'C01' },
  { code: 'C0102', name: '主板', parent: 'C01' },
  { code: 'C0103', name: '内存', parent: 'C01' },
  { code: 'C0104', name: '硬盘/SSD', parent: 'C01' },
  { code: 'C0105', name: '显卡', parent: 'C01' },
  { code: 'C0106', name: '电源', parent: 'C01' },
  { code: 'C0107', name: '机箱', parent: 'C01' },
  { code: 'C0108', name: '散热', parent: 'C01' },
  // 子类（外设）
  { code: 'C0201', name: '显示器', parent: 'C02' },
  { code: 'C0202', name: '键鼠', parent: 'C02' },
]

// ── 目录树定义（parent_id/level/is_leaf=0） ───────────────
// 顶层目录 → 二级目录；每个二级目录绑定一个 subcategory 用于叶子归类。
const DIR_TOP = [
  { code: '10', name: '电脑配件', cat: 'C01' },
  { code: '20', name: '外设', cat: 'C02' },
  { code: '90', name: '整机成品', cat: 'C03' },
]
const DIR_SUB = [
  { code: '1001', name: 'CPU', topCode: '10', cat: 'C01', sub: 'C0101' },
  { code: '1002', name: '主板', topCode: '10', cat: 'C01', sub: 'C0102' },
  { code: '1003', name: '内存', topCode: '10', cat: 'C01', sub: 'C0103' },
  { code: '1004', name: '硬盘/SSD', topCode: '10', cat: 'C01', sub: 'C0104' },
  { code: '1005', name: '显卡', topCode: '10', cat: 'C01', sub: 'C0105' },
  { code: '1006', name: '电源', topCode: '10', cat: 'C01', sub: 'C0106' },
  { code: '1007', name: '机箱', topCode: '10', cat: 'C01', sub: 'C0107' },
  { code: '1008', name: '散热', topCode: '10', cat: 'C01', sub: 'C0108' },
  { code: '2001', name: '显示器', topCode: '20', cat: 'C02', sub: 'C0201' },
  { code: '2002', name: '键鼠', topCode: '20', cat: 'C02', sub: 'C0202' },
]

// ── 配件叶子物料（item_type='0' 原辅材料, source_type='purchase'） ──
// subCode = 所属二级目录编码；item code = subCode + 两位序号
const PARTS = {
  '1001': [ // CPU 个
    ['Intel Core i9-13900K', '24核32线程 LGA1700', '个', 4299],
    ['Intel Core i7-13700K', '16核24线程 LGA1700', '个', 2899],
    ['Intel Core i5-13400F', '10核16线程 LGA1700', '个', 1199],
    ['AMD Ryzen 9 7950X', '16核32线程 AM5', '个', 4099],
    ['AMD Ryzen 7 7800X3D', '8核16线程 3D缓存 AM5', '个', 2799],
    ['AMD Ryzen 5 7600', '6核12线程 AM5', '个', 1399],
  ],
  '1002': [ // 主板 块
    ['华硕 ROG STRIX Z790-E', 'ATX Intel Z790 DDR5', '块', 3499],
    ['微星 MAG B760M MORTAR', 'M-ATX Intel B760 DDR5', '块', 1199],
    ['技嘉 X670 AORUS ELITE', 'ATX AMD X670 DDR5', '块', 2299],
    ['华硕 TUF B650M-PLUS', 'M-ATX AMD B650 DDR5', '块', 1299],
    ['微星 PRO B760-P', 'ATX Intel B760 DDR4', '块', 999],
  ],
  '1003': [ // 内存 条
    ['金士顿 FURY DDR5 16G', '6000MHz 单条', '条', 359],
    ['芝奇 幻锋戟 DDR5 32G', '6000MHz 16Gx2', '条', 799],
    ['海盗船 复仇者 DDR5 32G', '5600MHz 16Gx2', '条', 749],
    ['威刚 XPG DDR4 16G', '3200MHz 单条', '条', 219],
  ],
  '1004': [ // 硬盘/SSD 块
    ['三星 980 PRO 1TB', 'M.2 NVMe PCIe4.0', '块', 699],
    ['西数 SN850X 2TB', 'M.2 NVMe PCIe4.0', '块', 1099],
    ['致钛 TiPlus7100 1TB', 'M.2 NVMe PCIe4.0', '块', 529],
    ['希捷 酷鱼 2TB', '3.5寸 7200转 HDD', '块', 369],
    ['西数 蓝盘 4TB', '3.5寸 5400转 HDD', '块', 559],
  ],
  '1005': [ // 显卡 个
    ['NVIDIA RTX 4090', '24GB GDDR6X', '个', 12999],
    ['NVIDIA RTX 4080 SUPER', '16GB GDDR6X', '个', 8499],
    ['NVIDIA RTX 4070 Ti', '12GB GDDR6X', '个', 5999],
    ['NVIDIA RTX 4060', '8GB GDDR6', '个', 2399],
    ['AMD RX 7900 XTX', '24GB GDDR6', '个', 7699],
    ['AMD RX 7800 XT', '16GB GDDR6', '个', 4099],
  ],
  '1006': [ // 电源 个
    ['海韵 FOCUS GX-1000', '1000W 金牌全模组', '个', 1099],
    ['振华 LEADEX G 850', '850W 金牌全模组', '个', 799],
    ['长城 X7 750W', '750W 金牌全模组', '个', 569],
    ['鑫谷 GP650G', '650W 金牌', '个', 359],
  ],
  '1007': [ // 机箱 个
    ['联力 包豪斯 O11D', '中塔 海景房', '个', 899],
    ['追风者 P500A', '中塔 网孔风冷', '个', 599],
    ['爱国者 YOGO M2', 'M-ATX 紧凑', '个', 299],
    ['先马 平头哥M2', '中塔 静音', '个', 219],
  ],
  '1008': [ // 散热 个
    ['利民 PA120 SE', '双塔6热管 风冷', '个', 159],
    ['猫头鹰 NH-D15', '双塔双扇 风冷', '个', 699],
    ['九州风神 阿萨辛4', '双塔7热管 风冷', '个', 399],
    ['恩杰 卡肯360', '360一体式水冷', '个', 899],
  ],
  '2001': [ // 显示器 台
    ['戴尔 U2723QE', '27寸 4K IPS', '台', 3299],
    ['AOC Q27G2S', '27寸 2K 165Hz', '台', 1399],
    ['三星 奥德赛 G7', '27寸 2K 240Hz曲面', '台', 2799],
    ['LG 24GN600', '24寸 1080P 144Hz', '台', 1099],
  ],
  '2002': [ // 键鼠 套
    ['罗技 G502 X', '有线游戏鼠标', '个', 399],
    ['雷蛇 黑寡妇V4', '机械键盘 绿轴', '个', 799],
    ['樱桃 MX3.0S', '机械键盘 红轴', '个', 599],
    ['罗技 MX Master 3S', '无线办公鼠标', '个', 699],
  ],
}

// ── 整机成品（item_type='9' 成品, source_type='self'） ───
const PRODUCTS = [
  { code: '9001', name: '全能游戏主机', spec: 'i7-13700K + RTX4080S', sale: 13999 },
  { code: '9002', name: '高性价比办公主机', spec: 'i5-13400F + 核显', sale: 4599 },
  { code: '9003', name: '创作者工作站', spec: 'R9-7950X + RTX4090', sale: 25999 },
  // 成品套装：主机作为 2 级子装配 + 键鼠/显示器，组成整套成品（unit 用「套」）
  { code: '9004', name: '全能游戏套装', spec: '游戏主机+27"2K240Hz+机械键鼠', sale: 17999, unit: '套' },
  { code: '9005', name: '高性价比办公套装', spec: '办公主机+24"+办公键鼠', sale: 6999, unit: '套' },
]

// ── BOM（成品 → 配件用料），item code 取自上面 PARTS 的 subCode+序号 ──
// 序号从 01 起：例如 100101 = CPU 第1项 i9-13900K
const P = (sub, idx) => sub + String(idx).padStart(2, '0')
const BOMS = [
  {
    code: 'BOM0001', name: '全能游戏主机 装配清单', item_code: '9001',
    lines: [
      [P('1001', 2), 1, '个'], // i7-13700K
      [P('1002', 1), 1, '块'], // 华硕 Z790-E
      [P('1003', 2), 1, '条'], // 芝奇 DDR5 32G
      [P('1004', 2), 1, '块'], // 西数 SN850X 2TB
      [P('1005', 2), 1, '个'], // RTX 4080 SUPER
      [P('1006', 1), 1, '个'], // 海韵 1000W
      [P('1007', 1), 1, '个'], // 联力 O11D
      [P('1008', 4), 1, '个'], // 恩杰 360水冷
    ],
  },
  {
    code: 'BOM0002', name: '高性价比办公主机 装配清单', item_code: '9002',
    lines: [
      [P('1001', 3), 1, '个'], // i5-13400F
      [P('1002', 2), 1, '块'], // 微星 B760M
      [P('1003', 1), 1, '条'], // 金士顿 DDR5 16G
      [P('1004', 3), 1, '块'], // 致钛 1TB
      [P('1006', 4), 1, '个'], // 鑫谷 650W
      [P('1007', 3), 1, '个'], // 爱国者 M2
      [P('1008', 1), 1, '个'], // 利民 PA120（无独显，走核显）
    ],
  },
  {
    code: 'BOM0003', name: '创作者工作站 装配清单', item_code: '9003',
    lines: [
      [P('1001', 4), 1, '个'], // R9 7950X
      [P('1002', 3), 1, '块'], // 技嘉 X670
      [P('1003', 2), 2, '条'], // 芝奇 DDR5 32G x2 = 64G
      [P('1004', 2), 1, '块'], // 西数 SN850X 2TB
      [P('1005', 1), 1, '个'], // RTX 4090
      [P('1006', 1), 1, '个'], // 海韵 1000W
      [P('1007', 2), 1, '个'], // 追风者 P500A
      [P('1008', 2), 1, '个'], // 猫头鹰 D15
    ],
  },
  // ── 成品套装 BOM（多级：套装 → 主机[自带 BOM] + 外设叶子） ──
  {
    code: 'BOM0004', name: '全能游戏套装 装配清单', item_code: '9004',
    lines: [
      ['9001', 1, '台'],       // 全能游戏主机（2 级子装配，自带 BOM0001）
      [P('2001', 3), 1, '台'], // 三星 奥德赛 G7 显示器
      [P('2002', 2), 1, '个'], // 雷蛇 黑寡妇V4 机械键盘
      [P('2002', 1), 1, '个'], // 罗技 G502 X 游戏鼠标
    ],
  },
  {
    code: 'BOM0005', name: '高性价比办公套装 装配清单', item_code: '9005',
    lines: [
      ['9002', 1, '台'],       // 高性价比办公主机（2 级子装配，自带 BOM0002）
      [P('2001', 4), 1, '台'], // LG 24GN600 显示器
      [P('2002', 3), 1, '个'], // 樱桃 MX3.0S 机械键盘
      [P('2002', 4), 1, '个'], // 罗技 MX Master 3S 无线鼠标
    ],
  },
]

// ── scm_item 插入语句（写齐关键列，其余走默认） ───────────
const insItem = db.prepare(`
  INSERT INTO scm_item
    (id, account_set_id, code, name, spec, unit, category_code, subcategory_code,
     item_type, source_type, purchase_price, sale_price, parent_id, level, is_leaf, field_values)
  VALUES
    (@id, @aid, @code, @name, @spec, @unit, @category_code, @subcategory_code,
     @item_type, @source_type, @purchase_price, @sale_price, @parent_id, @level, @is_leaf, '{}')
`)
const insCat = db.prepare(
  'INSERT INTO scm_item_category (id, account_set_id, code, name, parent_code) VALUES (?,?,?,?,?)'
)
const insBom = db.prepare(
  'INSERT INTO scm_bom (id, account_set_id, code, name, item_code, status) VALUES (?,?,?,?,?,?)'
)
const insBomLine = db.prepare(
  'INSERT INTO scm_bom_line (id, account_set_id, bom_id, seq, item_code, qty, unit, scrap_rate, remark) VALUES (?,?,?,?,?,?,?,?,?)'
)

let nCat = 0, nDir = 0, nPart = 0, nProd = 0, nBom = 0, nBomLine = 0

const run = db.transaction(() => {
  // 2. 删除
  for (const t of DELETE_TABLES) {
    if (tableExists(t)) db.prepare(`DELETE FROM ${t} WHERE account_set_id=?`).run(AID)
  }

  // 3. 分类档案
  for (const c of CATS) { insCat.run(uid(), AID, c.code, c.name, c.parent); nCat++ }

  // 4a. 顶层目录（is_leaf=0, level=1, parent_id=null）
  const topId = {}
  for (const d of DIR_TOP) {
    const id = uid(); topId[d.code] = id; nDir++
    insItem.run({ id, aid: AID, code: d.code, name: d.name, spec: null, unit: null,
      category_code: d.cat, subcategory_code: null, item_type: null, source_type: 'purchase',
      purchase_price: 0, sale_price: 0, parent_id: null, level: 1, is_leaf: 0 })
  }
  // 4b. 二级目录（is_leaf=0, level=2）
  const subId = {}
  for (const d of DIR_SUB) {
    const id = uid(); subId[d.code] = id; nDir++
    insItem.run({ id, aid: AID, code: d.code, name: d.name, spec: null, unit: null,
      category_code: d.cat, subcategory_code: d.sub, item_type: null,
      source_type: d.topCode === '90' ? 'self' : 'purchase',
      purchase_price: 0, sale_price: 0, parent_id: topId[d.topCode], level: 2, is_leaf: 0 })
  }
  // 4c. 配件叶子（is_leaf=1, level=3, item_type='0', purchase）
  for (const d of DIR_SUB) {
    const list = PARTS[d.code] || []
    list.forEach((row, i) => {
      const [name, spec, unit, price] = row
      const code = P(d.code, i + 1)
      insItem.run({ id: uid(), aid: AID, code, name, spec, unit,
        category_code: d.cat, subcategory_code: d.sub, item_type: '0', source_type: 'purchase',
        purchase_price: price, sale_price: 0, parent_id: subId[d.code], level: 3, is_leaf: 1 })
      nPart++
    })
  }
  // 4d. 整机成品（is_leaf=1, level=2 直接挂 90 顶目录, item_type='9', self）
  for (const p of PRODUCTS) {
    insItem.run({ id: uid(), aid: AID, code: p.code, name: p.name, spec: p.spec, unit: p.unit || '台',
      category_code: 'C03', subcategory_code: null, item_type: '9', source_type: 'self',
      purchase_price: 0, sale_price: p.sale, parent_id: topId['90'], level: 2, is_leaf: 1 })
    nProd++
  }

  // 5. BOM
  for (const b of BOMS) {
    const bid = uid()
    insBom.run(bid, AID, b.code, b.name, b.item_code, 'active'); nBom++
    b.lines.forEach((l, i) => {
      const [icode, qty, unit] = l
      insBomLine.run(uid(), AID, bid, i + 1, icode, qty, unit, 0, null); nBomLine++
    })
  }
})
run()

// ── 6. 汇总 ──────────────────────────────────────────────
console.log('\n=== 重建完成 ===')
console.log(`  分类 scm_item_category : ${nCat}`)
console.log(`  目录节点 (is_leaf=0)   : ${nDir}`)
console.log(`  配件物料 (item_type=0) : ${nPart}`)
console.log(`  整机成品 (item_type=9) : ${nProd}`)
console.log(`  BOM                    : ${nBom}（明细 ${nBomLine} 行）`)
console.log(`  物料合计               : ${countOf('scm_item')}`)

// ── 自检 ────────────────────────────────────────────────
console.log('\n=== 自检 ===')
const badType = db.prepare(
  "SELECT DISTINCT item_type FROM scm_item WHERE account_set_id=? AND item_type IS NOT NULL AND item_type NOT IN ('0','6','9')"
).all(AID)
console.log('  非法 item_type :', badType.length ? JSON.stringify(badType) : '无 ✓')
const leafNoCat = db.prepare(
  'SELECT COUNT(*) n FROM scm_item WHERE account_set_id=? AND is_leaf=1 AND category_code IS NULL'
).get(AID).n
console.log('  叶子未归类      :', leafNoCat === 0 ? '0 ✓' : leafNoCat)
const orphan = db.prepare(`
  SELECT l.item_code FROM scm_bom_line l
  WHERE l.account_set_id=? AND NOT EXISTS (
    SELECT 1 FROM scm_item i WHERE i.account_set_id=l.account_set_id AND i.code=l.item_code)
`).all(AID)
console.log('  BOM行悬空引用   :', orphan.length ? JSON.stringify(orphan) : '无 ✓')

db.close()
console.log('\n✓ 全部完成。')

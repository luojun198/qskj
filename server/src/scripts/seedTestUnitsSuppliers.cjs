// 一次性测试数据脚本：给现有物料补主单位、新增供应商、随机分配主要供应商。
// 仅针对「出纳测试」账套（ZT003）。可重复执行（幂等处理主单位与供应商）。
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const DB = path.resolve(__dirname, '../../../data/finance.db')
const AID = '1be2a318-ddae-4863-b87a-db4e2407f525'
const db = new Database(DB)
const uuid = () => crypto.randomUUID()
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

let log = []

db.transaction(() => {
  // ── 1. 清理历史测试污染 ───────────────────────────────
  // 1a. scm_item_unit 孤儿行（对应物料已删除）
  const orphan = db.prepare(
    "DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code NOT IN (SELECT code FROM scm_item WHERE account_set_id=?)"
  ).run(AID, AID)
  // 1b. 之前 curl 乱码误建的垃圾单位（UN0008/UN0009，未被引用）
  const ghost = db.prepare(
    "DELETE FROM scm_unit WHERE account_set_id=? AND code IN ('UN0008','UN0009') AND name NOT IN (SELECT DISTINCT unit FROM scm_item WHERE account_set_id=? AND unit IS NOT NULL)"
  ).run(AID, AID)
  log.push(`清理：孤儿主单位行 ${orphan.changes} 条，垃圾单位 ${ghost.changes} 个`)

  // ── 2. 给明细物料补主单位（scm_item_unit is_primary=1） ──
  const units = db.prepare('SELECT code, name FROM scm_unit WHERE account_set_id=?').all(AID)
  const unitByName = new Map(units.map(u => [u.name, u.code]))
  const leaf = db.prepare("SELECT code, unit FROM scm_item WHERE account_set_id=? AND is_leaf=1").all(AID)
  const delPrim = db.prepare('DELETE FROM scm_item_unit WHERE account_set_id=? AND item_code=? AND is_primary=1')
  const insPrim = db.prepare('INSERT INTO scm_item_unit (id,account_set_id,item_code,unit_code,is_primary,conversion_rate) VALUES (?,?,?,?,1,1)')
  let madePrim = 0, noUnit = []
  for (const it of leaf) {
    const uName = it.unit || '个'  // 无单位文本的默认「个」
    let uCode = unitByName.get(uName)
    if (!uCode) { uCode = unitByName.get('个'); noUnit.push(it.code) }
    if (!uCode) continue
    delPrim.run(AID, it.code)
    insPrim.run(uuid(), AID, it.code, uCode)
    // 同步 scm_item.unit 文本，保证列表/单据显示一致
    db.prepare('UPDATE scm_item SET unit=?, updated_at=? WHERE account_set_id=? AND code=?').run(uName, now(), AID, it.code)
    madePrim++
  }
  log.push(`主单位：为 ${madePrim} 个明细物料建立主单位行` + (noUnit.length ? `（其中 ${noUnit.length} 个原无单位，按「个」兜底）` : ''))

  // ── 3. 新增供应商（计算机配件类，code 续 GYS 段） ──────
  const newSuppliers = [
    { name: '金邦内存代理商', contact: '王磊', phone: '13800010003' },
    { name: '西部数据存储经销', contact: '李娜', phone: '13800010004' },
    { name: '三星固态总代-鑫存科技', contact: '张伟', phone: '13800010005' },
    { name: '海韵电源代理-恒源电子', contact: '刘洋', phone: '13800010006' },
    { name: '联力机箱经销商', contact: '陈强', phone: '13800010007' },
    { name: '技嘉主板代理-板卡之家', contact: '赵敏', phone: '13800010008' },
    { name: '七彩虹显卡总代', contact: '孙琪', phone: '13800010009' },
    { name: '利民散热代理-风冷世家', contact: '周杰', phone: '13800010010' },
  ]
  // 取当前最大 GYS 编号
  const maxRow = db.prepare("SELECT code FROM scm_partner WHERE account_set_id=? AND code LIKE 'GYS%' ORDER BY code DESC LIMIT 1").get(AID)
  let nextNo = maxRow ? (parseInt(String(maxRow.code).replace('GYS', ''), 10) || 0) + 1 : 1
  const insPartner = db.prepare(
    'INSERT INTO scm_partner (id,account_set_id,code,name,partner_type,contact,phone,enabled,credit_days,price_level,is_outsource,credit_limit,tax_rate) VALUES (?,?,?,?,?,?,?,1,0,1,0,0,0)'
  )
  let addedSup = 0
  for (const s of newSuppliers) {
    // 跳过同名已存在
    const exist = db.prepare('SELECT 1 FROM scm_partner WHERE account_set_id=? AND name=?').get(AID, s.name)
    if (exist) continue
    const code = 'GYS' + String(nextNo++).padStart(4, '0')
    insPartner.run(uuid(), AID, code, s.name, 'supplier', s.contact, s.phone)
    addedSup++
  }
  log.push(`供应商：新增 ${addedSup} 家`)

  // ── 4. 随机分配「主要供应商」到明细物料 ─────────────────
  const supPool = db.prepare(
    "SELECT code FROM scm_partner WHERE account_set_id=? AND partner_type='supplier' AND enabled=1 ORDER BY code"
  ).all(AID).map(r => r.code)
  const updSup = db.prepare('UPDATE scm_item SET supplier_code=?, updated_at=? WHERE account_set_id=? AND code=?')
  let assigned = 0
  for (const it of leaf) {
    const pick = supPool[Math.floor(Math.random() * supPool.length)]
    updSup.run(pick, now(), AID, it.code)
    assigned++
  }
  log.push(`主要供应商：随机分配到 ${assigned} 个明细物料（供应商池 ${supPool.length} 家）`)
})()

// 汇总核对
const chk = {
  明细物料: db.prepare('SELECT COUNT(*) c FROM scm_item WHERE account_set_id=? AND is_leaf=1').get(AID).c,
  有主单位行: db.prepare('SELECT COUNT(DISTINCT item_code) c FROM scm_item_unit WHERE account_set_id=? AND is_primary=1').get(AID).c,
  有主供应商: db.prepare("SELECT COUNT(*) c FROM scm_item WHERE account_set_id=? AND is_leaf=1 AND supplier_code IS NOT NULL AND supplier_code<>''").get(AID).c,
  供应商总数: db.prepare("SELECT COUNT(*) c FROM scm_partner WHERE account_set_id=? AND partner_type='supplier'").get(AID).c,
}
console.log(log.join('\n'))
console.log('核对：', JSON.stringify(chk))
db.close()

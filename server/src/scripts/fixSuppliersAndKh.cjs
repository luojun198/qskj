// 调整：① 主供应商只从纯采购供应商(GYS 段)随机分配，排除委外厂(WW)；
//        ② 修复 KH0001 乱码名称（原始数据为 U+FFFD 替换符，无法还原，按合理名称重设）。
const path = require('path')
const Database = require('better-sqlite3')

const DB = path.resolve(__dirname, '../../../data/finance.db')
const AID = '1be2a318-ddae-4863-b87a-db4e2407f525'
const db = new Database(DB)
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const log = []

db.transaction(() => {
  // ① 纯采购供应商池：GYS 段（排除 WW 委外厂、KH 客户）
  const pool = db.prepare(
    "SELECT code FROM scm_partner WHERE account_set_id=? AND partner_type='supplier' AND enabled=1 AND code LIKE 'GYS%' ORDER BY code"
  ).all(AID).map(r => r.code)
  const leaf = db.prepare("SELECT code FROM scm_item WHERE account_set_id=? AND is_leaf=1").all(AID)
  const upd = db.prepare('UPDATE scm_item SET supplier_code=?, updated_at=? WHERE account_set_id=? AND code=?')
  for (const it of leaf) {
    const pick = pool[Math.floor(Math.random() * pool.length)]
    upd.run(pick, now(), AID, it.code)
  }
  log.push(`主供应商：${leaf.length} 个明细物料改为只从 ${pool.length} 家纯采购供应商(${pool[0]}~${pool[pool.length - 1]})随机分配`)

  // ② 修复 KH0001 名称（both 类型：既采购也销售的华强北贸易行）
  const r = db.prepare('UPDATE scm_partner SET name=?, short_name=?, updated_at=? WHERE account_set_id=? AND code=?')
    .run('华强北数码贸易行', '华强北数码', now(), AID, 'KH0001')
  log.push(`KH0001：重命名为「华强北数码贸易行」（影响 ${r.changes} 行）`)
})()

// 核对
const kh = db.prepare("SELECT code,name,partner_type FROM scm_partner WHERE account_set_id=? AND code='KH0001'").get(AID)
const dist = db.prepare(
  "SELECT supplier_code, COUNT(*) c FROM scm_item WHERE account_set_id=? AND is_leaf=1 GROUP BY supplier_code ORDER BY supplier_code"
).all(AID)
const hasWW = db.prepare("SELECT COUNT(*) c FROM scm_item WHERE account_set_id=? AND is_leaf=1 AND supplier_code LIKE 'WW%'").get(AID).c
console.log(log.join('\n'))
console.log('KH0001 现名：', JSON.stringify(kh))
console.log('主供应商分布：', JSON.stringify(dist))
console.log('仍含委外厂(WW)的物料数：', hasWW)
db.close()

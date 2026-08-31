import Database from 'better-sqlite3'
import { join } from 'path'

try {
  const dbPath = 'D:/BDKF/qskj/data/finance.db'
  const db = new Database(dbPath, { readonly: true })
  
  // 1. 鏌ヨ鎵€鏈夌洰褰曪紙is_leaf = 0锛?
  const categories = db.prepare("SELECT id, code, name, parent_id, level FROM scm_item WHERE is_leaf = 0").all()
  console.log("Categories (is_leaf = 0):")
  console.log(JSON.stringify(categories, null, 2))

  // 2. 鏌ヨ杩欎簺鐩綍涓嬬殑鏄庣粏瀛愰」鏁伴噺
  console.log("\nChild count per category:")
  for (const cat of categories) {
    const childCount = db.prepare("SELECT COUNT(*) c FROM scm_item WHERE parent_id = ?").get(cat.id).c
    const leafCount = db.prepare("SELECT COUNT(*) c FROM scm_item WHERE parent_id = ? AND is_leaf = 1").get(cat.id).c
    console.log(`Category: ${cat.code} - ${cat.name} (ID: ${cat.id}) has ${childCount} total children, ${leafCount} leaf children`)
  }

  // 3. 妫€鏌ユ槸鍚︽湁鏄庣粏娌℃湁parent_id
  const noParentCount = db.prepare("SELECT COUNT(*) c FROM scm_item WHERE is_leaf = 1 AND parent_id IS NULL").get().c
  const totalLeafCount = db.prepare("SELECT COUNT(*) c FROM scm_item WHERE is_leaf = 1").get().c
  console.log(`\nTotal leaf items: ${totalLeafCount}, Leaf items with parent_id IS NULL: ${noParentCount}`)

  db.close()
} catch (e) {
  console.error(e)
}

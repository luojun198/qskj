import Database from 'better-sqlite3'
import { join } from 'path'

try {
  const dbPath = 'D:/BDKF/qskj/data/finance.db'
  const db = new Database(dbPath, { readonly: true })

  // 鏌ヨ parent_id 涓嶄负 null 鐨勬槑缁嗙墿鏂欑殑 category_code
  const items = db.prepare(`
    SELECT i.code, i.name, i.parent_id, i.category_code, p.code as parent_code, p.category_code as parent_category_code
    FROM scm_item i
    JOIN scm_item p ON i.parent_id = p.id
    WHERE i.is_leaf = 1 LIMIT 10
  `).all()
  console.log("Leaf items with parent:")
  console.log(JSON.stringify(items, null, 2))

  db.close()
} catch (e) {
  console.error(e)
}

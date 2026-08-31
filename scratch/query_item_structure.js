import Database from 'better-sqlite3'
import { join } from 'path'

try {
  const dbPath = 'D:/BDKF/qskj/data/finance.db'
  const db = new Database(dbPath, { readonly: true })
  
  // 鏌ヨ琛ㄧ粨鏋?
  const info = db.prepare("PRAGMA table_info(scm_item)").all()
  console.log("scm_item columns:")
  console.log(info.map(c => `${c.name} (${c.type})`).join(', '))

  // 鏌ヨ鍓?0鏉＄墿鏂欑殑鍒嗙被鍜岀骇鑱斿叧绯?
  const items = db.prepare("SELECT id, code, name, category_code, subcategory_code, parent_id, level, is_leaf FROM scm_item LIMIT 20").all()
  console.log("\nSome items:")
  console.log(JSON.stringify(items, null, 2))
  
  db.close()
} catch (e) {
  console.error(e)
}

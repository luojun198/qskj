import Database from 'better-sqlite3'

try {
  const dbPath = 'D:/BDKF/qskj/data/finance.db'
  const db = new Database(dbPath, { readonly: true })
  
  // 1. 鏌ヨ scm_doc 缁撴瀯
  const docCols = db.prepare("PRAGMA table_info(scm_doc)").all()
  console.log("scm_doc columns:")
  console.log(docCols.map(c => `${c.name} (${c.type})`).join(', '))

  // 2. 鏌ヨ scm_doc_line 缁撴瀯
  const lineCols = db.prepare("PRAGMA table_info(scm_doc_line)").all()
  console.log("\nscm_doc_line columns:")
  console.log(lineCols.map(c => `${c.name} (${c.type})`).join(', '))

  db.close()
} catch (e) {
  console.error(e)
}

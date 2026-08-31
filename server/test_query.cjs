const Database = require('better-sqlite3');
const db = new Database('d:/BDKF/cw0523/data/finance.db', { fileMustExist: true });
const sql = `SELECT l.item_code, l.qty, (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id) as pushed_qty FROM scm_doc_line l JOIN scm_doc d ON d.id = l.doc_id WHERE d.doc_type = 'SOa'`;
console.log(db.prepare(sql).all());

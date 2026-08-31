const Database = require('better-sqlite3');
const db = new Database('d:/BDKF/cw0523/data/finance.db', { fileMustExist: true });
const sql = `
    SELECT s.item_code, s.warehouse_code, i.name AS item_name,
      (
        SELECT COALESCE(SUM(
          l.qty - (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
        ), 0)
        FROM scm_doc_line l
        JOIN scm_doc d ON d.id = l.doc_id
        WHERE d.account_set_id = s.account_set_id
          AND d.doc_type = 'SOa'
          AND d.status = 'audited'
          AND l.item_code = s.item_code
          AND (l.warehouse_code = s.warehouse_code OR l.warehouse_code IS NULL OR l.warehouse_code = '')
      ) AS unshipped_sales_qty
    FROM scm_stock s
    LEFT JOIN scm_item i ON i.account_set_id=s.account_set_id AND i.code=s.item_code
`;
console.log(db.prepare(sql).all());

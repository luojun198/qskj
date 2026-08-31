const Database = require('better-sqlite3');
const db = new Database('d:/BDKF/cw0523/data/finance.db', { fileMustExist: true });

const account_set_id = '1be2a318-ddae-4863-b87a-db4e2407f525';

const sql = `
    WITH AllItems AS (
      SELECT item_code, warehouse_code FROM scm_stock WHERE account_set_id=?
      UNION
      SELECT l.item_code, l.warehouse_code
      FROM scm_doc_line l
      JOIN scm_doc d ON d.id = l.doc_id
      WHERE d.account_set_id=? AND d.doc_type='SOa' AND d.status='audited'
        AND l.qty > (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
    )
    SELECT a.item_code, a.warehouse_code, i.name AS item_name, i.spec, i.unit, w.name AS warehouse_name,
      COALESCE(s.qty, 0) AS qty, COALESCE(s.amount, 0) AS amount, COALESCE(s.avg_cost, 0) AS avg_cost,
      (
        SELECT COALESCE(SUM(
          l.qty - (SELECT COALESCE(SUM(l2.qty), 0) FROM scm_doc_line l2 WHERE l2.source_line_id = l.id)
        ), 0)
        FROM scm_doc_line l
        JOIN scm_doc d ON d.id = l.doc_id
        WHERE d.account_set_id = ?
          AND d.doc_type = 'SOa'
          AND d.status = 'audited'
          AND l.item_code = a.item_code
          AND (l.warehouse_code = a.warehouse_code OR (l.warehouse_code IS NULL AND a.warehouse_code IS NULL) OR (l.warehouse_code = '' AND a.warehouse_code = ''))
      ) AS unshipped_sales_qty
    FROM AllItems a
    LEFT JOIN scm_stock s ON s.account_set_id=? AND s.item_code=a.item_code AND s.warehouse_code=a.warehouse_code
    LEFT JOIN scm_item i ON i.account_set_id=? AND i.code=a.item_code
    LEFT JOIN scm_warehouse w ON w.account_set_id=? AND w.code=a.warehouse_code
    ORDER BY a.warehouse_code, a.item_code
`;

console.log(db.prepare(sql).all(account_set_id, account_set_id, account_set_id, account_set_id, account_set_id, account_set_id));

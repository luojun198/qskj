const Database = require('better-sqlite3');
const db = new Database('d:/BDKF/cw0523/data/finance.db', { fileMustExist: true });
db.prepare("UPDATE scm_doc_line SET item_code='100103' WHERE item_code='100204'").run();
console.log('updated');

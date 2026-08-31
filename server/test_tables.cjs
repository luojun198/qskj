const Database = require('better-sqlite3');
const db = new Database('D:/BDKF/cw0523/data/finance.db');
console.log(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all());

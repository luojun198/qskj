// 导入科目表脚本 (CommonJS)
// 用法: node scripts/importAccounts.js <account_set_id>
const XLSX = require('../../../node_modules/xlsx');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../../data/finance.db');
const XLS_PATH = path.join(__dirname, '../../../模版/科目表.XLS');

const accountSetId = process.argv[2];
if (!accountSetId) {
  console.error('Usage: node importAccounts.js <account_set_id>');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 读取XLS
const wb = XLSX.readFile(XLS_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

// 解析科目
const accounts = [];
for (let i = 0; i < data.length; i++) {
  const row = data[i];
  const codeRaw = String(row[0] || '').trim();
  const name = String(row[1] || '').trim();
  const directionRaw = String(row[2] || '').trim();

  // 跳过表头和空行
  if (!codeRaw || !name || codeRaw === '科目编码' || codeRaw === '科目表') continue;

  // 解析编码: "1001." → "1001", "1001.01." → "100101"
  const codeClean = codeRaw.replace(/\./g, '');
  const level = (codeRaw.match(/\./g) || []).length;

  // 方向: 0=借方, 1=贷方
  const direction = directionRaw === '1' ? 'credit' : 'debit';

  accounts.push({
    id: uuidv4(),
    account_set_id: accountSetId,
    code: codeClean,
    name,
    direction,
    level,
    parent_id: null,
    is_aux: 0,
    aux_types: null,
    is_cash: String(row[3] || '').trim() === '1' ? 1 : 0,
    is_bank: String(row[4] || '').trim() === '1' ? 1 : 0,
  });
}

// 计算parent_id
const codeToId = {};
for (const a of accounts) {
  codeToId[a.code] = a.id;
}
for (const a of accounts) {
  if (a.level > 1) {
    const parentCode = a.code.slice(0, -2);
    a.parent_id = codeToId[parentCode] || null;
  }
}

// 先删除该账套的旧科目
const deleteOld = db.prepare('DELETE FROM accounts WHERE account_set_id = ?');
const insertAccount = db.prepare(`
  INSERT INTO accounts (id, account_set_id, code, name, direction, level, parent_id, is_aux, aux_types, is_cash, is_bank, is_enabled, allow_delete)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
`);

const transaction = db.transaction(() => {
  deleteOld.run(accountSetId);
  let count = 0;
  for (const a of accounts) {
    insertAccount.run(
      a.id, a.account_set_id, a.code, a.name, a.direction, a.level,
      a.parent_id, a.is_aux, a.aux_types, a.is_cash, a.is_bank
    );
    count++;
  }
  return count;
});

const count = transaction();
console.log(`导入完成: ${count} 个科目`);

// 验证
const verify = db.prepare('SELECT level, COUNT(*) as cnt FROM accounts WHERE account_set_id = ? GROUP BY level ORDER BY level');
const levels = verify.all(accountSetId);
for (const l of levels) {
  console.log(`  ${l.level}级科目: ${l.cnt}个`);
}

db.close();

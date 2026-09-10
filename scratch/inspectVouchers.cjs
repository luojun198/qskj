const Database = require('better-sqlite3')
const db = new Database('../data/finance-0523.db', { readonly: true })
const setId = '96e41c72-0699-45b0-ad49-35048b1e875e'

console.log('admin user', db.prepare("SELECT id,username,role_id,account_scope_enabled,custom_permissions,status FROM users WHERE account_set_id=? AND username='admin'").get(setId))
const admin = db.prepare("SELECT id,role_id FROM users WHERE account_set_id=? AND username='admin'").get(setId)
console.log('role', db.prepare('SELECT id,name,code,account_scope_enabled,permissions FROM roles WHERE id=?').get(admin.role_id))
try {
  console.log('user_roles', db.prepare('SELECT ur.role_id, r.name, r.account_scope_enabled FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND ur.account_set_id=?').all(admin.id, setId))
} catch (e) { console.log('no user_roles', e.message) }
try {
  console.log('user_account_scopes', db.prepare('SELECT * FROM user_account_scopes WHERE user_id=?').all(admin.id))
} catch (e) { console.log('no user_account_scopes', e.message) }
try {
  console.log('role_account_scopes', db.prepare('SELECT * FROM role_account_scopes WHERE role_id=?').all(admin.role_id))
} catch (e) { console.log('no role_account_scopes', e.message) }

// fts check
console.log('fts rows for new vouchers', db.prepare("SELECT COUNT(*) c FROM vouchers_fts WHERE voucher_id IN (SELECT rowid FROM vouchers WHERE id IN ('e5aee7e9-aae1-48e4-a04f-0dd35c769a0b','4cfe7b4d-2340-4c6a-92b7-b9064691acb4'))").get())

// sim query ordering with voucher type
console.log('sim list', db.prepare(`SELECT v.voucher_no, v.voucher_date, v.status, vt.name FROM vouchers v LEFT JOIN voucher_types vt ON v.voucher_type_id=vt.id WHERE v.account_set_id=? AND v.status IN ('draft','audited') ORDER BY v.voucher_date DESC LIMIT 3`).all(setId))

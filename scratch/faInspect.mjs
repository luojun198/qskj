import Database from 'better-sqlite3'
const db = new Database('D:/BDKF/qskj/data/finance-0523.db', { readonly: true })
const sets = db.prepare('SELECT id, name, code FROM account_sets').all()
for (const s of sets) {
  const assets = db.prepare("SELECT COUNT(*) c FROM fixed_asset WHERE account_set_id=?").get(s.id).c
  const dep = db.prepare('SELECT COUNT(*) c FROM fixed_asset_depr WHERE account_set_id=?').get(s.id).c
  const acc = db.prepare(`SELECT code, name, direction, is_aux FROM accounts WHERE account_set_id=? AND (code LIKE '1601%' OR code LIKE '1602%' OR code LIKE '6602%' OR code LIKE '5101%' OR code LIKE '5%' AND name LIKE '%折旧%' OR name LIKE '%固定资产%' OR name LIKE '%累计折旧%') ORDER BY code`).all(s.id)
  const period = db.prepare("SELECT param_key, param_value FROM system_params WHERE account_set_id=? AND param_key IN ('current_year','current_period','start_date','require_audit','allow_direct_post','base_currency') ORDER BY param_key").all(s.id)
  const pc = db.prepare('SELECT year, period, status FROM period_closing WHERE account_set_id=? ORDER BY year DESC, period DESC LIMIT 3').all(s.id)
  console.log('=====', s.code, s.name, '| fixed_asset=', assets, 'depr=', dep)
  console.log('  params:', JSON.stringify(period))
  console.log('  closing:', JSON.stringify(pc))
  console.log('  accounts:', acc.map(a => `${a.code} ${a.name}${a.is_aux ? ' [aux]' : ''}`).join(' | '))
}

import Database from 'better-sqlite3'
import jwt from 'jsonwebtoken'

const base = 'http://localhost:3105/api'
const setId = '96e41c72-0699-45b0-ad49-35048b1e875e'
const db = new Database('./data/finance-0523.db', { readonly: true })
const admin = db.prepare("SELECT id,username,role_id FROM users WHERE account_set_id=? AND username='admin'").get(setId)
const session = db
  .prepare(
    "SELECT id FROM user_login_sessions WHERE user_id=? AND account_set_id=? AND status='active' ORDER BY last_seen_at DESC LIMIT 1"
  )
  .get(admin.id, setId)
console.log('active session', session)

const token = jwt.sign(
  { userId: admin.id, userName: admin.username, accountSetId: setId, roleId: admin.role_id, sessionId: session?.id, remember: true },
  'your-secret-key-change-this-in-production',
  { expiresIn: '10m' }
)

for (const q of [
  'status=unposted&page=1&pageSize=50&sortField=voucher_date&sortOrder=asc',
  'status=draft&page=1&pageSize=5',
  'page=1&pageSize=5',
  'status=unposted&page=1&pageSize=5&start_date=2026-09-01&end_date=2026-09-30',
]) {
  const r = await fetch(`${base}/voucher/vouchers?${q}`, { headers: { Authorization: `Bearer ${token}` } })
  const j = await r.json()
  console.log(q, '=> http', r.status, 'code', j.code, 'total', j.total, 'len', j.data?.length, j.message || '')
  if (j.data?.length) console.log('   first', j.data[0].voucher_no, j.data[0].voucher_date, j.data[0].status)
}

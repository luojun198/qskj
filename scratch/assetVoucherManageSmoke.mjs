/**
 * 固定资产「凭证管理」HTTP 冒烟：在开发库副本 + 独立端口后端上，
 * 对「测试」账套里已有的各类固定资产凭证走一遍：删除凭证 → 列表变未生成 → 重新生成 → 回链恢复。
 *
 * 运行：node scratch/assetVoucherManageSmoke.mjs
 */
import Database from 'better-sqlite3'
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const SRC_DB = join(ROOT, 'data', 'finance-0523.db')
const WORK = join(tmpdir(), 'asset-voucher-manage-smoke')
const TEMP_DB = join(WORK, 'finance.db')
const PORT = 3198
const BASE = `http://127.0.0.1:${PORT}`
let step = 0
let failed = 0
const check = (name, cond, detail = '') => {
  step++
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${step}. ${name}${detail ? ' — ' + detail : ''}`)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

let token = ''
let asid = ''
async function api(method, path, body, allowFail = false) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-account-set-id': asid },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok && !allowFail) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(json).slice(0, 300)}`)
  return { status: r.status, ...json }
}
const list = async (q = '') => (await api('GET', `/api/asset/vouchers?page_size=200${q}`)).data

let child
async function main() {
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const src = new Database(SRC_DB, { readonly: true })
  await src.backup(TEMP_DB)
  src.close()

  // 开发库里部分资产类别的原值科目配的是非末级科目（如 1601），原凭证是建类别前生成的；
  // 在副本里把它们改成各自的第一个末级下级科目，才能验证「重新生成」本身。
  {
    const db = new Database(TEMP_DB)
    const cats = db.prepare('SELECT id, account_set_id, account_code FROM fixed_asset_category WHERE account_code IS NOT NULL').all()
    for (const c of cats) {
      const kids = db
        .prepare("SELECT code FROM accounts WHERE account_set_id=? AND code LIKE ? AND code <> ? ORDER BY code")
        .all(c.account_set_id, `${c.account_code}%`, c.account_code)
      if (!kids.length) continue
      const leaf = kids.find(k => !kids.some(o => o.code !== k.code && o.code.startsWith(k.code)))
      if (leaf) {
        db.prepare('UPDATE fixed_asset_category SET account_code=? WHERE id=?').run(leaf.code, c.id)
        console.log(`副本：类别原值科目 ${c.account_code} → ${leaf.code}`)
      }
    }
    db.close()
  }

  child = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: join(ROOT, 'server'),
    env: { ...process.env, DB_PATH: TEMP_DB, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  for (let i = 0; i < 130; i++) {
    try { if ((await fetch(`${BASE}/api/auth/account-sets`)).ok) break } catch { /* wait */ }
    await sleep(700)
    if (i === 129) throw new Error('server not up\n' + log.slice(-3000))
  }

  const sets = (await fetch(`${BASE}/api/auth/account-sets`).then(x => x.json())).data
  for (const s of sets) {
    const lr = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: s.id }),
    }).then(x => x.json())
    if (!lr.token) continue
    token = lr.token
    asid = s.id
    const d = await list()
    if (d.list.some(r => r.hasVoucher)) { console.log(`账套：${s.code} ${s.name}，共 ${d.total} 条`); break }
  }
  check('找到含固定资产凭证的账套', !!asid && (await list()).list.some(r => r.hasVoucher))

  // 对每种类型取第一条「有凭证且可删」的记录走一遍
  for (const kind of ['purchase', 'depr', 'change', 'disposal', 'inventory']) {
    const row = (await list(`&kind=${kind}&status=generated`)).list.find(r => !r.deleteBlockReason)
    if (!row) { console.log(`SKIP ${kind}：账套内没有可删的已生成凭证`); continue }
    const label = `${kind} ${row.title}`

    const del = await api('POST', '/api/asset/vouchers/delete', { kind, ref_id: row.refId })
    check(`${label}：删除凭证`, del.code === 0, `凭证 ${del.data?.voucherNo}`)
    const after = (await list(`&kind=${kind}&ref_id=${encodeURIComponent(row.refId)}`)).list[0]
    check(`${label}：删除后回到未生成`, after && !after.hasVoucher)

    const dup = await api('POST', '/api/asset/vouchers/delete', { kind, ref_id: row.refId }, true)
    check(`${label}：无凭证时再删 → 只清回链不报错`, dup.code === 0)

    const input = {}
    if (kind === 'purchase') input.credit_account = '1001'
    if (kind === 'change' && row.changeKind !== 'impairment') input.counter_account = '1001'
    if (kind === 'disposal') { input.disposal_income = 100; input.disposal_expense = 10 }
    const gen = await api('POST', '/api/asset/vouchers/regenerate', { kind, ref_id: row.refId, ...input }, true)
    check(`${label}：重新生成`, gen.code === 0, gen.code === 0 ? `凭证 ${gen.data?.voucherNo}` : gen.message)
    const again = (await list(`&kind=${kind}&ref_id=${encodeURIComponent(row.refId)}`)).list[0]
    check(`${label}：生成后回链恢复`, again?.hasVoucher === true)
    const dupGen = await api('POST', '/api/asset/vouchers/regenerate', { kind, ref_id: row.refId, ...input }, true)
    check(`${label}：重复生成被拒`, dupGen.status === 400)
  }

  // 总账侧守卫仍然生效：asset_* 凭证不能在总账直接删
  const any = (await list('&status=generated')).list.find(r => r.voucherId)
  if (any) {
    const r = await api('DELETE', `/api/voucher/vouchers/${any.voucherId}`, undefined, true)
    check('总账直接删除固定资产凭证仍被拦截', r.status >= 400 && /凭证管理/.test(r.message || ''), r.message)
  }
  const bad = await api('POST', '/api/asset/vouchers/delete', { kind: 'nope', ref_id: 'x' }, true)
  check('非法类型 → 400', bad.status === 400)
}

try {
  await main()
} catch (e) {
  failed++
  console.error('ERROR', e.message)
} finally {
  child?.kill()
  await sleep(500)
  rmSync(WORK, { recursive: true, force: true })
}
console.log(failed ? `\n失败 ${failed} 项` : `\n全部通过（${step} 项）`)
process.exit(failed ? 1 : 0)

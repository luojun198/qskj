/**
 * 用润衡自己的 pzdj.txt（凭证头）和 hz.txt（科目月汇总）反向核对导入结果。
 * 用法：node scratch/acdVoucherCrossCheck.mjs   （需先跑 acdImportCheck.mjs 和 dumpAcd.mjs）
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const dumpDir = resolve(import.meta.dirname, 'acd-dump')
const db = new Database(resolve(import.meta.dirname, 'acd-test-db/finance.db'), { readonly: true })
const asId = db.prepare(`SELECT id FROM account_sets WHERE import_source='acd' ORDER BY created_at DESC LIMIT 1`).get().id

const rows = f => readFileSync(resolve(dumpDir, f), 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t'))

// 1) 凭证头：润衡 (pzlx, pzbh, rq, fds) vs 系统 (type code, voucher_no, voucher_date, attachments)
const typeNameByCode = new Map(db.prepare(`SELECT code, name FROM voucher_types WHERE account_set_id=?`).all(asId).map(r => [r.code, r.name]))
const sys = new Map(
  db
    .prepare(`SELECT vt.code type_code, v.voucher_no, v.voucher_date, v.attachments, v.status FROM vouchers v JOIN voucher_types vt ON vt.id=v.voucher_type_id WHERE v.account_set_id=?`)
    .all(asId)
    .map(r => [`${r.type_code}|${r.voucher_no}`, r])
)
let okNo = 0, okDate = 0, okAtt = 0, missing = 0
const badSamples = []
for (const h of rows('rhsj_pzdj.txt.dump.txt')) {
  const [nf, yf, pzlx, pzbh, fds, , , , , rq] = h
  const expectedNo = `${(typeNameByCode.get(pzlx) || '').charAt(0)}-${String(Number(pzbh)).padStart(3, '0')}`
  const s = sys.get(`${pzlx}|${expectedNo}`)
  if (!s) { missing++; if (badSamples.length < 5) badSamples.push({ pzlx, pzbh, expectedNo }); continue }
  okNo++
  if (s.voucher_date === rq) okDate++; else if (badSamples.length < 5) badSamples.push({ expectedNo, rq, got: s.voucher_date })
  if (Number(s.attachments) === Number(fds)) okAtt++
}
console.log(`pzdj rows=${rows('rhsj_pzdj.txt.dump.txt').length}  voucher_no matched=${okNo} missing=${missing}  date ok=${okDate}  attachments ok=${okAtt}`)
if (badSamples.length) console.log('samples:', JSON.stringify(badSamples))

// 2) 分录顺序：润衡 pz_xh 升序 == 系统 seq 升序（按科目序列比对）
const pz = rows('rhsj_pz.txt.dump.txt')
const acdOrder = new Map()
for (const r of pz) {
  const key = `${r[2]}|${r[3]}`
  if (!acdOrder.has(key)) acdOrder.set(key, [])
  acdOrder.get(key).push({ xh: Number(r[4]), km: r[5] })
}
const sysEntries = db
  .prepare(`SELECT vt.code type_code, v.voucher_no, ve.seq, ve.account_code FROM voucher_entries ve JOIN vouchers v ON v.id=ve.voucher_id JOIN voucher_types vt ON vt.id=v.voucher_type_id WHERE v.account_set_id=? ORDER BY v.id, ve.seq`)
  .all(asId)
const sysOrder = new Map()
for (const e of sysEntries) {
  const key = `${e.type_code}|${Number(e.voucher_no.split('-')[1])}`
  if (!sysOrder.has(key)) sysOrder.set(key, [])
  sysOrder.get(key).push(e.account_code)
}
let orderOk = 0, orderBad = 0
for (const [key, list] of acdOrder) {
  const expected = list.sort((a, b) => a.xh - b.xh).map(x => x.km).join(',')
  const got = (sysOrder.get(key) || []).join(',')
  if (expected === got) orderOk++; else orderBad++
}
console.log(`entry order: ok=${orderOk} bad=${orderBad}`)

// 3) hz.txt 科目月汇总（xmlb=0 且 xmbm=0000 为科目级）vs account_balances 当期发生额
const hz = rows('rhsj_hz.txt.dump.txt').filter(r => r[3] === '0' && r[5] === 'BWB')
const ab = new Map(
  db
    .prepare(`SELECT a.code, ab.year, ab.period, ROUND(SUM(ab.current_debit),2) d, ROUND(SUM(ab.current_credit),2) c FROM account_balances ab JOIN accounts a ON a.id=ab.account_id WHERE ab.account_set_id=? GROUP BY a.code, ab.year, ab.period`)
    .all(asId)
    .map(r => [`${r.code}|${r.year}|${r.period}`, r])
)
// hz 只记录末级? 也可能含父级；只比对账套中存在的科目
let hzOk = 0, hzBad = 0
const hzBadSamples = []
for (const r of hz) {
  const key = `${r[2]}|${Number(r[0])}|${Number(r[1])}`
  const got = ab.get(key)
  const d = Math.round(Number(r[6]) * 100) / 100, c = Math.round(Number(r[7]) * 100) / 100
  if (got && Math.abs(got.d - d) < 0.005 && Math.abs(got.c - c) < 0.005) hzOk++
  else { hzBad++; if (hzBadSamples.length < 6) hzBadSamples.push({ key, hz: [d, c], got: got ? [got.d, got.c] : null }) }
}
console.log(`hz account-level rows=${hz.length}  account_balances match=${hzOk} mismatch=${hzBad}`)
if (hzBadSamples.length) console.log('samples:', JSON.stringify(hzBadSamples))

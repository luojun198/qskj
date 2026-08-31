// 一次性测试数据：给「出纳测试」账套的辅助核算补充 部门 与 人员（个人）。
// 部门类别 code='dept'，人员类别 code='person'。幂等：已存在编码跳过。
const path = require('path')
const crypto = require('crypto')
const Database = require('better-sqlite3')

const DB = path.resolve(__dirname, '../../../data/finance.db')
const AID = '1be2a318-ddae-4863-b87a-db4e2407f525'
const db = new Database(DB)
const uuid = () => crypto.randomUUID()

const cat = (code) => {
  const r = db.prepare('SELECT id FROM aux_categories WHERE account_set_id=? AND code=?').get(AID, code)
  return r && r.id
}
const deptCat = cat('dept')
const personCat = cat('person')

const depts = [
  { code: 'BM001', name: '销售部' },
  { code: 'BM002', name: '采购部' },
  { code: 'BM003', name: '生产部' },
  { code: 'BM004', name: '仓储部' },
  { code: 'BM005', name: '财务部' },
  { code: 'BM006', name: '行政人事部' },
  { code: 'BM007', name: '技术研发部' },
  { code: 'BM008', name: '品质管理部' },
]
// 延续现有 RY001 张飞 的三国风
const persons = [
  { code: 'RY002', name: '关羽' },
  { code: 'RY003', name: '赵云' },
  { code: 'RY004', name: '马超' },
  { code: 'RY005', name: '黄忠' },
  { code: 'RY006', name: '诸葛亮' },
  { code: 'RY007', name: '姜维' },
  { code: 'RY008', name: '魏延' },
  { code: 'RY009', name: '庞统' },
]

const ins = db.prepare(
  "INSERT INTO aux_items (id,account_set_id,type,code,name,status,field_values) VALUES (?,?,?,?,?, 'active', '{}')"
)
const exists = (code) => !!db.prepare('SELECT 1 FROM aux_items WHERE account_set_id=? AND code=?').get(AID, code)

let addDept = 0, addPerson = 0
db.transaction(() => {
  if (deptCat) for (const d of depts) { if (exists(d.code)) continue; ins.run(uuid(), AID, deptCat, d.code, d.name); addDept++ }
  if (personCat) for (const p of persons) { if (exists(p.code)) continue; ins.run(uuid(), AID, personCat, p.code, p.name); addPerson++ }
})()

console.log('部门类别=' + (deptCat ? '有' : '无') + ' 人员类别=' + (personCat ? '有' : '无'))
console.log('新增 部门 ' + addDept + ' 个，人员 ' + addPerson + ' 个')
const list = (id, label) => {
  const rows = db.prepare('SELECT code,name FROM aux_items WHERE account_set_id=? AND type=? ORDER BY code').all(AID, id)
  console.log(label + '(' + rows.length + '): ' + rows.map(r => r.code + ' ' + r.name).join('、'))
}
if (deptCat) list(deptCat, '部门')
if (personCat) list(personCat, '人员')
db.close()

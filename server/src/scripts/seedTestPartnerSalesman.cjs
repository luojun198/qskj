// 测试数据：① 人员（业务员）绑定所属部门（写入 aux_item.field_values）；
//           ② 供应商/客户绑定业务员（scm_partner.salesman = 业务员名称）。
// 幂等：人员部门覆盖更新；供应商 salesman 仅补空。
const path = require('path')
const Database = require('better-sqlite3')

const DB = path.resolve(__dirname, '../../../data/finance.db')
const AID = '1be2a318-ddae-4863-b87a-db4e2407f525'
const db = new Database(DB)

// 业务员 → 所属部门（采购组→采购部 BM002，销售组→销售部 BM001）
const PURCHASE_STAFF = ['张飞', '关羽', '赵云', '马超', '黄忠']
const SALES_STAFF = ['诸葛亮', '姜维', '魏延', '庞统']
const staffDept = new Map()
for (const n of PURCHASE_STAFF) staffDept.set(n, { dept_code: 'BM002', dept_name: '采购部' })
for (const n of SALES_STAFF) staffDept.set(n, { dept_code: 'BM001', dept_name: '销售部' })

const personCat = db.prepare("SELECT id FROM aux_categories WHERE account_set_id=? AND code='person'").get(AID)

let deptSet = 0, supBound = 0, cusBound = 0

db.transaction(() => {
  // ① 人员写所属部门
  if (personCat) {
    const persons = db.prepare('SELECT id, name, field_values FROM aux_items WHERE account_set_id=? AND type=?').all(AID, personCat.id)
    const upd = db.prepare('UPDATE aux_items SET field_values=? WHERE id=?')
    for (const p of persons) {
      const dept = staffDept.get(p.name)
      if (!dept) continue
      let fv = {}
      try { fv = JSON.parse(p.field_values || '{}') } catch {}
      fv.dept_code = dept.dept_code
      fv.dept_name = dept.dept_name
      upd.run(JSON.stringify(fv), p.id)
      deptSet++
    }
  }

  // ② 供应商/客户绑业务员（仅补空）
  const bindSalesman = db.prepare('UPDATE scm_partner SET salesman=? WHERE id=?')
  const partners = db.prepare("SELECT id, code, partner_type, salesman FROM scm_partner WHERE account_set_id=? ORDER BY code").all(AID)
  let pi = 0, ci = 0
  for (const pt of partners) {
    if (pt.salesman) continue // 已绑不覆盖
    if (pt.partner_type === 'customer') {
      bindSalesman.run(SALES_STAFF[ci % SALES_STAFF.length], pt.id); ci++; cusBound++
    } else { // supplier / both → 采购组
      bindSalesman.run(PURCHASE_STAFF[pi % PURCHASE_STAFF.length], pt.id); pi++; supBound++
    }
  }
})()

console.log('人员部门类别=' + (personCat ? '有' : '无') + '，写部门人员数=' + deptSet)
console.log('绑业务员：供应商/both ' + supBound + ' 家，客户 ' + cusBound + ' 家')
// 核对
console.log('— 供应商 salesman 抽查 —')
db.prepare("SELECT code, name, salesman FROM scm_partner WHERE account_set_id=? AND partner_type IN ('supplier','both') ORDER BY code").all(AID)
  .forEach(p => console.log('  ' + p.code + ' ' + p.name + ' → ' + (p.salesman || '空')))
console.log('— 人员部门 —')
if (personCat) db.prepare('SELECT name, field_values FROM aux_items WHERE account_set_id=? AND type=? ORDER BY code').all(AID, personCat.id)
  .forEach(p => { let fv = {}; try { fv = JSON.parse(p.field_values || '{}') } catch {}; console.log('  ' + p.name + ' → ' + (fv.dept_code ? fv.dept_code + ' ' + (fv.dept_name || '') : '无部门')) })
db.close()

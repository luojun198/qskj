/**
 * 客户测试说明 20261011 回归用测试数据（开发库 data/finance-0523.db，账套「电脑配件进销存测试」）
 *
 * 用法：后端已启动（3105）后，在项目根目录执行
 *   node scripts/seed-test-20261012.mjs
 * 已存在的基础资料会跳过；单据按计划号 / 备注判断，已造过则跳过，可重复执行。
 *
 * 管理员密码复用 client/e2e/fixtures.ts 中的测试密码。
 * 另建一个「无委外加工单价修改权限」的测试操作员，账号密码见下方 TEST_USER。
 */
import fs from 'fs'

const API = 'http://127.0.0.1:3105/api'
const ACCOUNT_SET_NAME = '电脑配件进销存测试'
const TAG = '【测试20261012】'
const TEST_USER = { username: 't_cangku', password: 'Test@1012', nickname: '测试仓管（无加工单价权限）' }
const TEST_USER_PERMS = [
  'system:dashboard',
  'scm:item', 'scm:partner', 'scm:warehouse', 'scm:category', 'scm:stock', 'scm:opening',
  'scm:purchase', 'scm:sale', 'scm:inventory', 'scm:production', 'scm:outsource', 'scm:arap', 'scm:report',
  'scm:audit', 'scm:delete',
  // 故意不给 scm:outsource-price
]

const today = new Date().toISOString().slice(0, 10)
const adminPassword = fs.readFileSync(new URL('../client/e2e/fixtures.ts', import.meta.url), 'utf8').match(/const PASSWORD = ['"]([^'"]+)['"]/)[1]

let H = { 'content-type': 'application/json' }
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json().catch(() => ({}))
  return json
}
async function must(method, path, body, label) {
  const r = await call(method, path, body)
  if (r.code !== 0) throw new Error(`${label || path} 失败：${r.message || JSON.stringify(r)}`)
  return r.data
}
const log = (...a) => console.log('  ', ...a)

// ── 登录 ──
const sets = (await call('GET', '/auth/account-sets')).data || []
const as = sets.find(s => s.name === ACCOUNT_SET_NAME)
if (!as) throw new Error(`找不到账套「${ACCOUNT_SET_NAME}」`)
const login = await call('POST', '/auth/login', { username: 'admin', password: adminPassword, targetAccountSetId: as.id })
if (!login.token) throw new Error('管理员登录失败：' + JSON.stringify(login))
H = { ...H, authorization: `Bearer ${login.token}`, 'x-account-set-id': as.id }
console.log(`账套：${as.name}`)

// ── 基础资料 ──
console.log('1. 基础资料')
const listOf = d => (Array.isArray(d) ? d : d?.list || [])
async function ensure(kind, path, listPath, code, body) {
  const exists = listOf((await call('GET', listPath)).data).find(x => x.code === code)
  if (exists) { log(`${kind} ${code} 已存在`); return exists }
  await must('POST', path, { code, ...body }, `${kind} ${code}`)
  log(`${kind} ${code} ${body.name} 已建`)
}
await ensure('仓库', '/scm/warehouses', '/scm/warehouses', 'TCL01', { name: '测试材料仓' })
await ensure('仓库', '/scm/warehouses', '/scm/warehouses', 'TCP01', { name: '测试成品仓' })
await ensure('往来', '/scm/partners', '/scm/partners?keyword=T', 'TGYS01', { name: '测试材料供应商', partner_type: 'supplier', tax_rate: 13 })
await ensure('往来', '/scm/partners', '/scm/partners?keyword=T', 'TWW01', { name: '测试委外加工厂', partner_type: 'supplier', is_outsource: 1, tax_rate: 6 })
await ensure('往来', '/scm/partners', '/scm/partners?keyword=T', 'TKH01', { name: '测试客户', partner_type: 'customer', tax_rate: 13 })
const itemList = '/scm/items?keyword=T&page_size=200'
await ensure('物料', '/scm/items', itemList, 'TM01', { name: '测试电容', spec: '5W', unit: '个', source_type: 'purchase', supplier_code: 'TGYS01', purchase_price: 2, default_warehouse_code: 'TCL01' })
await ensure('物料', '/scm/items', itemList, 'TM02', { name: '测试电阻', spec: '1.5W', unit: '个', source_type: 'purchase', supplier_code: 'TGYS01', purchase_price: 1.5, default_warehouse_code: 'TCL01' })
await ensure('物料', '/scm/items', itemList, 'TFG01', { name: '测试集成二极管', spec: 'A型', unit: '个', source_type: 'outsource', supplier_code: 'TWW01', outsource_fee: 5, outsource_tax_rate: 6, default_warehouse_code: 'TCP01' })
await ensure('物料', '/scm/items', itemList, 'TFG02', { name: '测试稳压模块', spec: 'B型', unit: '个', source_type: 'outsource', supplier_code: 'TWW01', outsource_fee: 8, outsource_tax_rate: 6, default_warehouse_code: 'TCP01' })

const boms = listOf((await call('GET', '/scm/boms')).data)
async function ensureBom(code, item, lines) {
  const ex = boms.find(b => b.code === code)
  if (ex) { log(`BOM ${code} 已存在`); return ex.id }
  const d = await must('POST', '/scm/boms', { code, name: `${item} 测试BOM`, item_code: item, lines }, `BOM ${code}`)
  log(`BOM ${code} 已建`)
  return d.id
}
const bom1 = await ensureBom('TBOM-FG01', 'TFG01', [{ item_code: 'TM01', qty: 2 }, { item_code: 'TM02', qty: 2 }])
const bom2 = await ensureBom('TBOM-FG02', 'TFG02', [{ item_code: 'TM01', qty: 1 }, { item_code: 'TM02', qty: 3 }])

// ── 单据 ──
const plans = listOf((await call('GET', '/scm/production-plans?plan_type=outsource&page_size=500')).data)
if (plans.some(p => p.code === 'OUT-T1012-01')) {
  console.log('2. 测试单据已存在（OUT-T1012-01），跳过单据生成')
  process.exit(0)
}

async function createDoc(body, audit = true) {
  const d = await must('POST', '/scm/docs', { doc_date: today, remark: TAG, ...body }, `${body.doc_type} 新建`)
  if (audit) await must('POST', `/scm/docs/${d.id}/audit`, {}, `${body.doc_type} ${d.doc_no} 审核`)
  log(`${body.doc_type} ${d.doc_no} ${audit ? '已审核' : '草稿'}${body.remark ? '：' + body.remark : ''}`)
  return d
}

console.log('2. 期初库存')
await createDoc({ doc_type: 'IS', warehouse_code: 'TCL01', remark: `${TAG}材料期初`,
  lines: [{ item_code: 'TM01', qty: 40, price: 2 }, { item_code: 'TM02', qty: 30, price: 1.5 }] })

console.log('3. 场景一：委外计划 50 → 跑 MRP → 下推采购 → 部分发料（变更为 100 由您手工测）')
const p1 = await must('POST', '/scm/production-plans', { code: 'OUT-T1012-01', plan_type: 'outsource', supplier_code: 'TWW01',
  yl_warehouse: 'TCL01', fp_warehouse: 'TCP01', start_date: today, end_date: today, remark: `${TAG}客户场景：先 50 跑 MRP，后加单到 100`,
  products: [{ item_code: 'TFG01', plan_qty: 50, bom_id: bom1, fp_warehouse: 'TCP01', process_fee: 5, process_tax_rate: 6 }] }, '委外计划 1')
await must('POST', `/scm/production-plans/${p1.id}/release`, {}, '委外计划 1 审核')
log('委外计划 OUT-T1012-01 已审核（TFG01 × 50，加工单价 5 / 税率 6%）')
const mrp = await must('POST', '/scm/mrp-docs', { doc_date: today, remark: TAG, sources: [{ kind: 'outsource_plan', id: p1.id }] }, 'MRP 新建')
await must('POST', `/scm/mrp-docs/${mrp.id}/calculate`, {}, 'MRP 计算')
await must('POST', `/scm/mrp-docs/${mrp.id}/audit`, {}, 'MRP 审核')
log(`MRP ${mrp.doc_no} 已计算并审核`)
const preview = await must('GET', `/scm/docs/${mrp.id}/downstream-preview`, null, 'MRP 下推预览')
const nodes = (preview.nodes || []).filter(n => n.source_type === 'purchase' && Number(n.suggest_qty) > 0)
if (nodes.length) {
  const gen = await must('POST', `/scm/docs/${mrp.id}/gen-downstream`, { targets: ['purchase'], force: true,
    selected_nodes: nodes.map(n => ({ key: n.key, qty: n.suggest_qty, supplier_code: n.supplier_code || 'TGYS01' })) }, 'MRP 下推采购')
  const pos = listOf((await call('GET', '/scm/docs?doc_type=PO&page_size=200')).data).filter(d => d.source_doc_id === mrp.id)
  for (const po of pos) {
    if (po.status !== 'audited') await must('POST', `/scm/docs/${po.id}/audit`, {}, `PO ${po.doc_no} 审核`)
    log(`MRP 欠料采购单 ${po.doc_no} 已审核`)
  }
  if (!pos.length) log('MRP 下推返回：' + JSON.stringify(gen).slice(0, 200))
} else log('MRP 无欠料（库存足够），未生成采购单')
await createDoc({ doc_type: 'WO', plan_id: p1.id, partner_code: 'TWW01', warehouse_code: 'TCL01', remark: `${TAG}委外发料（部分）`,
  lines: [{ item_code: 'TM01', qty: 30, warehouse_code: 'TCL01' }, { item_code: 'TM02', qty: 30, warehouse_code: 'TCL01' }] })

console.log('4. 场景二：委外计划（未跑 MRP）用于测委外入库 / 加工单价权限')
const p2 = await must('POST', '/scm/production-plans', { code: 'OUT-T1012-02', plan_type: 'outsource', supplier_code: 'TWW01',
  yl_warehouse: 'TCL01', fp_warehouse: 'TCP01', start_date: today, end_date: today, remark: `${TAG}测委外入库、加工单价权限`,
  products: [{ item_code: 'TFG02', plan_qty: 20, bom_id: bom2, fp_warehouse: 'TCP01', process_fee: 8, process_tax_rate: 6 }] }, '委外计划 2')
await must('POST', `/scm/production-plans/${p2.id}/release`, {}, '委外计划 2 审核')
log('委外计划 OUT-T1012-02 已审核（TFG02 × 20，加工单价 8 / 税率 6%）')

console.log('5. 场景三：采购订单（表头仓库 + 13% 税率，明细不填仓库 / 税率）用于测下推')
for (const [i, qty] of [[1, 100], [2, 60]]) {
  await createDoc({ doc_type: 'PO', partner_code: 'TGYS01', warehouse_code: 'TCL01', tax_rate: 13, remark: `${TAG}下推测试 ${i}`,
    lines: [{ item_code: 'TM01', qty, price: 2, warehouse_code: null, tax_rate: null }, { item_code: 'TM02', qty, price: 1.5, warehouse_code: null, tax_rate: null }] })
}
await createDoc({ doc_type: 'PO', partner_code: 'TGYS01', warehouse_code: 'TCL01', tax_rate: 13, remark: `${TAG}草稿（测改 / 删）`,
  lines: [{ item_code: 'TM02', qty: 10, price: 1.5 }] }, false)

console.log('6. 场景四：对账单（已审核入库 + 草稿对账单，测另存 / 打印）')
await createDoc({ doc_type: 'PI', partner_code: 'TGYS01', warehouse_code: 'TCL01', tax_rate: 13, remark: `${TAG}对账用入库`,
  lines: [{ item_code: 'TM01', qty: 20, price: 2, tax_rate: 13 }, { item_code: 'TM02', qty: 10, price: 1.5, tax_rate: 13 }] })
const cand = await must('GET', `/scm/statements/candidates?direction=ap&partner_code=TGYS01&end_date=${today}`, null, '对账候选')
if ((cand.rows || []).length) {
  const st = await must('POST', '/scm/statements', { direction: 'ap', partner_code: 'TGYS01', stmt_date: today, end_date: today, remark: TAG,
    lines: cand.rows.map(r => ({ src_kind: r.src_kind, src_line_id: r.src_line_id, src_log_id: r.src_log_id })) }, '对账单')
  log(`对账单 ${st.stmt_no} 草稿`)
}

console.log('7. 测试操作员（无委外加工单价修改权限）')
const users = listOf((await call('GET', '/system/users')).data)
if (users.some(u => u.username === TEST_USER.username)) log(`用户 ${TEST_USER.username} 已存在`)
else {
  await must('POST', '/system/users', { ...TEST_USER, custom_permissions: TEST_USER_PERMS }, '测试用户')
  log(`用户 ${TEST_USER.username}（${TEST_USER.nickname}）已建`)
}
console.log('完成')

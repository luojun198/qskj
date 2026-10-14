/**
 * 「进销存凭证测试」账套（ZT004）：录入基础档案 + 一批进销存单据（已审核、未生成凭证），供手工测试生成凭证。
 * 走正在运行的后端（3105）接口，审核时库存 / 成本 / 往来台账按正常逻辑处理。
 *
 *   node scratch/seedScmVoucherTestSet.mjs
 *
 * 设计：
 *   - 1122 应收挂「客户」辅助、2202 应付挂「供应商」辅助、6001001 销货收入挂「部门」辅助
 *   - 1002 下建工行 / 建行两个末级银行科目；1403 原材料下建主要材料 / 辅助材料（测「下探到末级」）
 *   - 往来单位三种：名称与辅助项目完全一致 / 名称近似 / 全新
 *   - 进销存凭证设置不配置，留给手工测「一键自动预设」
 */
const BASE = 'http://127.0.0.1:3105'
const SET_NAME = '进销存凭证测试'
const D = '2026-10-07'

let token = ''
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const txt = await r.text()
  let json; try { json = txt ? JSON.parse(txt) : {} } catch { json = { raw: txt } }
  return { status: r.status, ...json }
}
const get = p => api('GET', p)
const post = (p, b) => api('POST', p, b ?? {})
const put = (p, b) => api('PUT', p, b ?? {})

function must(r, what) {
  if (r.status !== 200 || (r.code !== undefined && r.code !== 0)) throw new Error(`${what}：${r.status} ${r.message}`)
  return r
}
async function ensure(path, body, what) {
  const r = await post(path, body)
  if (r.status !== 200 && !/已存在|重复/.test(r.message || '')) throw new Error(`${what || path}：${r.status} ${r.message}`)
  return r
}

const created = []
async function doc(title, body) {
  const r = await post('/api/scm/docs', { doc_date: D, ...body })
  if (r.code !== 0) throw new Error(`建单失败「${title}」：${r.message}`)
  const a = await post(`/api/scm/docs/${r.data.id}/audit`, { apply_item_default_warehouses: true })
  if (a.code !== 0) throw new Error(`审核失败「${title}」${r.data.doc_no}：${a.message}`)
  created.push({ no: r.data.doc_no, title })
  console.log(`✓ ${r.data.doc_no}  ${title}`)
}

async function main() {
  const sets = (await fetch(`${BASE}/api/auth/account-sets`).then(x => x.json())).data
  const set = sets.find(s => s.name === SET_NAME)
  if (!set) throw new Error(`找不到账套「${SET_NAME}」`)
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: set.id }),
  }).then(x => x.json())
  token = lr.token
  if (!token) throw new Error('登录失败：' + lr.message)
  console.log(`登录账套 ${set.code} ${set.name}`)

  // ── 辅助核算类别与项目 ──
  await ensure('/api/base/aux-categories', { code: 'kh', name: '客户' }, '类别 客户')
  await ensure('/api/base/aux-categories', { code: 'gys', name: '供应商' }, '类别 供应商')
  const cats = must(await get('/api/base/aux-categories'), '读取类别').data
  const cat = code => cats.find(c => c.code === code)?.id
  const auxItem = (type, code, name) => ensure('/api/base/aux-items', { type: cat(type), code, name }, `辅助项目 ${name}`)
  await auxItem('kh', 'K01', '广州华南电子有限公司')
  await auxItem('kh', 'K02', '深圳市东方贸易有限公司')
  await auxItem('gys', 'G01', '东莞精密材料有限公司')
  await auxItem('gys', 'G02', '惠州宏达包装材料有限公司')
  await auxItem('dept', '01', '销售部')
  await auxItem('dept', '02', '采购部')
  await auxItem('dept', '03', '仓储部')
  await auxItem('person', 'P01', '张三')
  await auxItem('person', 'P02', '李四')
  console.log('✓ 辅助核算：客户 2 / 供应商 2 / 部门 3 / 个人 2')

  // ── 科目：末级银行、原材料明细、辅助核算 ──
  const accounts = () => get('/api/base/accounts?all=1').then(r => r.data)
  let accs = await accounts()
  const acc = code => accs.find(a => a.code === code)
  const addChild = async (parentCode, code, name, extra = {}) => {
    if (acc(code)) return
    const p = acc(parentCode)
    must(await post('/api/base/accounts', { code, name, direction: p.direction, level: (p.level || 1) + 1, parent_id: p.id, migrate_from_parent: true, ...extra }), `科目 ${code}`)
  }
  await addChild('1002', '1002001', '工商银行深圳分行', { is_bank: 1 })
  await addChild('1002', '1002002', '建设银行深圳分行', { is_bank: 1 })
  await addChild('1403', '1403001', '主要材料')
  await addChild('1403', '1403002', '辅助材料')
  accs = await accounts()
  const setAux = async (code, catCodes) => {
    const a = acc(code)
    const auxTypes = Object.fromEntries(catCodes.map(c => [cat(c), null]))
    // 修改接口是整行覆盖：没传 is_enabled 会把科目停用，必须带上原有字段
    must(await put(`/api/base/accounts/${a.id}`, { ...a, is_enabled: 1, is_aux: 1, aux_types: auxTypes }), `科目 ${code} 挂辅助`)
  }
  await setAux('1122', ['kh'])
  await setAux('2202', ['gys'])
  await setAux('6001001', ['dept'])
  console.log('✓ 科目：1002001/1002002 银行、1403001/1403002 原材料明细；1122→客户、2202→供应商、6001001→部门')

  // ── 进销存基础档案 ──
  await get('/api/scm/docs/types')   // 触发单据类型种子化
  await ensure('/api/scm/warehouses', { code: 'CK01', name: '原料仓' })
  await ensure('/api/scm/warehouses', { code: 'CK02', name: '成品仓' })
  await ensure('/api/scm/items', { code: 'YL001', name: '不锈钢板', spec: '1.2mm', unit: 'kg', item_type: '0', purchase_price: 25, default_warehouse_code: 'CK01' })                          // 无存货科目
  await ensure('/api/scm/items', { code: 'YL002', name: '包装纸箱', spec: '60×40', unit: '个', item_type: '0', purchase_price: 3, default_warehouse_code: 'CK01', inv_account: '1403002' })
  await ensure('/api/scm/items', { code: 'BC001', name: '控制主板', unit: '块', item_type: '6', purchase_price: 60, default_warehouse_code: 'CK02' })                                          // 半成品，无存货科目
  await ensure('/api/scm/items', { code: 'CP001', name: '智能控制器', spec: 'ZK-100', unit: '台', item_type: '9', purchase_price: 120, sale_price: 200, default_warehouse_code: 'CK02', inv_account: '1406' })
  await ensure('/api/scm/items', { code: 'CP002', name: '电源适配器', spec: '12V2A', unit: '个', item_type: '9', purchase_price: 40, sale_price: 80, default_warehouse_code: 'CK02' })      // 无存货科目
  // 客户：完全一致 / 近似 / 全新
  await ensure('/api/scm/partners', { code: 'KH001', name: '广州华南电子有限公司', partner_type: 'customer', contact: '王经理', phone: '020-88880001', salesman: '张三' })
  await ensure('/api/scm/partners', { code: 'KH002', name: '深圳东方贸易', partner_type: 'customer', salesman: '张三' })
  await ensure('/api/scm/partners', { code: 'KH003', name: '佛山新兴五金厂', partner_type: 'customer', salesman: '李四' })
  // 供应商：完全一致 / 近似 / 全新
  await ensure('/api/scm/partners', { code: 'GY001', name: '东莞精密材料有限公司', partner_type: 'supplier', contact: '陈工', phone: '0769-22220001' })
  await ensure('/api/scm/partners', { code: 'GY002', name: '惠州宏达包装', partner_type: 'supplier' })
  await ensure('/api/scm/partners', { code: 'GY003', name: '中山新源化工有限公司', partner_type: 'supplier' })
  console.log('✓ 进销存档案：2 仓库 / 5 物料 / 3 客户 / 3 供应商')

  const tax = (amt, rate = 13) => Math.round(amt * rate) / 100
  const L = (item_code, qty, price, rate = 13) => ({ item_code, qty, price, tax_rate: rate, tax_amount: tax(qty * price, rate) })

  // ── 采购 ──
  await doc('采购入库 · 东莞精密（完全一致；不锈钢板无存货科目→1403 下探到末级）', { doc_type: 'PI', partner_code: 'GY001', warehouse_code: 'CK01', dept_code: '02',
    lines: [L('YL001', 200, 25), L('YL002', 100, 3)] })
  await doc('采购入库 · 东莞精密 成品 / 半成品（电源适配器、控制主板无存货科目）', { doc_type: 'PI', partner_code: 'GY001', warehouse_code: 'CK02', dept_code: '02',
    lines: [L('CP001', 100, 120), L('CP002', 50, 40), L('BC001', 20, 60)] })
  await doc('采购入库 · 惠州宏达包装（名称近似→拦截，采纳建议）', { doc_type: 'PI', partner_code: 'GY002', warehouse_code: 'CK01',
    lines: [L('YL002', 500, 2.8)] })
  await doc('采购入库 · 中山新源化工（全新→拦截，自动新建）', { doc_type: 'PI', partner_code: 'GY003', warehouse_code: 'CK01',
    lines: [L('YL001', 50, 26)] })
  await doc('采购退货 · 东莞精密 退不锈钢板 20kg', { doc_type: 'PR', partner_code: 'GY001', warehouse_code: 'CK01',
    lines: [L('YL001', 20, 25)] })
  await doc('采购发票（独立录入）· 东莞精密 电源适配器', { doc_type: 'RP', partner_code: 'GY001',
    lines: [{ ...L('CP002', 5, 40), amount: 200 }] })

  // ── 销售（6001001 挂部门辅助，销售单带部门 01 销售部）──
  await doc('销售发货 · 华南电子（完全一致；收入带部门、结转成本）', { doc_type: 'SO', partner_code: 'KH001', warehouse_code: 'CK02', dept_code: '01', biz_person: '张三',
    lines: [L('CP001', 30, 200)] })
  await doc('销售发货 · 深圳东方贸易（名称近似→拦截，采纳建议）', { doc_type: 'SO', partner_code: 'KH002', warehouse_code: 'CK02', dept_code: '01', biz_person: '张三',
    lines: [L('CP002', 10, 80)] })
  await doc('销售发货 · 佛山新兴五金厂（全新→拦截，自动新建）', { doc_type: 'SO', partner_code: 'KH003', warehouse_code: 'CK02', dept_code: '01', biz_person: '李四',
    lines: [L('CP001', 5, 210)] })
  await doc('销售发货 · 华南电子【未填部门】（收入科目要部门→拦截「单据未填部门」）', { doc_type: 'SO', partner_code: 'KH001', warehouse_code: 'CK02',
    lines: [L('CP002', 3, 80)] })
  await doc('销售退货 · 华南电子 退 3 台', { doc_type: 'SR', partner_code: 'KH001', warehouse_code: 'CK02', dept_code: '01',
    lines: [L('CP001', 3, 200)] })
  await doc('销售发票（独立录入）· 华南电子 电源适配器', { doc_type: 'RS', partner_code: 'KH001', dept_code: '01',
    lines: [{ ...L('CP002', 2, 80), amount: 160 }] })

  // ── 收付款 ──
  await doc('收款单 · 华南电子 收 5000（工商银行）', { doc_type: 'RCV', partner_code: 'KH001', settle_account: '1002001', payment_type: 'transfer',
    lines: [{ item_code: '', qty: 1, price: 5000, amount: 5000, remark: '收货款' }] })
  await doc('收款单 · 佛山新兴五金厂 收 1000 现金（全新客户→拦截）', { doc_type: 'RCV', partner_code: 'KH003', settle_account: '1001', payment_type: 'cash',
    lines: [{ item_code: '', qty: 1, price: 1000, amount: 1000, remark: '收订金' }] })
  await doc('付款单 · 东莞精密 付 3000（建设银行）', { doc_type: 'PAY', partner_code: 'GY001', settle_account: '1002002', payment_type: 'transfer',
    lines: [{ item_code: '', qty: 1, price: 3000, amount: 3000, remark: '付材料款' }] })

  // ── 库存 ──
  await doc('其他入库 · 盘盈不锈钢板 5kg', { doc_type: 'OI', warehouse_code: 'CK01', io_category: '盘盈',
    lines: [{ item_code: 'YL001', qty: 5, price: 25 }] })
  await doc('其他出库 · 领用包装纸箱 10 个', { doc_type: 'OO', warehouse_code: 'CK01', io_category: '领用',
    lines: [{ item_code: 'YL002', qty: 10, price: 3 }] })
  await doc('调拨单 · 成品仓→原料仓 控制器 10 台（不生成凭证）', { doc_type: 'TR', warehouse_code: 'CK02',
    lines: [{ item_code: 'CP001', qty: 10, warehouse_code: 'CK01' }] })

  console.log(`\n共建 ${created.length} 张单据（均已审核、未生成凭证）`)
}

main().catch(e => { console.error('✗', e.message); process.exitCode = 1 })

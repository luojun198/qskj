/**
 * 在开发库「测试」账套建一批进销存单据（已审核、未生成凭证），供手工测试「生成凭证」。
 * 走正在运行的后端（3105）接口，审核时库存 / 成本 / 往来台账按正常逻辑处理。
 *
 *   node scratch/seedScmVoucherTestDocs.mjs
 *
 * 往来单位刻意分三种，用来测辅助核算严格对应：
 *   名称与总账辅助项目完全一致 → 直接出凭证
 *   名称略有差异              → 拦截，设置页有「近似建议」可采纳
 *   全新单位                  → 拦截，可「自动新建辅助项并重试」
 */
const BASE = 'http://127.0.0.1:3105'
const TEST_SET = '1409b0d2-7e8c-4e27-ab5f-5e143be3e89d'   // ZT001 测试
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
const post = (p, b) => api('POST', p, b ?? {})

async function ensure(path, body) {
  const r = await post(path, body)
  if (r.status !== 200 && !/已存在/.test(r.message || '')) throw new Error(`${path} ${body.code}: ${r.status} ${r.message}`)
}

const created = []
async function doc(title, body) {
  const r = await post('/api/scm/docs', { doc_date: D, ...body })
  if (r.code !== 0) throw new Error(`建单失败「${title}」：${r.message}`)
  const a = await post(`/api/scm/docs/${r.data.id}/audit`, { apply_item_default_warehouses: true })
  if (a.code !== 0) throw new Error(`审核失败「${title}」${r.data.doc_no}：${a.message}`)
  created.push({ no: r.data.doc_no, title })
  console.log(`✓ ${r.data.doc_no}  ${title}`)
  return r.data
}

async function main() {
  const lr = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123', targetAccountSetId: TEST_SET }),
  }).then(x => x.json())
  token = lr.token
  if (!token) throw new Error('登录失败')
  await api('GET', '/api/scm/docs/types')   // 触发单据类型种子化

  // ── 基础档案 ──
  await ensure('/api/scm/warehouses', { code: 'CK01', name: '测试主仓' })
  await ensure('/api/scm/warehouses', { code: 'CK02', name: '测试分仓' })
  // 原料、无科目商品故意不配存货科目：测「按物料类型取末级」（原材料 1403 / 库存商品 1406）
  await ensure('/api/scm/items', { code: 'CL001', name: '测试原料-铜线', unit: 'kg', item_type: '0', purchase_price: 10, sale_price: 15, default_warehouse_code: 'CK01' })
  await ensure('/api/scm/items', { code: 'CP001', name: '测试成品-电池模组', unit: '个', item_type: '9', purchase_price: 40, sale_price: 80, default_warehouse_code: 'CK01', inv_account: '1406' })
  await ensure('/api/scm/items', { code: 'CP002', name: '测试商品-无存货科目', unit: '个', item_type: '9', purchase_price: 20, sale_price: 35, default_warehouse_code: 'CK01' })
  // 客户（总账「客户」辅助项目：惠州市德赛电池科技有限公司 / 惠州市致远复杂新料科技有限公司）
  await ensure('/api/scm/partners', { code: 'KH001', name: '惠州市德赛电池科技有限公司', partner_type: 'customer' })   // 完全一致
  await ensure('/api/scm/partners', { code: 'KH002', name: '惠州市致远复杂新料科技', partner_type: 'customer' })     // 近似
  await ensure('/api/scm/partners', { code: 'KH003', name: '深圳市测试新客户有限公司', partner_type: 'customer' })   // 全新
  // 供应商（总账「供应商」辅助项目：东莞市东友智能设备有限公司 / 东莞市丰科贸易有限公司）
  await ensure('/api/scm/partners', { code: 'GYS001', name: '东莞市东友智能设备有限公司', partner_type: 'supplier' }) // 完全一致
  await ensure('/api/scm/partners', { code: 'GYS002', name: '东莞丰科贸易', partner_type: 'supplier' })             // 近似
  await ensure('/api/scm/partners', { code: 'GYS003', name: '广州市测试新供应商有限公司', partner_type: 'supplier' }) // 全新
  console.log('✓ 基础档案：2 仓库 / 3 物料 / 3 客户 / 3 供应商')

  const tax = (amt, rate = 13) => Math.round(amt * rate) / 100

  // ── 采购 ──
  await doc('采购入库 · 东友（名称完全一致，应直接出凭证；原料无存货科目→原材料末级）', { doc_type: 'PI', partner_code: 'GYS001', warehouse_code: 'CK01',
    lines: [{ item_code: 'CL001', qty: 100, price: 10, tax_rate: 13, tax_amount: tax(1000) }, { item_code: 'CP001', qty: 50, price: 40, tax_rate: 13, tax_amount: tax(2000) }] })
  await doc('采购入库 · 东莞丰科贸易（名称近似，应拦截→采纳建议）', { doc_type: 'PI', partner_code: 'GYS002', warehouse_code: 'CK01',
    lines: [{ item_code: 'CL001', qty: 50, price: 10, tax_rate: 13, tax_amount: tax(500) }] })
  await doc('采购入库 · 广州新供应商（全新，应拦截→自动新建）', { doc_type: 'PI', partner_code: 'GYS003', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP002', qty: 30, price: 20, tax_rate: 13, tax_amount: tax(600) }] })
  await doc('采购退货 · 东友 退铜线 10kg', { doc_type: 'PR', partner_code: 'GYS001', warehouse_code: 'CK01',
    lines: [{ item_code: 'CL001', qty: 10, price: 10, tax_rate: 13, tax_amount: tax(100) }] })
  await doc('采购发票（独立录入）· 东友 无存货科目商品', { doc_type: 'RP', partner_code: 'GYS001',
    lines: [{ item_code: 'CP002', qty: 5, price: 20, amount: 100, tax_rate: 13, tax_amount: tax(100) }] })

  // ── 销售 ──
  await doc('销售发货 · 德赛（名称完全一致；收入 + 结转成本）', { doc_type: 'SO', partner_code: 'KH001', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP001', qty: 20, price: 80, tax_rate: 13, tax_amount: tax(1600) }] })
  await doc('销售发货 · 致远（名称近似，应拦截→采纳建议）', { doc_type: 'SO', partner_code: 'KH002', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP001', qty: 5, price: 80, tax_rate: 13, tax_amount: tax(400) }] })
  await doc('销售发货 · 深圳新客户（全新，应拦截→自动新建）', { doc_type: 'SO', partner_code: 'KH003', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP002', qty: 10, price: 35, tax_rate: 13, tax_amount: tax(350) }] })
  await doc('销售退货 · 德赛 退 2 个', { doc_type: 'SR', partner_code: 'KH001', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP001', qty: 2, price: 80, tax_rate: 13, tax_amount: tax(160) }] })
  await doc('销售发票（独立录入）· 德赛 服务费', { doc_type: 'RS', partner_code: 'KH001',
    lines: [{ item_code: 'CP001', qty: 1, price: 500, amount: 500, tax_rate: 13, tax_amount: tax(500) }] })

  // ── 收付款 ──
  await doc('收款单 · 德赛 收 1000（中国银行）', { doc_type: 'RCV', partner_code: 'KH001', settle_account: '1002001', payment_type: 'transfer',
    lines: [{ item_code: '', qty: 1, price: 1000, amount: 1000, remark: '收货款' }] })
  await doc('付款单 · 东友 付 2000（平安银行）', { doc_type: 'PAY', partner_code: 'GYS001', settle_account: '1002002', payment_type: 'transfer',
    lines: [{ item_code: '', qty: 1, price: 2000, amount: 2000, remark: '付货款' }] })

  // ── 库存 ──
  await doc('其他入库 · 盘盈铜线 5kg', { doc_type: 'OI', warehouse_code: 'CK01', io_category: '盘盈',
    lines: [{ item_code: 'CL001', qty: 5, price: 10 }] })
  await doc('其他出库 · 领用铜线 3kg', { doc_type: 'OO', warehouse_code: 'CK01', io_category: '领用',
    lines: [{ item_code: 'CL001', qty: 3, price: 10 }] })
  await doc('调拨单 · CK01→CK02 模组 5 个（不生成凭证，应提示无有效分录）', { doc_type: 'TR', warehouse_code: 'CK01',
    lines: [{ item_code: 'CP001', qty: 5, warehouse_code: 'CK02' }] })

  console.log(`\n共建 ${created.length} 张单据（均已审核、未生成凭证）`)
}

main().catch(e => { console.error('✗', e.message); process.exitCode = 1 })

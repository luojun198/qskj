/**
 * 「电脑配件进销存测试」账套（新企业会计准则）：电脑配件买卖的基础档案 + 2026-07 ~ 2026-10 跨月模拟进销存单据
 * （已审核、未生成凭证），供测试「进销存 → 凭证生成」。走正在运行的后端（3105）接口。
 *
 *   node scratch/seedScmComputerTradeSet.mjs
 *
 * 账套需先建好（from-standard-template，standard_template_id=新企业会计准则，start_date=2026-07-01）。
 * 随机数用固定种子，重复运行得到同一批数据（单据号会因已存在而顺延，请只在空账套上跑一次）。
 */
const BASE = 'http://127.0.0.1:3105'
const SET_NAME = '电脑配件进销存测试'

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
const must = (r, what) => {
  if (r.status !== 200 || (r.code !== undefined && r.code !== 0)) throw new Error(`${what}：${r.status} ${r.message}`)
  return r
}
const ensure = async (path, body, what) => {
  const r = await post(path, body)
  if (r.status !== 200 && !/已存在|重复/.test(r.message || '')) throw new Error(`${what || path}：${r.status} ${r.message}`)
  return r
}

// 固定种子随机数
let seed = 20260707
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const r2 = n => Math.round(n * 100) / 100

// ── 档案数据 ──
const CATS = [
  ['C01', '电脑配件', null], ['C0101', 'CPU', 'C01'], ['C0102', '主板', 'C01'], ['C0103', '内存', 'C01'],
  ['C0104', '硬盘', 'C01'], ['C0105', '显卡', 'C01'], ['C0106', '电源', 'C01'],
  ['C02', '外设', null], ['C0201', '显示器', 'C02'], ['C0202', '键鼠', 'C02'],
]
// [编码, 名称, 规格, 单位, 小类, 进价(不含税), 售价(不含税), 仓库, 存货科目]
const ITEMS = [
  ['P0101', 'Intel 酷睿 i5-13400F', '10核16线程 盒装', '个', 'C0101', 1050, 1290, 'CK01', '1406001'],
  ['P0102', 'AMD 锐龙 R5 7500F', '6核12线程 盒装', '个', 'C0101', 880, 1090, 'CK01', '1406001'],
  ['P0201', '技嘉 B760M GAMING', 'M-ATX DDR4', '块', 'C0102', 540, 690, 'CK01', '1406001'],
  ['P0202', '华硕 TUF B650M-PLUS', 'M-ATX DDR5', '块', 'C0102', 780, 990, 'CK01', '1406001'],
  ['P0301', '金士顿 16G DDR4 3200', '单条', '条', 'C0103', 150, 195, 'CK01', '1406001'],
  ['P0302', '威刚 32G DDR5 5600', '单条', '条', 'C0103', 420, 540, 'CK01', '1406001'],
  ['P0401', '三星 980 1TB NVMe', 'M.2 SSD', '块', 'C0104', 380, 495, 'CK01', '1406001'],
  ['P0402', '西部数据 SN570 500G', 'M.2 SSD', '块', 'C0104', 190, 255, 'CK01', '1406001'],
  ['P0501', '七彩虹 RTX4060 8G', '战斧 DUO', '块', 'C0105', 1980, 2380, 'CK01', '1406001'],
  ['P0502', '蓝宝石 RX7600 8G', '极地版', '块', 'C0105', 1480, 1790, 'CK01', '1406001'],
  ['P0601', '航嘉 WD650K 650W', '金牌全模组', '个', 'C0106', 230, 295, 'CK01', '1406001'],
  ['P0701', '泰坦军团 27寸 2K 显示器', 'IPS 165Hz', '台', 'C0201', 720, 890, 'CK02', '1406002'],
  ['P0702', 'AOC 24寸 FHD 显示器', 'IPS 75Hz', '台', 'C0201', 400, 520, 'CK02', '1406002'],
  ['P0801', '罗技 MK270 键鼠套装', '无线', '套', 'C0202', 100, 138, 'CK02', '1406002'],
]
const CUSTOMERS = [
  ['KH001', '深圳市恒通网络科技有限公司', '张三', 30], ['KH002', '广州市天河区极速网吧', '李四', 15],
  ['KH003', '东莞市博远电脑城', '张三', 30], ['KH004', '惠州市星辰办公设备有限公司', '李四', 45],
  ['KH005', '佛山市顺德区云帆数码店', '张三', 0],
]
const SUPPLIERS = [
  ['GY001', '深圳市鑫联芯电子有限公司', ['C0101', 'C0102']], ['GY002', '广州市天创存储科技有限公司', ['C0103', 'C0104']],
  ['GY003', '东莞市锐显数码科技有限公司', ['C0105', 'C0201']], ['GY004', '深圳市奇点外设有限公司', ['C0106', 'C0202']],
]

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

  // ── 辅助核算：往来单位 / 部门 / 个人（名称与进销存档案完全一致，便于凭证生成自动对应）──
  const cats = must(await get('/api/base/aux-categories'), '类别').data
  const cat = code => cats.find(c => c.code === code).id
  const auxMap = {}
  const auxEnsure = async (type, code, name) => {
    const list = () => get(`/api/base/aux-items?type=${cat(type)}&all=1&limit=1000`).then(r => r.data?.list || r.data?.items || r.data || [])
    let found = (await list()).find(i => i.name === name)
    if (!found) {
      await ensure('/api/base/aux-items', { type: cat(type), code, name }, `辅助项目 ${name}`)
      found = (await list()).find(i => i.name === name)
    }
    auxMap[`${type}:${name}`] = found?.code || code
  }
  for (const c of CUSTOMERS) await auxEnsure('customer', c[0], c[1])
  for (const s of SUPPLIERS) await auxEnsure('customer', s[0], s[1])
  for (const [c, n] of [['01', '销售部'], ['02', '采购部'], ['03', '仓储部']]) await auxEnsure('dept', c, n)
  for (const [c, n] of [['P01', '张三'], ['P02', '李四']]) await auxEnsure('person', c, n)
  console.log('✓ 辅助核算：往来单位 9 / 部门 3 / 个人 2')
  const deptCode = n => auxMap[`dept:${n}`]

  // ── 科目：末级银行、库存商品明细、辅助核算 ──
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
  await addChild('1406', '1406001', '电脑配件')
  await addChild('1406', '1406002', '显示器及外设')
  accs = await accounts()
  const setAux = async (code, catCodes) => {
    const a = acc(code)
    const auxTypes = Object.fromEntries(catCodes.map(c => [cat(c), null]))
    // 修改接口整行覆盖：必须带上原字段，否则会把科目停用
    must(await put(`/api/base/accounts/${a.id}`, { ...a, is_enabled: 1, is_aux: 1, aux_types: auxTypes }), `科目 ${code} 挂辅助`)
  }
  await setAux('1122', ['customer'])
  await setAux('2202', ['customer'])
  await setAux('6001001', ['dept'])
  console.log('✓ 科目：1002001/1002002 银行、1406001/1406002 库存商品明细；1122、2202→往来单位，6001001→部门')

  // ── 进销存档案 ──
  await get('/api/scm/docs/types')
  await ensure('/api/scm/warehouses', { code: 'CK01', name: '配件仓', keeper: '王仓管' })
  await ensure('/api/scm/warehouses', { code: 'CK02', name: '外设仓', keeper: '王仓管' })
  for (const [code, name, parent] of CATS) await ensure('/api/scm/categories', { code, name, parent_code: parent })
  for (const [code, name, spec, unit, sub, buy, sell, wh, inv] of ITEMS) {
    await ensure('/api/scm/items', {
      code, name, spec, unit, category_code: sub.slice(0, 3), subcategory_code: sub, item_type: '9', source_type: 'purchase',
      purchase_price: buy, sale_price: sell, default_warehouse_code: wh, inv_account: inv,
    }, `物料 ${code}`)
  }
  for (const [code, name, sm, days] of CUSTOMERS) {
    await ensure('/api/scm/partners', { code, name, partner_type: 'customer', salesman: sm, credit_days: days, contact: '采购部', phone: '0755-8' + ri(1000000, 9999999) })
  }
  for (const [code, name] of SUPPLIERS) {
    await ensure('/api/scm/partners', { code, name, partner_type: 'supplier', credit_days: 30, contact: '销售部', phone: '0755-2' + ri(1000000, 9999999) })
  }
  console.log(`✓ 进销存档案：2 仓库 / ${CATS.length} 分类 / ${ITEMS.length} 物料 / ${CUSTOMERS.length} 客户 / ${SUPPLIERS.length} 供应商`)

  // ── 模拟单据（按日期先后建，保证移动平均成本与库存口径正常）──
  const stock = Object.fromEntries(ITEMS.map(i => [i[0], 0]))
  const item = Object.fromEntries(ITEMS.map(i => [i[0], { code: i[0], sub: i[4], buy: i[5], sell: i[6], wh: i[7] }]))
  const vary = (p, pct) => r2(p * (1 + (rnd() * 2 - 1) * pct))
  const L = (code, qty, price, rate = 13) => ({ item_code: code, qty, price, tax_rate: rate, tax_amount: r2(qty * price * rate / 100) })
  const events = []   // { date, order, title, body, after? }
  const add = (date, title, body, after) => events.push({ date, title, body, after, n: events.length })

  const supplierOf = code => SUPPLIERS.find(s => s[2].includes(item[code].sub))[0]
  const purchase = (date, codes, qtyRange, priceDelta = 0.03) => {
    const bySup = {}
    for (const c of codes) (bySup[supplierOf(c)] ||= []).push(c)
    for (const [sup, cs] of Object.entries(bySup)) {
      const byWh = {}
      for (const c of cs) (byWh[item[c].wh] ||= []).push(c)
      for (const [wh, ws] of Object.entries(byWh)) {
        const lines = ws.map(c => { const q = ri(...qtyRange); stock[c] += q; return L(c, q, vary(item[c].buy, priceDelta)) })
        add(date, `采购入库 ${sup} ${wh}`, { doc_type: 'PI', partner_code: sup, warehouse_code: wh, dept_code: deptCode('采购部'), lines })
      }
    }
  }
  const sale = (date, cust, codes, retPct = 0) => {
    const salesman = CUSTOMERS.find(c => c[0] === cust)[2]
    const byWh = {}
    for (const c of codes) (byWh[item[c].wh] ||= []).push(c)
    for (const [wh, ws] of Object.entries(byWh)) {
      const lines = []
      for (const c of ws) {
        const q = Math.min(stock[c], ri(1, 12))
        if (q <= 0) continue
        stock[c] -= q
        lines.push(L(c, q, vary(item[c].sell, 0.02)))
      }
      if (!lines.length) continue
      add(date, `销售发货 ${cust} ${wh}`, { doc_type: 'SO', partner_code: cust, warehouse_code: wh, dept_code: deptCode('销售部'), biz_person: salesman, lines })
    }
  }
  const allCodes = ITEMS.map(i => i[0])
  const dayStr = (m, d) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  // 7 月：开业备货（全品类）+ 零星销售
  purchase(dayStr(7, 2), allCodes, [20, 40])
  for (const d of [8, 11, 15, 18, 22, 25, 29]) sale(dayStr(7, d), pick(CUSTOMERS)[0], [pick(allCodes), pick(allCodes), pick(allCodes)])
  // 8、9、10 月：补货 + 销售
  for (const m of [8, 9, 10]) {
    const last = m === 10 ? 7 : 28
    purchase(dayStr(m, 3), allCodes.filter(c => stock[c] < 25 || rnd() < 0.4), [15, 35])
    for (let k = 0; k < (m === 10 ? 5 : 9); k++) sale(dayStr(m, Math.min(last, 4 + k * 3)), pick(CUSTOMERS)[0], [pick(allCodes), pick(allCodes), pick(allCodes)])
    if (m < 10) purchase(dayStr(m, 17), allCodes.filter(() => rnd() < 0.3), [10, 25])
  }
  // 退货 / 盘盈盘亏 / 领用
  add(dayStr(7, 20), '采购退货 鑫联芯 CPU 2 个（质量问题）', { doc_type: 'PR', partner_code: 'GY001', warehouse_code: 'CK01', dept_code: deptCode('采购部'), lines: [L('P0101', 2, item.P0101.buy)] })
  stock.P0101 -= 2
  add(dayStr(8, 12), '销售退货 恒通网络 显示器 2 台', { doc_type: 'SR', partner_code: 'KH001', warehouse_code: 'CK02', dept_code: deptCode('销售部'), lines: [L('P0701', 2, item.P0701.sell)] })
  stock.P0701 += 2
  add(dayStr(9, 20), '销售退货 云帆数码 内存 3 条', { doc_type: 'SR', partner_code: 'KH005', warehouse_code: 'CK01', dept_code: deptCode('销售部'), lines: [L('P0301', 3, item.P0301.sell)] })
  stock.P0301 += 3
  add(dayStr(8, 30), '其他入库 盘盈 键鼠套装 4 套', { doc_type: 'OI', warehouse_code: 'CK02', io_category: '盘盈', lines: [{ item_code: 'P0801', qty: 4, price: 100 }] })
  stock.P0801 += 4
  add(dayStr(9, 30), '其他出库 盘亏 固态硬盘 2 块', { doc_type: 'OO', warehouse_code: 'CK01', io_category: '盘亏', lines: [{ item_code: 'P0402', qty: 2, price: 190 }] })
  stock.P0402 -= 2
  add(dayStr(10, 6), '其他出库 领用 键鼠套装 2 套（办公自用）', { doc_type: 'OO', warehouse_code: 'CK02', io_category: '领用', lines: [{ item_code: 'P0801', qty: 2, price: 100 }] })
  stock.P0801 -= 2
  add(dayStr(9, 15), '调拨 配件仓→外设仓 键鼠套装（不生成凭证）', { doc_type: 'TR', warehouse_code: 'CK02', lines: [{ item_code: 'P0801', qty: 1, warehouse_code: 'CK01' }] })
  // 收付款：每月 1~2 笔
  for (const [m, d, cust, amt] of [[7, 28, 'KH001', 20000], [8, 10, 'KH003', 15000], [8, 26, 'KH002', 8000], [9, 8, 'KH004', 12000], [9, 24, 'KH001', 18000], [10, 5, 'KH005', 6000]]) {
    add(dayStr(m, d), `收款单 ${cust} 收 ${amt}`, { doc_type: 'RCV', partner_code: cust, settle_account: '1002001', payment_type: 'transfer', lines: [{ item_code: '', qty: 1, price: amt, amount: amt, remark: '收货款' }] })
  }
  for (const [m, d, sup, amt] of [[7, 30, 'GY001', 30000], [8, 15, 'GY002', 20000], [8, 28, 'GY003', 25000], [9, 12, 'GY004', 8000], [9, 26, 'GY001', 28000], [10, 6, 'GY003', 20000]]) {
    add(dayStr(m, d), `付款单 ${sup} 付 ${amt}`, { doc_type: 'PAY', partner_code: sup, settle_account: '1002002', payment_type: 'transfer', lines: [{ item_code: '', qty: 1, price: amt, amount: amt, remark: '付货款' }] })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n)
  // 校验：按时间顺序回放库存，销售 / 出库不得超出当时库存（避免审核被拦）
  const sim = Object.fromEntries(ITEMS.map(i => [i[0], 0]))
  const wh0 = {}
  for (const e of events) {
    const t = e.body.doc_type
    for (const l of e.body.lines) {
      if (!l.item_code || t === 'TR') continue
      if (['PI', 'SR', 'OI'].includes(t)) sim[l.item_code] += l.qty
      if (['SO', 'PR', 'OO'].includes(t)) {
        sim[l.item_code] -= l.qty
        if (sim[l.item_code] < 0) { console.warn(`库存不足调整：${e.date} ${e.title} ${l.item_code}`); l.qty += sim[l.item_code]; sim[l.item_code] = 0; l.tax_amount = r2(l.qty * l.price * 0.13) }
      }
    }
    e.body.lines = e.body.lines.filter(l => l.qty > 0 || !l.item_code)
  }

  let ok = 0
  const bad = []
  for (const e of events) {
    if (!e.body.lines.length) continue
    const r = await post('/api/scm/docs', { doc_date: e.date, ...e.body })
    if (r.code !== 0) { bad.push(`建单失败 ${e.date} ${e.title}：${r.message}`); continue }
    const a = await post(`/api/scm/docs/${r.data.id}/audit`, { apply_item_default_warehouses: true })
    if (a.code !== 0) { bad.push(`审核失败 ${r.data.doc_no} ${e.title}：${a.message}`); continue }
    ok++
    console.log(`✓ ${e.date} ${r.data.doc_no}  ${e.title}`)
  }
  console.log(`\n共建并审核 ${ok} 张单据（均未生成凭证）`)
  if (bad.length) { console.log('异常：'); bad.forEach(x => console.log('  ✗', x)) }
}

main().catch(e => { console.error('✗', e.message); process.exitCode = 1 })

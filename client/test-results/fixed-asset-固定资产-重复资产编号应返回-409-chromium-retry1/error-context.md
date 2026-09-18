# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: fixed-asset.spec.ts >> 固定资产 >> 重复资产编号应返回 409
- Location: e2e\fixed-asset.spec.ts:98:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 409
Received: 400
```

# Test source

```ts
  10  | 
  11  | /** 获取 API token（账套 id 运行时解析，见 fixtures.resolveAccountSetId） */
  12  | async function getHeaders(request: any) {
  13  |   return apiHeaders(request)
  14  | }
  15  | 
  16  | test.describe('固定资产', () => {
  17  |   // ── 页面渲染 ───────────────────────────────────────────
  18  | 
  19  |   test('资产卡片列表页面能正常渲染', async ({ loggedInPage: page }) => {
  20  |     await navTo(page, '固定资产', '资产卡片')
  21  |     // 页面标题由布局层的面包屑承载（导航改版后各页面不再自带 h3）
  22  |     await expect(page.locator('.apple-breadcrumb')).toContainText('资产卡片')
  23  |     await waitForTable(page)
  24  |     await expect(page.locator('.el-table')).toBeVisible()
  25  |     await expect(page.locator('button', { hasText: '新增固定资产' })).toBeVisible()
  26  |   })
  27  | 
  28  |   test('资产档案页面渲染并显示各类字典 Tab', async ({ loggedInPage: page }) => {
  29  |     await navTo(page, '固定资产', '资产档案')
  30  |     await expect(page.locator('.apple-breadcrumb')).toContainText('资产档案')
  31  |     // 该页是左侧分类导航（.dict-nav__item），不是 el-tabs
  32  |     for (const label of ['资产类别', '资产状态', '资产用途', '使用部门', '增减方式']) {
  33  |       await expect(page.locator('.dict-nav__item', { hasText: label })).toBeVisible()
  34  |     }
  35  |   })
  36  | 
  37  |   test('折旧计提页面能正常渲染', async ({ loggedInPage: page }) => {
  38  |     await navTo(page, '固定资产', '折旧计提')
  39  |     await expect(page.locator('.apple-breadcrumb')).toContainText('折旧计提')
  40  |     await expect(page.locator('.el-tabs__item', { hasText: '折旧预览' })).toBeVisible()
  41  |     await expect(page.locator('.el-tabs__item', { hasText: '历史记录' })).toBeVisible()
  42  |   })
  43  | 
  44  |   // ── 卡片 CRUD API ──────────────────────────────────────
  45  | 
  46  |   test('能创建、查询、修改、删除资产卡片', async ({ request }) => {
  47  |     const H = await getHeaders(request)
  48  |     const assetNo = 'E2E_' + Date.now().toString().slice(-6)
  49  | 
  50  |     // 创建
  51  |     const createRes = await request.post(`${API}/api/asset/cards`, {
  52  |       headers: H,
  53  |       data: {
  54  |         asset_no: assetNo,
  55  |         asset_name: 'E2E测试资产',
  56  |         original_value: 5000,
  57  |         salvage_rate: 5,
  58  |         salvage_value: 250,
  59  |         depr_method: '1',
  60  |         use_months: 24,
  61  |         start_depr_date: '2026-01-01',
  62  |         qty: 1,
  63  |       },
  64  |     })
  65  |     expect(createRes.ok()).toBeTruthy()
  66  |     const { data: { id } } = await createRes.json()
  67  |     expect(id).toBeTruthy()
  68  | 
  69  |     // 查询
  70  |     const getRes = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
  71  |     const getBody = await getRes.json()
  72  |     expect(getBody.code).toBe(0)
  73  |     expect(getBody.data.asset_name).toBe('E2E测试资产')
  74  |     expect(getBody.data.original_value).toBe(5000)
  75  |     // 净值 = 原值 − 累计折旧 − 累计减值，残值不参与（见 routes/fixedAsset.ts 建卡处注释）
  76  |     expect(getBody.data.net_value).toBe(5000)
  77  | 
  78  |     // 修改
  79  |     const updateRes = await request.put(`${API}/api/asset/cards/${id}`, {
  80  |       headers: H,
  81  |       data: { asset_name: 'E2E测试资产(已更新)', user_name: '测试人员' },
  82  |     })
  83  |     expect((await updateRes.json()).code).toBe(0)
  84  | 
  85  |     // 验证修改
  86  |     const afterUpdate = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
  87  |     expect((await afterUpdate.json()).data.asset_name).toBe('E2E测试资产(已更新)')
  88  | 
  89  |     // 删除
  90  |     const delRes = await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  91  |     expect((await delRes.json()).code).toBe(0)
  92  | 
  93  |     // 验证已删除
  94  |     const afterDel = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
  95  |     expect(afterDel.status()).toBe(404)
  96  |   })
  97  | 
  98  |   test('重复资产编号应返回 409', async ({ request }) => {
  99  |     const H = await getHeaders(request)
  100 |     const assetNo = 'E2E_DUP_' + Date.now().toString().slice(-4)
  101 | 
  102 |     await request.post(`${API}/api/asset/cards`, {
  103 |       headers: H,
  104 |       data: { asset_no: assetNo, asset_name: '第一个', original_value: 1000 },
  105 |     })
  106 |     const dupRes = await request.post(`${API}/api/asset/cards`, {
  107 |       headers: H,
  108 |       data: { asset_no: assetNo, asset_name: '重复编号', original_value: 2000 },
  109 |     })
> 110 |     expect(dupRes.status()).toBe(409)
      |                             ^ Error: expect(received).toBe(expected) // Object.is equality
  111 | 
  112 |     // 清理
  113 |     const listRes = await request.get(`${API}/api/asset/cards?keyword=${assetNo}`, { headers: H })
  114 |     const { data: { list } } = await listRes.json()
  115 |     for (const c of list) {
  116 |       await request.delete(`${API}/api/asset/cards/${c.id}`, { headers: H })
  117 |     }
  118 |   })
  119 | 
  120 |   // ── 字典 CRUD API ──────────────────────────────────────
  121 | 
  122 |   test('能创建并查询字典项（资产类别）', async ({ request }) => {
  123 |     const H = await getHeaders(request)
  124 |     const code = 'E2E_' + Date.now().toString().slice(-4)
  125 | 
  126 |     const createRes = await request.post(`${API}/api/asset/dict/category`, {
  127 |       headers: H,
  128 |       data: { code, name: 'E2E测试类别', salvage_rate: 8, account_code: '1601' },
  129 |     })
  130 |     expect(createRes.ok()).toBeTruthy()
  131 |     const { data: { id } } = await createRes.json()
  132 | 
  133 |     const listRes = await request.get(`${API}/api/asset/dict/category`, { headers: H })
  134 |     const list = (await listRes.json()).data
  135 |     const found = list.find((r: any) => r.id === id)
  136 |     expect(found).toBeDefined()
  137 |     expect(found.salvage_rate).toBe(8)
  138 | 
  139 |     // 清理
  140 |     await request.delete(`${API}/api/asset/dict/category/${id}`, { headers: H })
  141 |   })
  142 | 
  143 |   test('一次获取全部字典返回四类', async ({ request }) => {
  144 |     const H = await getHeaders(request)
  145 |     const res = await request.get(`${API}/api/asset/dicts`, { headers: H })
  146 |     const data = (await res.json()).data
  147 |     expect(data).toHaveProperty('category')
  148 |     expect(data).toHaveProperty('status')
  149 |     expect(data).toHaveProperty('purpose')
  150 |     expect(data).toHaveProperty('dept')
  151 |     expect(Array.isArray(data.category)).toBe(true)
  152 |   })
  153 | 
  154 |   // ── 折旧计算 API ───────────────────────────────────────
  155 | 
  156 |   test('折旧预览返回正确格式', async ({ request }) => {
  157 |     const H = await getHeaders(request)
  158 |     const res = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
  159 |     const data = await res.json()
  160 |     expect(data.code).toBe(0)
  161 |     expect(Array.isArray(data.data.lines)).toBe(true)
  162 |     expect(typeof data.data.totalDepr).toBe('number')
  163 |   })
  164 | 
  165 |   test('平均年限法折旧计算公式正确', async ({ request }) => {
  166 |     const H = await getHeaders(request)
  167 |     const assetNo = 'E2E_DEPR_' + Date.now().toString().slice(-4)
  168 | 
  169 |     // 创建资产：原值=12000, 残值率=0%, 月数=12 → 月折旧=1000
  170 |     const cr = await request.post(`${API}/api/asset/cards`, {
  171 |       headers: H,
  172 |       data: {
  173 |         asset_no: assetNo,
  174 |         asset_name: 'E2E折旧测试资产',
  175 |         original_value: 12000,
  176 |         salvage_rate: 0,
  177 |         salvage_value: 0,
  178 |         depr_method: '1',
  179 |         use_months: 12,
  180 |         start_depr_date: '2026-06-01',  // 次月=7月开始计提
  181 |       },
  182 |     })
  183 |     const { data: { id } } = await cr.json()
  184 | 
  185 |     // 预览 2026-07 折旧
  186 |     const prevRes = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
  187 |     const prevData = await prevRes.json()
  188 |     const line = prevData.data.lines.find((l: any) => l.asset_no === assetNo)
  189 |     expect(line).toBeDefined()
  190 |     expect(line.month_depr).toBeCloseTo(1000, 2)  // 12000 / 12 = 1000
  191 |     expect(line.depr_method).toBe('1')
  192 | 
  193 |     // 清理（先删折旧记录再删卡片）
  194 |     await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  195 |   })
  196 | 
  197 |   test('折旧历史记录查询正常', async ({ request }) => {
  198 |     const H = await getHeaders(request)
  199 |     const res = await request.get(`${API}/api/asset/depr/history?year=2026`, { headers: H })
  200 |     const data = await res.json()
  201 |     expect(data.code).toBe(0)
  202 |     expect(Array.isArray(data.data)).toBe(true)
  203 |   })
  204 | 
  205 |   // ── ACD 导出 API ───────────────────────────────────────
  206 | 
  207 |   test('ACD 导出预览返回各表行数', async ({ request }) => {
  208 |     const H = await getHeaders(request)
  209 |     const res = await request.get(`${API}/api/acd-export/cashier-asset/preview`, { headers: H })
  210 |     const data = await res.json()
```
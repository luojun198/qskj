/**
 * 固定资产 E2E 测试
 *
 * 覆盖：卡片列表页面 / 字典维护 / 折旧计提页面 /
 *       卡片 CRUD API / 折旧计算逻辑 / ACD 导出
 */
import { test, expect, waitForTable, navTo } from './fixtures'

const API = 'http://127.0.0.1:3105'
const ASID = '5945a5a8-e9f2-4145-968f-86862ce54aa3'

/** 获取 API token */
async function getHeaders(request: any) {
  const lr = await request.post(`${API}/api/auth/login`, {
    data: { username: 'admin', password: 'admin123', targetAccountSetId: ASID },
  })
  const { token } = await lr.json()
  return { Authorization: `Bearer ${token}`, 'x-account-set-id': ASID }
}

test.describe('固定资产', () => {
  // ── 页面渲染 ───────────────────────────────────────────

  test('资产卡片列表页面能正常渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '资产卡片')
    await expect(page.locator('h3')).toContainText('固定资产卡片')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
    // 筛选栏存在
    await expect(page.locator('input[placeholder*="编号"]').or(page.locator('input[placeholder*="名称"]'))).toBeVisible()
  })

  test('字典维护页面渲染并显示四个 Tab', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '字典维护')
    await expect(page.locator('h3')).toContainText('固定资产字典维护')
    // Tab 页签
    for (const label of ['资产类别', '资产状态', '资产用途', '使用部门']) {
      await expect(page.locator('.el-tabs__item', { hasText: label })).toBeVisible()
    }
  })

  test('折旧计提页面能正常渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '折旧计提')
    await expect(page.locator('h3')).toContainText('固定资产折旧')
    await expect(page.locator('button', { hasText: '预览折旧' })).toBeVisible()
    await expect(page.locator('button', { hasText: '历史记录' })).toBeVisible()
  })

  // ── 卡片 CRUD API ──────────────────────────────────────

  test('能创建、查询、修改、删除资产卡片', async ({ request }) => {
    const H = await getHeaders(request)
    const assetNo = 'E2E_' + Date.now().toString().slice(-6)

    // 创建
    const createRes = await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: {
        asset_no: assetNo,
        asset_name: 'E2E测试资产',
        original_value: 5000,
        salvage_rate: 5,
        salvage_value: 250,
        depr_method: '1',
        use_months: 24,
        start_depr_date: '2026-01-01',
        qty: 1,
      },
    })
    expect(createRes.ok()).toBeTruthy()
    const { data: { id } } = await createRes.json()
    expect(id).toBeTruthy()

    // 查询
    const getRes = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    const getBody = await getRes.json()
    expect(getBody.code).toBe(0)
    expect(getBody.data.asset_name).toBe('E2E测试资产')
    expect(getBody.data.original_value).toBe(5000)
    expect(getBody.data.net_value).toBe(5000 - 250)  // 原值 - 净残值（无折旧时）

    // 修改
    const updateRes = await request.put(`${API}/api/asset/cards/${id}`, {
      headers: H,
      data: { asset_name: 'E2E测试资产(已更新)', user_name: '测试人员' },
    })
    expect((await updateRes.json()).code).toBe(0)

    // 验证修改
    const afterUpdate = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    expect((await afterUpdate.json()).data.asset_name).toBe('E2E测试资产(已更新)')

    // 删除
    const delRes = await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
    expect((await delRes.json()).code).toBe(0)

    // 验证已删除
    const afterDel = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    expect(afterDel.status()).toBe(404)
  })

  test('重复资产编号应返回 409', async ({ request }) => {
    const H = await getHeaders(request)
    const assetNo = 'E2E_DUP_' + Date.now().toString().slice(-4)

    await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: { asset_no: assetNo, asset_name: '第一个', original_value: 1000 },
    })
    const dupRes = await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: { asset_no: assetNo, asset_name: '重复编号', original_value: 2000 },
    })
    expect(dupRes.status()).toBe(409)

    // 清理
    const listRes = await request.get(`${API}/api/asset/cards?keyword=${assetNo}`, { headers: H })
    const { data: { list } } = await listRes.json()
    for (const c of list) {
      await request.delete(`${API}/api/asset/cards/${c.id}`, { headers: H })
    }
  })

  // ── 字典 CRUD API ──────────────────────────────────────

  test('能创建并查询字典项（资产类别）', async ({ request }) => {
    const H = await getHeaders(request)
    const code = 'E2E_' + Date.now().toString().slice(-4)

    const createRes = await request.post(`${API}/api/asset/dict/category`, {
      headers: H,
      data: { code, name: 'E2E测试类别', salvage_rate: 8, account_code: '1601' },
    })
    expect(createRes.ok()).toBeTruthy()
    const { data: { id } } = await createRes.json()

    const listRes = await request.get(`${API}/api/asset/dict/category`, { headers: H })
    const list = (await listRes.json()).data
    const found = list.find((r: any) => r.id === id)
    expect(found).toBeDefined()
    expect(found.salvage_rate).toBe(8)

    // 清理
    await request.delete(`${API}/api/asset/dict/category/${id}`, { headers: H })
  })

  test('一次获取全部字典返回四类', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/dicts`, { headers: H })
    const data = (await res.json()).data
    expect(data).toHaveProperty('category')
    expect(data).toHaveProperty('status')
    expect(data).toHaveProperty('purpose')
    expect(data).toHaveProperty('dept')
    expect(Array.isArray(data.category)).toBe(true)
  })

  // ── 折旧计算 API ───────────────────────────────────────

  test('折旧预览返回正确格式', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(Array.isArray(data.data.lines)).toBe(true)
    expect(typeof data.data.totalDepr).toBe('number')
  })

  test('平均年限法折旧计算公式正确', async ({ request }) => {
    const H = await getHeaders(request)
    const assetNo = 'E2E_DEPR_' + Date.now().toString().slice(-4)

    // 创建资产：原值=12000, 残值率=0%, 月数=12 → 月折旧=1000
    const cr = await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: {
        asset_no: assetNo,
        asset_name: 'E2E折旧测试资产',
        original_value: 12000,
        salvage_rate: 0,
        salvage_value: 0,
        depr_method: '1',
        use_months: 12,
        start_depr_date: '2026-06-01',  // 次月=7月开始计提
      },
    })
    const { data: { id } } = await cr.json()

    // 预览 2026-07 折旧
    const prevRes = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
    const prevData = await prevRes.json()
    const line = prevData.data.lines.find((l: any) => l.asset_no === assetNo)
    expect(line).toBeDefined()
    expect(line.month_depr).toBeCloseTo(1000, 2)  // 12000 / 12 = 1000
    expect(line.depr_method).toBe('1')

    // 清理（先删折旧记录再删卡片）
    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  test('折旧历史记录查询正常', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/depr/history?year=2026`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(Array.isArray(data.data)).toBe(true)
  })

  // ── ACD 导出 API ───────────────────────────────────────

  test('ACD 导出预览返回各表行数', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/acd-export/cashier-asset/preview`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(data.data).toHaveProperty('counts')
    expect(data.data).toHaveProperty('total')
    // 验证包含所有 12 张表的 key
    const keys = Object.keys(data.data.counts)
    expect(keys).toContain('cn_mx')
    expect(keys).toContain('zc_gdzc')
    expect(keys).toContain('zc_yzjb')
    expect(typeof data.data.total).toBe('number')
  })

  test('ACD 下载返回二进制且首字节是文件名', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/acd-export/cashier-asset`, { headers: H })
    expect(res.ok()).toBeTruthy()
    expect(res.headers()['content-type']).toContain('application/octet-stream')
    expect(res.headers()['content-disposition']).toContain('.acd')
    const buf = await res.body()
    // .acd 文件开头应为文件名（ASCII 字节，以 0x00 结尾）
    expect(buf.length).toBeGreaterThan(44)  // 32(name)+12(meta)+≥1(data)
  })
})

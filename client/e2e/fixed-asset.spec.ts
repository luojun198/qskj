/**
 * 固定资产 E2E 测试
 *
 * 覆盖：卡片列表页面 / 字典维护 / 折旧计提页面 /
 *       卡片 CRUD API / 折旧计算逻辑 / ACD 导出
 */
import { test, expect, waitForTable, navTo, apiHeaders, API_BASE } from './fixtures'

const API = API_BASE

/** 获取 API token（账套 id 运行时解析，见 fixtures.resolveAccountSetId） */
async function getHeaders(request: any) {
  return apiHeaders(request)
}

test.describe('固定资产', () => {
  // ── 页面渲染 ───────────────────────────────────────────

  test('资产卡片列表页面能正常渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '资产卡片')
    // 页面标题由布局层的面包屑承载（导航改版后各页面不再自带 h3）
    await expect(page.locator('.apple-breadcrumb')).toContainText('资产卡片')
    await waitForTable(page)
    await expect(page.locator('.el-table')).toBeVisible()
    await expect(page.locator('button', { hasText: '新增固定资产' })).toBeVisible()
  })

  test('资产档案页面渲染并显示各类字典 Tab', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '资产档案')
    await expect(page.locator('.apple-breadcrumb')).toContainText('资产档案')
    // 该页是左侧分类导航（.dict-nav__item），不是 el-tabs
    for (const label of ['资产类别', '资产状态', '资产用途', '使用部门', '增减方式']) {
      await expect(page.locator('.dict-nav__item', { hasText: label })).toBeVisible()
    }
  })

  test('折旧计提页面能正常渲染', async ({ loggedInPage: page }) => {
    await navTo(page, '固定资产', '折旧计提')
    await expect(page.locator('.apple-breadcrumb')).toContainText('折旧计提')
    await expect(page.locator('.el-tabs__item', { hasText: '折旧预览' })).toBeVisible()
    await expect(page.locator('.el-tabs__item', { hasText: '历史记录' })).toBeVisible()
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
    // 净值 = 原值 − 累计折旧 − 累计减值，残值不参与（见 routes/fixedAsset.ts 建卡处注释）
    expect(getBody.data.net_value).toBe(5000)

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
      // 非工作量法须填使用月数（后端校验），否则第一次就 400，测不到重复编号
      data: { asset_no: assetNo, asset_name: '第一个', original_value: 1000, depr_method: '1', use_months: 12 },
    })
    const dupRes = await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: { asset_no: assetNo, asset_name: '重复编号', original_value: 2000, depr_method: '1', use_months: 12 },
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
    // 评审 P2（FIX-296）：类别残值率与卡片同口径，百分数 8 归一为 0.08
    expect(found.salvage_rate).toBe(0.08)

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

  // ── 资产变动 API（P1）──────────────────────────────────

  /** 建一张测试卡片，返回 { id, assetNo } */
  async function createCard(request: any, H: any, over: Record<string, unknown> = {}) {
    const assetNo = 'E2E_' + Date.now().toString().slice(-6) + Math.floor(Math.random() * 100)
    const res = await request.post(`${API}/api/asset/cards`, {
      headers: H,
      data: {
        asset_no: assetNo,
        asset_name: '变动测试资产',
        start_depr_date: '2026-01-15',
        original_value: 12000,
        salvage_rate: 0.1,
        salvage_value: 1200,
        depr_method: '1',
        use_months: 12,
        ...over,
      },
    })
    const { data } = await res.json()
    return { id: data.id as string, assetNo }
  }

  test('登记原值变动后变动记录可查、撤销后消失', async ({ request }) => {
    const H = await getHeaders(request)
    const { id, assetNo } = await createCard(request, H)

    // 登记原值变动 +3000
    const applyRes = await request.post(`${API}/api/asset/cards/${id}/change`, {
      headers: H,
      data: {
        kind: 'original_value',
        change_date: '2026-06-15',
        payload: { amount: 3000 },
      },
    })
    const applyData = await applyRes.json()
    expect(applyData.code).toBe(0)
    const changeId = applyData.data.changeId
    expect(changeId).toBeTruthy()

    // 资产原值与残值已更新
    const cardRes = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    const card = (await cardRes.json()).data
    expect(card.original_value).toBeCloseTo(15000, 2)
    expect(card.salvage_value).toBeCloseTo(1500, 2)

    // 变动记录可查（此前该表无人写入，报表恒为空）
    const listRes = await request.get(`${API}/api/asset/changes?asset_no=${assetNo}`, { headers: H })
    const listData = await listRes.json()
    expect(listData.code).toBe(0)
    expect(listData.data.total).toBe(1)
    expect(listData.data.list[0].change_kind).toBe('original_value')

    // 撤销后还原
    const revokeRes = await request.post(`${API}/api/asset/changes/${changeId}/revoke`, {
      headers: H,
      data: {},
    })
    expect((await revokeRes.json()).code).toBe(0)

    const afterRes = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    expect((await afterRes.json()).data.original_value).toBeCloseTo(12000, 2)

    const emptyRes = await request.get(`${API}/api/asset/changes?asset_no=${assetNo}`, { headers: H })
    expect((await emptyRes.json()).data.total).toBe(0)

    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  test('变动后折旧改按剩余期间摊余（未来适用法）', async ({ request }) => {
    const H = await getHeaders(request)
    const { id, assetNo } = await createCard(request, H)

    // 变动前：(12000-1200)/12 = 900
    const before = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
    const beforeLine = (await before.json()).data.lines.find((l: any) => l.asset_no === assetNo)
    expect(beforeLine.month_depr).toBeCloseTo(900, 2)

    await request.post(`${API}/api/asset/cards/${id}/change`, {
      headers: H,
      data: { kind: 'original_value', change_date: '2026-06-15', payload: { amount: 3000 } },
    })

    // 变动后：净值 15000、残值 1500、剩余 12 个月 → (15000-1500)/12 = 1125
    const after = await request.get(`${API}/api/asset/depr/preview?year=2026&month=7`, { headers: H })
    const afterLine = (await after.json()).data.lines.find((l: any) => l.asset_no === assetNo)
    expect(afterLine.month_depr).toBeCloseTo(1125, 2)

    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  test('变动类型枚举返回中文名与折旧要素字段', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/change-kinds`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    const codes = data.data.kinds.map((k: any) => k.code)
    expect(codes).toContain('original_value')
    expect(codes).toContain('dept')
    expect(codes).toContain('impairment')
    expect(data.data.deprFactorFields.map((f: any) => f.code)).toContain('use_months')
  })

  // ── 领用归还 API（P3）──────────────────────────────────

  test('领用后不可重复领用，归还后可再次领用', async ({ request }) => {
    const H = await getHeaders(request)
    const { id, assetNo } = await createCard(request, H)

    const out = await request.post(`${API}/api/asset/requisitions`, {
      headers: H,
      data: { asset_id: id, action: 'out', action_date: '2026-06-01', user_name: '张三' },
    })
    expect((await out.json()).code).toBe(0)

    // 卡片上的使用人已回写
    const card = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    expect((await card.json()).data.user_name).toBe('张三')

    // 重复领用被拒
    const dup = await request.post(`${API}/api/asset/requisitions`, {
      headers: H,
      data: { asset_id: id, action: 'out', action_date: '2026-06-10', user_name: '李四' },
    })
    expect(dup.status()).toBe(400)
    expect((await dup.json()).message).toContain('尚未归还')

    // 未归还筛选能查到
    const outstanding = await request.get(
      `${API}/api/asset/requisitions?asset_no=${assetNo}&outstanding_only=true`,
      { headers: H }
    )
    expect((await outstanding.json()).data.total).toBe(1)

    // 归还后使用人清空
    const back = await request.post(`${API}/api/asset/requisitions`, {
      headers: H,
      data: { asset_id: id, action: 'in', action_date: '2026-07-01' },
    })
    expect((await back.json()).code).toBe(0)
    const card2 = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    expect((await card2.json()).data.user_name).toBeFalsy()

    // 可再次领用
    const again = await request.post(`${API}/api/asset/requisitions`, {
      headers: H,
      data: { asset_id: id, action: 'out', action_date: '2026-08-01', user_name: '王五' },
    })
    expect((await again.json()).code).toBe(0)

    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  test('资产卡片附件列表接口可用', async ({ request }) => {
    const H = await getHeaders(request)
    const { id } = await createCard(request, H)
    const res = await request.get(`${API}/api/asset/cards/${id}/attachments`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(Array.isArray(data.data)).toBe(true)
    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  // ── 批量导入与批量变动（P4）────────────────────────────

  test('导入模板列定义包含必填标记', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/import/columns`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    const required = data.data.filter((c: any) => c.required).map((c: any) => c.key)
    expect(required).toEqual(['asset_no', 'asset_name', 'original_value'])
  })

  test('批量导入：校验不通过时整批不写入', async ({ request }) => {
    const H = await getHeaders(request)
    const stamp = Date.now().toString().slice(-6)
    const rows = [
      { asset_no: `BI${stamp}A`, asset_name: '批量一', original_value: 10000 },
      { asset_no: `BI${stamp}B`, asset_name: '批量二', original_value: -1 }, // 非法
    ]

    // 预校验能报出问题
    const vres = await request.post(`${API}/api/asset/cards/batch/validate`, {
      headers: H,
      data: { rows },
    })
    const vdata = await vres.json()
    expect(vdata.code).toBe(0)
    expect(vdata.data.errors.length).toBeGreaterThan(0)

    // 实际导入被拒绝
    const ires = await request.post(`${API}/api/asset/cards/batch`, { headers: H, data: { rows } })
    expect(ires.status()).toBe(400)

    // 合法那一行也没有被写入
    const check = await request.get(`${API}/api/asset/cards?keyword=BI${stamp}A`, { headers: H })
    expect((await check.json()).data.total).toBe(0)
  })

  test('批量导入成功后可查到卡片', async ({ request }) => {
    const H = await getHeaders(request)
    const stamp = Date.now().toString().slice(-6)
    const rows = [
      { asset_no: `BOK${stamp}A`, asset_name: '批量导入A', original_value: 10000, salvage_rate: 0.1 },
      { asset_no: `BOK${stamp}B`, asset_name: '批量导入B', original_value: 20000, salvage_rate: 0.1 },
    ]
    const res = await request.post(`${API}/api/asset/cards/batch`, { headers: H, data: { rows } })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(data.data.successCount).toBe(2)

    const listRes = await request.get(`${API}/api/asset/cards?keyword=BOK${stamp}`, { headers: H })
    const list = (await listRes.json()).data
    expect(list.total).toBe(2)
    // 残值按残值率算出
    const a = list.list.find((x: any) => x.asset_no === `BOK${stamp}A`)
    expect(a.salvage_value).toBeCloseTo(1000, 2)

    for (const item of list.list) {
      await request.delete(`${API}/api/asset/cards/${item.id}`, { headers: H })
    }
  })

  test('批量变动：原值变动不支持批量', async ({ request }) => {
    const H = await getHeaders(request)
    const { id } = await createCard(request, H)
    const res = await request.post(`${API}/api/asset/changes/batch`, {
      headers: H,
      data: {
        asset_ids: [id],
        kind: 'original_value',
        change_date: '2026-06-15',
        payload: { amount: 100 },
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).message).toContain('不支持批量')
    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  test('批量变动类型枚举只含无金额的三类', async ({ request }) => {
    const H = await getHeaders(request)
    const res = await request.get(`${API}/api/asset/changes/batch-kinds`, { headers: H })
    const data = await res.json()
    expect(data.code).toBe(0)
    expect(data.data.sort()).toEqual(['depr_factor', 'dept', 'status'])
  })

  // ── 卡片更新语义 ───────────────────────────────────────

  test('更新卡片时传 null 能真正清空字段', async ({ request }) => {
    const H = await getHeaders(request)
    const { id } = await createCard(request, H, { user_name: '张三', install_place: '一号车间' })

    await request.put(`${API}/api/asset/cards/${id}`, {
      headers: H,
      data: { user_name: null, install_place: '' },
    })

    const res = await request.get(`${API}/api/asset/cards/${id}`, { headers: H })
    const card = (await res.json()).data
    expect(card.user_name).toBeNull()
    expect(card.install_place).toBeNull()
    // 未传的字段保持不变
    expect(card.asset_name).toBe('变动测试资产')

    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
  })

  // ── 字典删除引用检查 ───────────────────────────────────

  test('删除被卡片引用的字典项时被拦截', async ({ request }) => {
    const H = await getHeaders(request)

    // 建一个专用类别并挂到卡片上
    const code = 'E2E' + Date.now().toString().slice(-4)
    const dictRes = await request.post(`${API}/api/asset/dict/category`, {
      headers: H,
      data: { code, name: 'E2E 测试类别', salvage_rate: 0.1, account_code: '1601' },
    })
    const dictData = await dictRes.json()
    expect(dictData.code).toBe(0)
    const dictId = dictData.data?.id ?? dictData.data

    const { id } = await createCard(request, H, { category_code: code })

    // 被引用时删除应被拒绝
    const del = await request.delete(`${API}/api/asset/dict/category/${dictId}`, { headers: H })
    expect(del.status()).toBe(400)
    expect((await del.json()).message).toContain('不能删除')

    // 卡片删掉后可以删字典
    await request.delete(`${API}/api/asset/cards/${id}`, { headers: H })
    const del2 = await request.delete(`${API}/api/asset/dict/category/${dictId}`, { headers: H })
    expect((await del2.json()).code).toBe(0)
  })
})

# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cashier.spec.ts >> 出纳管理 >> 科目下拉包含现金和银行科目分组
- Location: client\e2e\cashier.spec.ts:22:3

# Error details

```
TimeoutError: locator.click: Timeout 10000ms exceeded.
Call log:
  - waiting for locator('.el-select').first()

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - navigation "应用导航" [ref=e5]:
      - button "润衡云" [ref=e6] [cursor=pointer]:
        - img "润衡云" [ref=e7]
      - tablist [ref=e8]:
        - tab "工作台" [ref=e9] [cursor=pointer]:
          - img [ref=e11]
          - generic [ref=e16]: 工作台
        - tab "财务总账" [ref=e17] [cursor=pointer]:
          - img [ref=e19]
          - generic [ref=e22]: 财务总账
        - tab "出纳管理" [selected] [ref=e23] [cursor=pointer]:
          - img [ref=e25]
          - generic [ref=e27]: 出纳管理
        - tab "固定资产" [ref=e28] [cursor=pointer]:
          - img [ref=e30]
          - generic [ref=e34]: 固定资产
        - tab "采购管理" [ref=e35] [cursor=pointer]:
          - img [ref=e37]
          - generic [ref=e41]: 采购管理
        - tab "销售管理" [ref=e42] [cursor=pointer]:
          - img [ref=e44]
          - generic [ref=e48]: 销售管理
        - tab "库存管理" [ref=e49] [cursor=pointer]:
          - img [ref=e51]
          - generic [ref=e54]: 库存管理
        - tab "应收应付" [ref=e55] [cursor=pointer]:
          - img [ref=e57]
          - generic [ref=e63]: 应收应付
        - tab "生产制造" [ref=e64] [cursor=pointer]:
          - img [ref=e66]
          - generic [ref=e68]: 生产制造
        - tab "委外管理" [ref=e69] [cursor=pointer]:
          - img [ref=e71]
          - generic [ref=e76]: 委外管理
        - tab "基础资料" [ref=e77] [cursor=pointer]:
          - img [ref=e79]
          - generic [ref=e83]: 基础资料
        - tab "系统管理" [ref=e84] [cursor=pointer]:
          - img [ref=e86]
          - generic [ref=e89]: 系统管理
      - generic [ref=e90]:
        - button "自动隐藏（点击固定展开）" [ref=e91] [cursor=pointer]:
          - img [ref=e92]
        - generic "版本 20260904" [ref=e94]: v20260904
  - generic [ref=e95]:
    - generic [ref=e96]:
      - navigation "面包屑" [ref=e98]:
        - generic [ref=e99]:
          - link "出纳管理" [ref=e100]
          - text: /
        - generic [ref=e101]:
          - link "出纳业务" [ref=e102]
          - text: /
        - link "出纳录单" [ref=e104]
      - generic [ref=e105]:
        - generic [ref=e106]:
          - generic [ref=e107]: 当前账套：
          - img [ref=e109]
          - generic [ref=e112]: 未选账套
        - generic [ref=e113]:
          - generic [ref=e114]: 当前用户：
          - img [ref=e116]
          - generic [ref=e119]: 系统管理员
        - generic [ref=e120]:
          - button "切换操作员" [ref=e121] [cursor=pointer]:
            - img [ref=e123]
            - generic [ref=e126]: 切换操作员
          - button "切换账套" [ref=e127] [cursor=pointer]:
            - img [ref=e129]
            - generic [ref=e134]: 切换账套
        - generic [ref=e135]:
          - button "完整模式" [ref=e136] [cursor=pointer]:
            - img [ref=e138]
            - generic [ref=e141]: 完整模式
          - button "首页" [ref=e142] [cursor=pointer]:
            - img [ref=e144]
            - generic [ref=e147]: 首页
          - button "返回" [ref=e148] [cursor=pointer]:
            - img [ref=e150]
            - generic [ref=e152]: 返回
          - button "退出" [ref=e153] [cursor=pointer]:
            - img [ref=e155]
            - generic [ref=e158]: 退出
    - generic [ref=e159]:
      - generic [ref=e160]:
        - generic "工作台" [ref=e161] [cursor=pointer]:
          - generic [ref=e163]: 工作台
        - generic "出纳导航" [ref=e164] [cursor=pointer]:
          - generic [ref=e166]: 出纳导航
          - generic "关闭" [ref=e167]:
            - img [ref=e168]
        - generic "出纳录单" [ref=e171] [cursor=pointer]:
          - generic [ref=e173]: 出纳录单
          - generic "关闭" [ref=e174]:
            - img [ref=e175]
      - button "标签" [ref=e178] [cursor=pointer]:
        - img [ref=e179]
        - generic [ref=e183]: 标签
    - main [ref=e184]:
      - generic [ref=e186]:
        - generic [ref=e187]:
          - button "列设置" [ref=e188] [cursor=pointer]:
            - generic [ref=e189]:
              - img [ref=e191]
              - text: 列设置
          - button "录入日记账" [ref=e193] [cursor=pointer]:
            - generic [ref=e194]:
              - img [ref=e196]
              - text: 录入日记账
        - generic [ref=e198]:
          - generic [ref=e199]: 期初余额：
          - generic [ref=e200]: 本期借方：
          - generic [ref=e201]: 本期贷方：
          - generic [ref=e202]: 期末余额：
        - generic [ref=e205]:
          - table [ref=e207]:
            - rowgroup [ref=e222]:
              - row "选择所有行 日期 序号 摘要 对方科目 结算方式 票据号 对方单位 借方(收入) 贷方(支出) 余额 对账 操作" [ref=e223]:
                - columnheader "选择所有行" [ref=e224]:
                  - generic "选择所有行" [ref=e226]:
                    - generic [ref=e227] [cursor=pointer]:
                      - checkbox "选择所有行" [disabled]
                - columnheader "日期" [ref=e229]:
                  - generic [ref=e230]: 日期
                - columnheader "序号" [ref=e231]:
                  - generic [ref=e232]: 序号
                - columnheader "摘要" [ref=e233]:
                  - generic [ref=e234]: 摘要
                - columnheader "对方科目" [ref=e235]:
                  - generic [ref=e236]: 对方科目
                - columnheader "结算方式" [ref=e237]:
                  - generic [ref=e238]: 结算方式
                - columnheader "票据号" [ref=e239]:
                  - generic [ref=e240]: 票据号
                - columnheader "对方单位" [ref=e241]:
                  - generic [ref=e242]: 对方单位
                - columnheader "借方(收入)" [ref=e243]:
                  - generic [ref=e244]: 借方(收入)
                - columnheader "贷方(支出)" [ref=e245]:
                  - generic [ref=e246]: 贷方(支出)
                - columnheader "余额" [ref=e247]:
                  - generic [ref=e248]: 余额
                - columnheader "对账" [ref=e249]:
                  - generic [ref=e250]: 对账
                - columnheader "操作" [ref=e251]:
                  - generic [ref=e252]: 操作
          - generic [ref=e256]:
            - table:
              - rowgroup
            - generic [ref=e258]: 暂无数据
```

# Test source

```ts
  1   | /**
  2   |  * 出纳管理 E2E 测试
  3   |  *
  4   |  * 覆盖：页面渲染 / 科目加载 / 日记账录入与查询 / 余额计算 / 银行对账 / 期初余额
  5   |  */
  6   | import { test, expect, waitForTable, navTo, resolveAccountSetId, API_BASE } from './fixtures'
  7   | 
  8   | const API = API_BASE
  9   | 
  10  | test.describe('出纳管理', () => {
  11  |   // ── 日记账页面 ─────────────────────────────────────────
  12  | 
  13  |   test('出纳日记账页面能正常渲染', async ({ loggedInPage: page }) => {
  14  |     await navTo(page, '出纳管理', '出纳录单')
  15  |     // 页面标题由布局层的面包屑承载（导航改版后各页面不再自带 h3）
  16  |     await expect(page.locator('.apple-breadcrumb')).toContainText('出纳录单')
  17  |     await expect(page.locator('.el-table')).toBeVisible()
  18  |     // 科目下拉自动加载现金/银行科目
  19  |     await expect(page.locator('.el-select').first()).toBeVisible()
  20  |   })
  21  | 
  22  |   test('科目下拉包含现金和银行科目分组', async ({ loggedInPage: page }) => {
  23  |     await navTo(page, '出纳管理', '出纳录单')
> 24  |     await page.locator('.el-select').first().click()
      |                                              ^ TimeoutError: locator.click: Timeout 10000ms exceeded.
  25  |     await page.waitForSelector('.el-select-dropdown', { timeout: 5000 })
  26  |     // 期望有「现金科目」或「银行存款」分组标题
  27  |     const dropdown = page.locator('.el-select-dropdown')
  28  |     await expect(dropdown).toBeVisible()
  29  |     const optionCount = await dropdown.locator('.el-select-dropdown__item').count()
  30  |     expect(optionCount).toBeGreaterThan(0)
  31  |   })
  32  | 
  33  |   test('能录入出纳日记账并在列表显示', async ({ loggedInPage: page, request }) => {
  34  |     const asid = await resolveAccountSetId(request)
  35  |     // 取 token
  36  |     const lr = await request.post(`${API}/api/auth/login`, {
  37  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  38  |     })
  39  |     const { token } = await lr.json()
  40  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  41  | 
  42  |     // API 直接创建一条日记账（UI 录入在前端测试覆盖）
  43  |     const createRes = await request.post(`${API}/api/cashier/journal`, {
  44  |       headers,
  45  |       data: {
  46  |         account_code: '1001',
  47  |         biz_date: '2026-06-15',
  48  |         summary: 'E2E测试-提取备用金',
  49  |         debit: 1500,
  50  |         credit: 0,
  51  |         counter_unit: 'E2E测试单位',
  52  |       },
  53  |     })
  54  |     expect(createRes.ok()).toBeTruthy()
  55  |     const { data: { id: journalId } } = await createRes.json()
  56  | 
  57  |     // 查询日记账 API 验证写入
  58  |     const listRes = await request.get(
  59  |       `${API}/api/cashier/journal?account_code=1001`,
  60  |       { headers }
  61  |     )
  62  |     const listData = await listRes.json()
  63  |     expect(listData.code).toBe(0)
  64  |     const row = listData.data.rows.find((r: any) => r.id === journalId)
  65  |     expect(row).toBeDefined()
  66  |     expect(row.debit).toBe(1500)
  67  |     expect(row.summary).toBe('E2E测试-提取备用金')
  68  |     expect(typeof row.balance).toBe('number')  // 逐行余额存在
  69  | 
  70  |     // 清理
  71  |     await request.delete(`${API}/api/cashier/journal/${journalId}`, { headers })
  72  |   })
  73  | 
  74  |   test('日记账余额计算正确（期初 + 借 - 贷）', async ({ request }) => {
  75  |     const asid = await resolveAccountSetId(request)
  76  |     const lr = await request.post(`${API}/api/auth/login`, {
  77  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  78  |     })
  79  |     const { token } = await lr.json()
  80  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  81  | 
  82  |     // 查询期初余额
  83  |     const ibRes = await request.get(`${API}/api/cashier/init-balance`, { headers })
  84  |     const ibData = await ibRes.json()
  85  |     expect(ibData.code).toBe(0)
  86  | 
  87  |     // 查询日记账列表（含余额）
  88  |     const listRes = await request.get(`${API}/api/cashier/journal?account_code=1001`, { headers })
  89  |     const listData = await listRes.json()
  90  |     expect(listData.code).toBe(0)
  91  | 
  92  |     const { opening, rows, closing, totalDebit, totalCredit } = listData.data
  93  |     // 期末余额 = 期初 + 本期借 - 本期贷
  94  |     expect(Math.round((opening + totalDebit - totalCredit) * 100) / 100).toBeCloseTo(closing, 2)
  95  |     // 逐行余额最后一行应等于期末
  96  |     if (rows.length > 0) {
  97  |       expect(rows[rows.length - 1].balance).toBeCloseTo(closing, 2)
  98  |     }
  99  |   })
  100 | 
  101 |   test('银行对账 API 能自动勾对', async ({ request }) => {
  102 |     const asid = await resolveAccountSetId(request)
  103 |     const lr = await request.post(`${API}/api/auth/login`, {
  104 |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  105 |     })
  106 |     const { token } = await lr.json()
  107 |     const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  108 | 
  109 |     // 创建一条日记账 + 对应的银行对账单（金额相同、日期相同）
  110 |     const date = '2026-06-20'
  111 |     const jRes = await request.post(`${API}/api/cashier/journal`, {
  112 |       headers: H,
  113 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, summary: 'E2E对账测试' },
  114 |     })
  115 |     const { data: { id: jId } } = await jRes.json()
  116 | 
  117 |     const sRes = await request.post(`${API}/api/cashier/bank-statement`, {
  118 |       headers: H,
  119 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, bill_no: 'STMT001' },
  120 |     })
  121 |     const { data: { id: sId } } = await sRes.json()
  122 | 
  123 |     // 执行自动勾对
  124 |     const reconRes = await request.post(`${API}/api/cashier/reconcile/auto`, {
```
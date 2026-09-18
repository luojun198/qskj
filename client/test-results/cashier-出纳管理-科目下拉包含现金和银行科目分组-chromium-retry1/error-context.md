# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cashier.spec.ts >> 出纳管理 >> 科目下拉包含现金和银行科目分组
- Location: e2e\cashier.spec.ts:23:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('.el-select-dropdown')
Expected: visible
Error: strict mode violation: locator('.el-select-dropdown') resolved to 2 elements:
    1) <div class="el-select-dropdown">…</div> aka locator('div').filter({ hasText: '现金科目1001 库存现金1002001' }).nth(2)
    2) <div class="el-select-dropdown">…</div> aka locator('div').filter({ hasText: 'RMBUSD' }).nth(2)

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('.el-select-dropdown')

```

# Page snapshot

```yaml
- generic [ref=e1]:
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
        - generic "版本 20260918" [ref=e91]: v20260918
    - generic [ref=e92]:
      - generic [ref=e93]:
        - navigation "面包屑" [ref=e95]:
          - generic [ref=e96]:
            - link "出纳管理" [ref=e97]
            - text: /
          - generic [ref=e98]:
            - link "出纳业务" [ref=e99]
            - text: /
          - link "出纳录单" [ref=e101]
        - generic [ref=e102]:
          - generic [ref=e103]:
            - generic [ref=e104]: 当前账套：
            - img [ref=e106]
            - generic [ref=e109]: 未选账套
          - generic [ref=e110]:
            - generic [ref=e111]: 当前用户：
            - img [ref=e113]
            - generic [ref=e116]: 系统管理员
          - generic [ref=e117]:
            - button "切换操作员" [ref=e118] [cursor=pointer]:
              - img [ref=e120]
              - generic [ref=e123]: 切换操作员
            - button "切换账套" [ref=e124] [cursor=pointer]:
              - img [ref=e126]
              - generic [ref=e131]: 切换账套
          - generic [ref=e132]:
            - button "完整模式" [ref=e133] [cursor=pointer]:
              - img [ref=e135]
              - generic [ref=e138]: 完整模式
            - button "首页" [ref=e139] [cursor=pointer]:
              - img [ref=e141]
              - generic [ref=e144]: 首页
            - button "返回" [ref=e145] [cursor=pointer]:
              - img [ref=e147]
              - generic [ref=e149]: 返回
            - button "退出" [ref=e150] [cursor=pointer]:
              - img [ref=e152]
              - generic [ref=e155]: 退出
      - generic [ref=e156]:
        - generic [ref=e157]:
          - generic "工作台" [ref=e158] [cursor=pointer]:
            - generic [ref=e160]: 工作台
          - generic "出纳录单" [ref=e161] [cursor=pointer]:
            - generic [ref=e163]: 出纳录单
            - generic "关闭" [ref=e164]:
              - img [ref=e165]
        - button "标签" [ref=e168] [cursor=pointer]:
          - img [ref=e169]
          - generic [ref=e173]: 标签
      - main [ref=e174]:
        - generic [ref=e176]:
          - generic [ref=e177]:
            - generic [ref=e179]:
              - generic [ref=e180]:
                - combobox [expanded] [active] [ref=e182]
                - generic [ref=e183]: 1001 库存现金
              - img [ref=e186] [cursor=pointer]
            - generic [ref=e189] [cursor=pointer]:
              - generic:
                - combobox [ref=e191]
                - generic [ref=e192]: RMB
              - img [ref=e195]
            - generic [ref=e198]:
              - img [ref=e201]
              - combobox "开始日期" [ref=e203]: 2026-09-01
            - generic [ref=e204]: 至
            - generic [ref=e206]:
              - img [ref=e209]
              - combobox "结束日期" [ref=e211]: 2026-09-30
            - button "查询" [ref=e212] [cursor=pointer]:
              - generic [ref=e213]:
                - img [ref=e215]
                - text: 查询
            - button "清空" [ref=e217] [cursor=pointer]:
              - generic [ref=e218]:
                - img [ref=e220]
                - text: 清空
            - separator [ref=e222]
            - button "导入" [ref=e223] [cursor=pointer]:
              - generic [ref=e224]:
                - img [ref=e226]
                - text: 导入
            - button "导出" [ref=e228] [cursor=pointer]:
              - generic [ref=e229]:
                - img [ref=e231]
                - text: 导出
            - button "借贷互换" [ref=e233] [cursor=pointer]:
              - generic [ref=e234]:
                - img [ref=e236]
                - text: 借贷互换
            - separator [ref=e239]
            - button "银行对账" [ref=e240] [cursor=pointer]:
              - generic [ref=e241]:
                - img [ref=e243]
                - text: 银行对账
            - button "生成凭证" [ref=e246] [cursor=pointer]:
              - generic [ref=e247]:
                - img [ref=e249]
                - text: 生成凭证
            - button "删除凭证" [ref=e251] [cursor=pointer]:
              - generic [ref=e252]:
                - img [ref=e254]
                - text: 删除凭证
            - button "列设置" [ref=e256] [cursor=pointer]:
              - generic [ref=e257]:
                - img [ref=e259]
                - text: 列设置
            - button "录入日记账" [ref=e261] [cursor=pointer]:
              - generic [ref=e262]:
                - img [ref=e264]
                - text: 录入日记账
          - generic [ref=e266]:
            - generic [ref=e267]: 期初余额：25,143.60
            - generic [ref=e268]: 本期借方：15,300.00
            - generic [ref=e269]: 本期贷方：5,439.25
            - generic [ref=e270]: 期末余额：35,004.35
          - generic [ref=e273]:
            - table [ref=e275]:
              - rowgroup [ref=e290]:
                - row "选择所有行 日期 序号 摘要 对方科目 结算方式 票据号 对方单位 借方(收入) 贷方(支出) 余额 对账 操作" [ref=e291]:
                  - columnheader "选择所有行" [ref=e292]:
                    - generic "选择所有行" [ref=e294] [cursor=pointer]:
                      - generic [ref=e295]:
                        - checkbox "选择所有行"
                  - columnheader "日期" [ref=e297]:
                    - generic [ref=e298]: 日期
                  - columnheader "序号" [ref=e299]:
                    - generic [ref=e300]: 序号
                  - columnheader "摘要" [ref=e301]:
                    - generic [ref=e302]: 摘要
                  - columnheader "对方科目" [ref=e303]:
                    - generic [ref=e304]: 对方科目
                  - columnheader "结算方式" [ref=e305]:
                    - generic [ref=e306]: 结算方式
                  - columnheader "票据号" [ref=e307]:
                    - generic [ref=e308]: 票据号
                  - columnheader "对方单位" [ref=e309]:
                    - generic [ref=e310]: 对方单位
                  - columnheader "借方(收入)" [ref=e311]:
                    - generic [ref=e312]: 借方(收入)
                  - columnheader "贷方(支出)" [ref=e313]:
                    - generic [ref=e314]: 贷方(支出)
                  - columnheader "余额" [ref=e315]:
                    - generic [ref=e316]: 余额
                  - columnheader "对账" [ref=e317]:
                    - generic [ref=e318]: 对账
                  - columnheader "操作" [ref=e319]:
                    - generic [ref=e320]: 操作
            - table [ref=e325]:
              - rowgroup [ref=e340]:
                - row "选择当前行 2026-09-01 6 A客户货款（现金） 1122001 A客户 现金 深圳宏达电子 3,500.00 28,643.60 删除" [ref=e341]:
                  - cell "选择当前行" [ref=e342]:
                    - generic "选择当前行" [ref=e344] [cursor=pointer]:
                      - generic [ref=e345]:
                        - checkbox "选择当前行"
                  - cell "2026-09-01" [ref=e347]:
                    - generic [ref=e348]: 2026-09-01
                  - cell "6" [ref=e349]:
                    - generic [ref=e350]: "6"
                  - cell "A客户货款（现金）" [ref=e351]:
                    - generic [ref=e352]: A客户货款（现金）
                  - cell "1122001 A客户" [ref=e353]:
                    - generic [ref=e354]: 1122001 A客户
                  - cell "现金" [ref=e355]:
                    - generic [ref=e356]: 现金
                  - cell [ref=e357]
                  - cell "深圳宏达电子" [ref=e359]:
                    - generic [ref=e360]: 深圳宏达电子
                  - cell "3,500.00" [ref=e361]:
                    - generic [ref=e362]: 3,500.00
                  - cell [ref=e363]
                  - cell "28,643.60" [ref=e365]:
                    - generic [ref=e366]: 28,643.60
                  - cell [ref=e367]
                  - cell "删除" [ref=e369]:
                    - button "删除" [ref=e371] [cursor=pointer]:
                      - generic [ref=e372]: 删除
                - row "选择当前行 2026-09-02 7 支付快递费 6602004 办公费 现金 128.50 28,515.10 删除" [ref=e373]:
                  - cell "选择当前行" [ref=e374]:
                    - generic "选择当前行" [ref=e376] [cursor=pointer]:
                      - generic [ref=e377]:
                        - checkbox "选择当前行"
                  - cell "2026-09-02" [ref=e379]:
                    - generic [ref=e380]: 2026-09-02
                  - cell "7" [ref=e381]:
                    - generic [ref=e382]: "7"
                  - cell "支付快递费" [ref=e383]:
                    - generic [ref=e384]: 支付快递费
                  - cell "6602004 办公费" [ref=e385]:
                    - generic [ref=e386]: 6602004 办公费
                  - cell "现金" [ref=e387]:
                    - generic [ref=e388]: 现金
                  - cell [ref=e389]
                  - cell [ref=e391]
                  - cell [ref=e393]
                  - cell "128.50" [ref=e395]:
                    - generic [ref=e396]: "128.50"
                  - cell "28,515.10" [ref=e397]:
                    - generic [ref=e398]: 28,515.10
                  - cell [ref=e399]
                  - cell "删除" [ref=e401]:
                    - button "删除" [ref=e403] [cursor=pointer]:
                      - generic [ref=e404]: 删除
                - row "选择当前行 2026-09-04 8 退回多收款项 2241 其他应付款 现金 王五 800.00 29,315.10 删除" [ref=e405]:
                  - cell "选择当前行" [ref=e406]:
                    - generic "选择当前行" [ref=e408] [cursor=pointer]:
                      - generic [ref=e409]:
                        - checkbox "选择当前行"
                  - cell "2026-09-04" [ref=e411]:
                    - generic [ref=e412]: 2026-09-04
                  - cell "8" [ref=e413]:
                    - generic [ref=e414]: "8"
                  - cell "退回多收款项" [ref=e415]:
                    - generic [ref=e416]: 退回多收款项
                  - cell "2241 其他应付款" [ref=e417]:
                    - generic [ref=e418]: 2241 其他应付款
                  - cell "现金" [ref=e419]:
                    - generic [ref=e420]: 现金
                  - cell [ref=e421]
                  - cell "王五" [ref=e423]:
                    - generic [ref=e424]: 王五
                  - cell "800.00" [ref=e425]:
                    - generic [ref=e426]: "800.00"
                  - cell [ref=e427]
                  - cell "29,315.10" [ref=e429]:
                    - generic [ref=e430]: 29,315.10
                  - cell [ref=e431]
                  - cell "删除" [ref=e433]:
                    - button "删除" [ref=e435] [cursor=pointer]:
                      - generic [ref=e436]: 删除
                - row "选择当前行 2026-09-08 9 张三报销差旅费 6602002 差旅费 现金 张三 2,450.00 26,865.10 删除" [ref=e437]:
                  - cell "选择当前行" [ref=e438]:
                    - generic "选择当前行" [ref=e440] [cursor=pointer]:
                      - generic [ref=e441]:
                        - checkbox "选择当前行"
                  - cell "2026-09-08" [ref=e443]:
                    - generic [ref=e444]: 2026-09-08
                  - cell "9" [ref=e445]:
                    - generic [ref=e446]: "9"
                  - cell "张三报销差旅费" [ref=e447]:
                    - generic [ref=e448]: 张三报销差旅费
                  - cell "6602002 差旅费" [ref=e449]:
                    - generic [ref=e450]: 6602002 差旅费
                  - cell "现金" [ref=e451]:
                    - generic [ref=e452]: 现金
                  - cell [ref=e453]
                  - cell "张三" [ref=e455]:
                    - generic [ref=e456]: 张三
                  - cell [ref=e457]
                  - cell "2,450.00" [ref=e459]:
                    - generic [ref=e460]: 2,450.00
                  - cell "26,865.10" [ref=e461]:
                    - generic [ref=e462]: 26,865.10
                  - cell [ref=e463]
                  - cell "删除" [ref=e465]:
                    - button "删除" [ref=e467] [cursor=pointer]:
                      - generic [ref=e468]: 删除
                - row "选择当前行 2026-09-10 10 李四归还借款 2241 其他应付款 现金 李四 1,000.00 27,865.10 删除" [ref=e469]:
                  - cell "选择当前行" [ref=e470]:
                    - generic "选择当前行" [ref=e472] [cursor=pointer]:
                      - generic [ref=e473]:
                        - checkbox "选择当前行"
                  - cell "2026-09-10" [ref=e475]:
                    - generic [ref=e476]: 2026-09-10
                  - cell "10" [ref=e477]:
                    - generic [ref=e478]: "10"
                  - cell "李四归还借款" [ref=e479]:
                    - generic [ref=e480]: 李四归还借款
                  - cell "2241 其他应付款" [ref=e481]:
                    - generic [ref=e482]: 2241 其他应付款
                  - cell "现金" [ref=e483]:
                    - generic [ref=e484]: 现金
                  - cell [ref=e485]
                  - cell "李四" [ref=e487]:
                    - generic [ref=e488]: 李四
                  - cell "1,000.00" [ref=e489]:
                    - generic [ref=e490]: 1,000.00
                  - cell [ref=e491]
                  - cell "27,865.10" [ref=e493]:
                    - generic [ref=e494]: 27,865.10
                  - cell [ref=e495]
                  - cell "删除" [ref=e497]:
                    - button "删除" [ref=e499] [cursor=pointer]:
                      - generic [ref=e500]: 删除
                - row "选择当前行 2026-09-12 11 支付9月水电费 6602006 水电费 现金 SJ0908 2,360.75 25,504.35 删除" [ref=e501]:
                  - cell "选择当前行" [ref=e502]:
                    - generic "选择当前行" [ref=e504] [cursor=pointer]:
                      - generic [ref=e505]:
                        - checkbox "选择当前行"
                  - cell "2026-09-12" [ref=e507]:
                    - generic [ref=e508]: 2026-09-12
                  - cell "11" [ref=e509]:
                    - generic [ref=e510]: "11"
                  - cell "支付9月水电费" [ref=e511]:
                    - generic [ref=e512]: 支付9月水电费
                  - cell "6602006 水电费" [ref=e513]:
                    - generic [ref=e514]: 6602006 水电费
                  - cell "现金" [ref=e515]:
                    - generic [ref=e516]: 现金
                  - cell "SJ0908" [ref=e517]:
                    - generic [ref=e518]: SJ0908
                  - cell [ref=e519]
                  - cell [ref=e521]
                  - cell "2,360.75" [ref=e523]:
                    - generic [ref=e524]: 2,360.75
                  - cell "25,504.35" [ref=e525]:
                    - generic [ref=e526]: 25,504.35
                  - cell [ref=e527]
                  - cell "删除" [ref=e529]:
                    - button "删除" [ref=e531] [cursor=pointer]:
                      - generic [ref=e532]: 删除
                - row "选择当前行 2026-09-15 12 现金销售收入 6001001 销货收入 现金 9,800.00 35,304.35 删除" [ref=e533]:
                  - cell "选择当前行" [ref=e534]:
                    - generic "选择当前行" [ref=e536] [cursor=pointer]:
                      - generic [ref=e537]:
                        - checkbox "选择当前行"
                  - cell "2026-09-15" [ref=e539]:
                    - generic [ref=e540]: 2026-09-15
                  - cell "12" [ref=e541]:
                    - generic [ref=e542]: "12"
                  - cell "现金销售收入" [ref=e543]:
                    - generic [ref=e544]: 现金销售收入
                  - cell "6001001 销货收入" [ref=e545]:
                    - generic [ref=e546]: 6001001 销货收入
                  - cell "现金" [ref=e547]:
                    - generic [ref=e548]: 现金
                  - cell [ref=e549]
                  - cell [ref=e551]
                  - cell "9,800.00" [ref=e553]:
                    - generic [ref=e554]: 9,800.00
                  - cell [ref=e555]
                  - cell "35,304.35" [ref=e557]:
                    - generic [ref=e558]: 35,304.35
                  - cell [ref=e559]
                  - cell "删除" [ref=e561]:
                    - button "删除" [ref=e563] [cursor=pointer]:
                      - generic [ref=e564]: 删除
                - row "选择当前行 2026-09-16 13 现金盘盈（待处理） 200.00 35,504.35 删除" [ref=e565]:
                  - cell "选择当前行" [ref=e566]:
                    - generic "选择当前行" [ref=e568] [cursor=pointer]:
                      - generic [ref=e569]:
                        - checkbox "选择当前行"
                  - cell "2026-09-16" [ref=e571]:
                    - generic [ref=e572]: 2026-09-16
                  - cell "13" [ref=e573]:
                    - generic [ref=e574]: "13"
                  - cell "现金盘盈（待处理）" [ref=e575]:
                    - generic [ref=e576]: 现金盘盈（待处理）
                  - cell [ref=e577]
                  - cell [ref=e579]
                  - cell [ref=e581]
                  - cell [ref=e583]
                  - cell "200.00" [ref=e585]:
                    - generic [ref=e586]: "200.00"
                  - cell [ref=e587]
                  - cell "35,504.35" [ref=e589]:
                    - generic [ref=e590]: 35,504.35
                  - cell [ref=e591]
                  - cell "删除" [ref=e593]:
                    - button "删除" [ref=e595] [cursor=pointer]:
                      - generic [ref=e596]: 删除
                - row "选择当前行 2026-09-16 14 支付临时修理费 现金 500.00 35,004.35 删除" [ref=e597]:
                  - cell "选择当前行" [ref=e598]:
                    - generic "选择当前行" [ref=e600] [cursor=pointer]:
                      - generic [ref=e601]:
                        - checkbox "选择当前行"
                  - cell "2026-09-16" [ref=e603]:
                    - generic [ref=e604]: 2026-09-16
                  - cell "14" [ref=e605]:
                    - generic [ref=e606]: "14"
                  - cell "支付临时修理费" [ref=e607]:
                    - generic [ref=e608]: 支付临时修理费
                  - cell [ref=e609]
                  - cell "现金" [ref=e611]:
                    - generic [ref=e612]: 现金
                  - cell [ref=e613]
                  - cell [ref=e615]
                  - cell [ref=e617]
                  - cell "500.00" [ref=e619]:
                    - generic [ref=e620]: "500.00"
                  - cell "35,004.35" [ref=e621]:
                    - generic [ref=e622]: 35,004.35
                  - cell [ref=e623]
                  - cell "删除" [ref=e625]:
                    - button "删除" [ref=e627] [cursor=pointer]:
                      - generic [ref=e628]: 删除
  - tooltip "1001 库存现金" [ref=e630]:
    - listbox [ref=e634]:
      - list [ref=e635]:
        - listitem [ref=e636]: 现金科目
        - listitem [ref=e637]:
          - list [ref=e638]:
            - option "1001 库存现金" [selected] [ref=e639] [cursor=pointer]
            - option "1002001 中行美元户" [ref=e640] [cursor=pointer]
      - list [ref=e641]:
        - listitem [ref=e642]: 银行存款科目
        - listitem [ref=e643]:
          - list [ref=e644]:
            - option "1015001 外埠存款" [ref=e645] [cursor=pointer]
            - option "1015002 银行本票" [ref=e646] [cursor=pointer]
            - option "1015003 银行汇票" [ref=e647] [cursor=pointer]
            - option "1015004 信用卡" [ref=e648] [cursor=pointer]
            - option "1015005 信用证保证金" [ref=e649] [cursor=pointer]
            - option "1015006 存出投资款" [ref=e650] [cursor=pointer]
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
  14  |     // 出纳工作台的入口叫「单据录入」；先经应用栏进入出纳工作台再点入口
  15  |     await navTo(page, '出纳管理', '单据录入')
  16  |     // 页面标题由布局层的面包屑承载（导航改版后各页面不再自带 h3）
  17  |     await expect(page.locator('.apple-breadcrumb')).toContainText('出纳录单')
  18  |     await expect(page.locator('.el-table')).toBeVisible()
  19  |     // 科目下拉自动加载现金/银行科目
  20  |     await expect(page.locator('.el-select').first()).toBeVisible()
  21  |   })
  22  | 
  23  |   test('科目下拉包含现金和银行科目分组', async ({ loggedInPage: page }) => {
  24  |     await page.goto('/cashier/journal')
  25  |     await page.locator('.el-select').first().click()
  26  |     await page.waitForSelector('.el-select-dropdown', { timeout: 5000 })
  27  |     // 期望有「现金科目」或「银行存款」分组标题
  28  |     const dropdown = page.locator('.el-select-dropdown')
> 29  |     await expect(dropdown).toBeVisible()
      |                            ^ Error: expect(locator).toBeVisible() failed
  30  |     const optionCount = await dropdown.locator('.el-select-dropdown__item').count()
  31  |     expect(optionCount).toBeGreaterThan(0)
  32  |   })
  33  | 
  34  |   test('能录入出纳日记账并在列表显示', async ({ loggedInPage: page, request }) => {
  35  |     const asid = await resolveAccountSetId(request)
  36  |     // 取 token
  37  |     const lr = await request.post(`${API}/api/auth/login`, {
  38  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  39  |     })
  40  |     const { token } = await lr.json()
  41  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  42  | 
  43  |     // API 直接创建一条日记账（UI 录入在前端测试覆盖）
  44  |     const createRes = await request.post(`${API}/api/cashier/journal`, {
  45  |       headers,
  46  |       data: {
  47  |         account_code: '1001',
  48  |         biz_date: '2026-06-15',
  49  |         summary: 'E2E测试-提取备用金',
  50  |         debit: 1500,
  51  |         credit: 0,
  52  |         counter_unit: 'E2E测试单位',
  53  |       },
  54  |     })
  55  |     expect(createRes.ok()).toBeTruthy()
  56  |     const { data: { id: journalId } } = await createRes.json()
  57  | 
  58  |     // 查询日记账 API 验证写入
  59  |     const listRes = await request.get(
  60  |       `${API}/api/cashier/journal?account_code=1001`,
  61  |       { headers }
  62  |     )
  63  |     const listData = await listRes.json()
  64  |     expect(listData.code).toBe(0)
  65  |     const row = listData.data.rows.find((r: any) => r.id === journalId)
  66  |     expect(row).toBeDefined()
  67  |     expect(row.debit).toBe(1500)
  68  |     expect(row.summary).toBe('E2E测试-提取备用金')
  69  |     expect(typeof row.balance).toBe('number')  // 逐行余额存在
  70  | 
  71  |     // 清理
  72  |     await request.delete(`${API}/api/cashier/journal/${journalId}`, { headers })
  73  |   })
  74  | 
  75  |   test('日记账余额计算正确（期初 + 借 - 贷）', async ({ request }) => {
  76  |     const asid = await resolveAccountSetId(request)
  77  |     const lr = await request.post(`${API}/api/auth/login`, {
  78  |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  79  |     })
  80  |     const { token } = await lr.json()
  81  |     const headers = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  82  | 
  83  |     // 查询期初余额
  84  |     const ibRes = await request.get(`${API}/api/cashier/init-balance`, { headers })
  85  |     const ibData = await ibRes.json()
  86  |     expect(ibData.code).toBe(0)
  87  | 
  88  |     // 查询日记账列表（含余额）
  89  |     const listRes = await request.get(`${API}/api/cashier/journal?account_code=1001`, { headers })
  90  |     const listData = await listRes.json()
  91  |     expect(listData.code).toBe(0)
  92  | 
  93  |     const { opening, rows, closing, totalDebit, totalCredit } = listData.data
  94  |     // 期末余额 = 期初 + 本期借 - 本期贷
  95  |     expect(Math.round((opening + totalDebit - totalCredit) * 100) / 100).toBeCloseTo(closing, 2)
  96  |     // 逐行余额最后一行应等于期末
  97  |     if (rows.length > 0) {
  98  |       expect(rows[rows.length - 1].balance).toBeCloseTo(closing, 2)
  99  |     }
  100 |   })
  101 | 
  102 |   test('银行对账 API 能自动勾对', async ({ request }) => {
  103 |     const asid = await resolveAccountSetId(request)
  104 |     const lr = await request.post(`${API}/api/auth/login`, {
  105 |       data: { username: 'admin', password: 'admin123', targetAccountSetId: asid },
  106 |     })
  107 |     const { token } = await lr.json()
  108 |     const H = { Authorization: `Bearer ${token}`, 'x-account-set-id': asid }
  109 | 
  110 |     // 创建一条日记账 + 对应的银行对账单（金额相同、日期相同）
  111 |     const date = '2026-06-20'
  112 |     const jRes = await request.post(`${API}/api/cashier/journal`, {
  113 |       headers: H,
  114 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, summary: 'E2E对账测试' },
  115 |     })
  116 |     const { data: { id: jId } } = await jRes.json()
  117 | 
  118 |     const sRes = await request.post(`${API}/api/cashier/bank-statement`, {
  119 |       headers: H,
  120 |       data: { account_code: '1002', biz_date: date, debit: 0, credit: 8000, bill_no: 'STMT001' },
  121 |     })
  122 |     const { data: { id: sId } } = await sRes.json()
  123 | 
  124 |     // 执行自动勾对
  125 |     const reconRes = await request.post(`${API}/api/cashier/reconcile/auto`, {
  126 |       headers: H,
  127 |       data: { account_code: '1002', start_date: date, end_date: date },
  128 |     })
  129 |     const reconData = await reconRes.json()
```
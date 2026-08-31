# 测试覆盖提升计划

## 目标
建立完善的测试体系，提升代码质量和可靠性

## 当前状态
- ✅ 服务层测试：已有（voucherEntry, voucherQuery, ledgerQuery, reportQuery, autoTransfer）
- ❌ 路由层测试：无
- ❌ 前端单元测试：无
- ❌ 端到端测试：无
- ❌ 测试覆盖率统计：无

## 测试策略

### 测试金字塔
```
        /\
       /E2E\      端到端测试（10%）- 关键业务流程
      /------\
     /集成测试\    集成测试（30%）- API接口测试
    /----------\
   /  单元测试  \  单元测试（60%）- 服务层、工具函数
  /--------------\
```

## 第1部分：后端测试（3天）

### 1.1 路由层集成测试（2天）

#### 测试框架选择
使用 **Vitest** + **Supertest**

安装依赖：
```bash
npm install -D vitest supertest @types/supertest
```

#### 测试文件结构
```
server/tests/
├── integration/
│   ├── voucher.test.ts       # 凭证管理接口测试
│   ├── base.test.ts          # 基础设置接口测试
│   ├── ledger.test.ts        # 账簿查询接口测试
│   ├── report.test.ts        # 报表接口测试
│   ├── system.test.ts        # 系统管理接口测试
│   └── auth.test.ts          # 认证接口测试
├── unit/
│   └── services/             # 服务层单元测试（已有）
├── fixtures/
│   ├── testDb.ts             # 测试数据库初始化
│   ├── mockData.ts           # 模拟数据
│   └── testHelpers.ts        # 测试辅助函数
└── setup.ts                  # 测试环境配置
```

#### 示例：凭证接口测试
```typescript
// server/tests/integration/voucher.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../../src/index'
import { initTestDb, cleanupTestDb } from '../fixtures/testDb'

describe('Voucher API', () => {
  let token: string
  let voucherId: string

  beforeAll(async () => {
    await initTestDb()
    // 登录获取 token
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' })
    token = res.body.token
  })

  afterAll(async () => {
    await cleanupTestDb()
  })

  describe('POST /api/voucher/vouchers', () => {
    it('should create a new voucher', async () => {
      const res = await request(app)
        .post('/api/voucher/vouchers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          voucher_date: '2026-04-01',
          entries: [
            { account_id: 'acc1', direction: 'debit', amount: 1000, summary: '测试' },
            { account_id: 'acc2', direction: 'credit', amount: 1000, summary: '测试' }
          ]
        })

      expect(res.status).toBe(200)
      expect(res.body.code).toBe(0)
      expect(res.body.data).toHaveProperty('id')
      voucherId = res.body.data.id
    })

    it('should reject unbalanced voucher', async () => {
      const res = await request(app)
        .post('/api/voucher/vouchers')
        .set('Authorization', `Bearer ${token}`)
        .send({
          voucher_date: '2026-04-01',
          entries: [
            { account_id: 'acc1', direction: 'debit', amount: 1000, summary: '测试' },
            { account_id: 'acc2', direction: 'credit', amount: 500, summary: '测试' }
          ]
        })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('借贷不平衡')
    })
  })

  describe('GET /api/voucher/vouchers/:id', () => {
    it('should get voucher detail', async () => {
      const res = await request(app)
        .get(`/api/voucher/vouchers/${voucherId}`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.code).toBe(0)
      expect(res.body.data.id).toBe(voucherId)
    })
  })

  describe('POST /api/voucher/vouchers/:id/audit', () => {
    it('should audit voucher', async () => {
      const res = await request(app)
        .post(`/api/voucher/vouchers/${voucherId}/audit`)
        .set('Authorization', `Bearer ${token}`)

      expect(res.status).toBe(200)
      expect(res.body.code).toBe(0)
    })
  })
})
```

#### 测试覆盖目标
- 凭证管理：20个测试用例
- 基础设置：15个测试用例
- 账簿查询：10个测试用例
- 报表管理：15个测试用例
- 系统管理：10个测试用例
- 认证授权：8个测试用例

**总计：78个集成测试用例**

### 1.2 测试覆盖率统计（0.5天）

配置 Vitest 覆盖率：
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
      }
    }
  }
})
```

运行测试：
```bash
npm run test:coverage
```

### 1.3 CI/CD 集成（0.5天）

创建 GitHub Actions 工作流：
```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

## 第2部分：前端测试（2天）

### 2.1 前端单元测试（1.5天）

#### 测试框架选择
使用 **Vitest** + **@vue/test-utils**

安装依赖：
```bash
npm install -D vitest @vue/test-utils jsdom
```

#### 测试文件结构
```
client/tests/
├── unit/
│   ├── components/
│   │   ├── VoucherForm.test.ts
│   │   ├── VoucherEntryTable.test.ts
│   │   └── DataTable.test.ts
│   ├── composables/
│   │   ├── useVoucherForm.test.ts
│   │   └── useVoucherEntries.test.ts
│   └── utils/
│       ├── format.test.ts
│       └── validate.test.ts
├── fixtures/
│   └── mockData.ts
└── setup.ts
```

#### 示例：组件测试
```typescript
// client/tests/unit/components/VoucherForm.test.ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VoucherForm from '@/components/VoucherForm.vue'

describe('VoucherForm', () => {
  it('renders properly', () => {
    const wrapper = mount(VoucherForm, {
      props: {
        modelValue: {
          voucher_date: '2026-04-01',
          voucher_type_id: '',
          remark: ''
        }
      }
    })
    expect(wrapper.find('input[type="date"]').exists()).toBe(true)
  })

  it('validates required fields', async () => {
    const wrapper = mount(VoucherForm)
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('error')).toBeTruthy()
  })

  it('emits update event on change', async () => {
    const wrapper = mount(VoucherForm)
    await wrapper.find('input[type="date"]').setValue('2026-04-15')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
  })
})
```

#### 示例：Composable 测试
```typescript
// client/tests/unit/composables/useVoucherEntries.test.ts
import { describe, it, expect } from 'vitest'
import { useVoucherEntries } from '@/composables/useVoucherEntries'

describe('useVoucherEntries', () => {
  it('adds entry correctly', () => {
    const { entries, addEntry } = useVoucherEntries()
    addEntry()
    expect(entries.value.length).toBe(1)
  })

  it('calculates total correctly', () => {
    const { entries, calculateTotal } = useVoucherEntries()
    entries.value = [
      { direction: 'debit', amount: 1000 },
      { direction: 'debit', amount: 500 },
      { direction: 'credit', amount: 1500 }
    ]
    const { debitTotal, creditTotal } = calculateTotal()
    expect(debitTotal).toBe(1500)
    expect(creditTotal).toBe(1500)
  })

  it('validates balance', () => {
    const { entries, validateBalance } = useVoucherEntries()
    entries.value = [
      { direction: 'debit', amount: 1000 },
      { direction: 'credit', amount: 500 }
    ]
    expect(validateBalance()).toBe(false)
  })
})
```

#### 测试覆盖目标
- 核心组件：15个测试用例
- Composables：10个测试用例
- 工具函数：10个测试用例

**总计：35个前端单元测试用例**

### 2.2 前端快照测试（0.5天）

对关键组件进行快照测试：
```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import VoucherEntryTable from '@/components/VoucherEntryTable.vue'

describe('VoucherEntryTable snapshot', () => {
  it('matches snapshot', () => {
    const wrapper = mount(VoucherEntryTable, {
      props: {
        entries: [
          { account_name: '库存现金', direction: 'debit', amount: 1000 }
        ]
      }
    })
    expect(wrapper.html()).toMatchSnapshot()
  })
})
```

## 第3部分：端到端测试（2天）

### 3.1 E2E测试框架选择

使用 **Playwright**

安装依赖：
```bash
npm install -D @playwright/test
npx playwright install
```

### 3.2 测试场景设计

#### 关键业务流程
1. **用户登录流程**
2. **凭证录入流程**
3. **凭证审核流程**
4. **凭证过账流程**
5. **月结流程**
6. **报表查询流程**

#### 示例：凭证录入E2E测试
```typescript
// e2e/voucher-entry.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Voucher Entry Flow', () => {
  test.beforeEach(async ({ page }) => {
    // 登录
    await page.goto('http://localhost:5175/login')
    await page.fill('input[name="username"]', 'admin')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await expect(page).toHaveURL(/.*dashboard/)
  })

  test('should create a new voucher', async ({ page }) => {
    // 进入凭证录入页面
    await page.click('text=凭证录入')
    await expect(page).toHaveURL(/.*voucher\/entry/)

    // 点击新增凭证
    await page.click('button:has-text("新增凭证")')

    // 填写凭证信息
    await page.fill('input[type="date"]', '2026-04-15')

    // 添加第一条分录
    await page.click('button:has-text("添加分录")')
    await page.fill('input[placeholder="科目"]', '库存现金')
    await page.click('text=1001 库存现金')
    await page.selectOption('select[name="direction"]', 'debit')
    await page.fill('input[name="amount"]', '1000')
    await page.fill('input[name="summary"]', '收到现金')

    // 添加第二条分录
    await page.click('button:has-text("添加分录")')
    await page.fill('input[placeholder="科目"]', '银行存款')
    await page.click('text=1002 银行存款')
    await page.selectOption('select[name="direction"]', 'credit')
    await page.fill('input[name="amount"]', '1000')
    await page.fill('input[name="summary"]', '转账')

    // 保存凭证
    await page.click('button:has-text("保存")')

    // 验证成功提示
    await expect(page.locator('.el-message--success')).toBeVisible()

    // 验证凭证出现在列表中
    await expect(page.locator('text=收到现金')).toBeVisible()
  })

  test('should reject unbalanced voucher', async ({ page }) => {
    await page.click('text=凭证录入')
    await page.click('button:has-text("新增凭证")')

    // 添加不平衡的分录
    await page.fill('input[type="date"]', '2026-04-15')
    await page.click('button:has-text("添加分录")')
    await page.fill('input[name="amount"]', '1000')
    await page.click('button:has-text("添加分录")')
    await page.fill('input[name="amount"]', '500')

    // 尝试保存
    await page.click('button:has-text("保存")')

    // 验证错误提示
    await expect(page.locator('text=借贷不平衡')).toBeVisible()
  })
})
```

### 3.3 E2E测试覆盖目标
- 用户认证流程：3个测试用例
- 凭证管理流程：8个测试用例
- 账簿查询流程：3个测试用例
- 报表管理流程：3个测试用例
- 系统管理流程：3个测试用例

**总计：20个E2E测试用例**

## 测试数据管理

### 测试数据库
```typescript
// server/tests/fixtures/testDb.ts
import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { resolve } from 'path'

export async function initTestDb() {
  const db = new Database(':memory:')
  const schema = readFileSync(resolve(__dirname, '../../src/db/schema.sql'), 'utf-8')
  db.exec(schema)

  // 插入测试数据
  seedTestData(db)

  return db
}

function seedTestData(db: Database.Database) {
  // 插入测试账套
  db.prepare(`
    INSERT INTO account_sets (id, name, code, fiscal_year, start_date)
    VALUES ('test-set', '测试账套', 'TEST', 2026, '2026-01-01')
  `).run()

  // 插入测试用户
  db.prepare(`
    INSERT INTO users (id, account_set_id, username, password, role_id)
    VALUES ('test-user', 'test-set', 'admin', '$2a$10$...', 'admin')
  `).run()

  // 插入测试科目
  // ...
}
```

## 测试脚本配置

更新 package.json：
```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "test:e2e": "playwright test",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

## 实施时间表

| 任务 | 时间 | 优先级 |
|------|------|--------|
| 路由层集成测试 | 2天 | 🔴 高 |
| 测试覆盖率配置 | 0.5天 | 🔴 高 |
| CI/CD集成 | 0.5天 | 🔴 高 |
| 前端单元测试 | 1.5天 | 🟡 中 |
| 前端快照测试 | 0.5天 | 🟡 中 |
| E2E测试 | 2天 | 🟡 中 |

**总计：7天**

## 预期收益
- 代码覆盖率：0% → 70%+
- 回归测试自动化：100%
- 发现潜在bug：预计10-20个
- 重构信心：显著提升
- 持续集成：自动化测试

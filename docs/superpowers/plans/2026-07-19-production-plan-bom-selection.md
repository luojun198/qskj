# Production Plan BOM Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 手工新增生产计划时，单 BOM 自动带出，多 BOM 通过双击打开只包含当前成品 BOM 的选择器。

**Architecture:** 把 BOM 按成品匹配和产品变更判断抽到纯函数，生产计划表单与现有 BOM 选择器共用该规则。继续一次加载全部 BOM，仅在前端过滤，不增加接口和数据库结构。

**Tech Stack:** Vue 3、TypeScript、Element Plus、Vitest、Vue Test Utils

---

### Task 1: BOM 匹配规则

**Files:**
- Create: `client/src/utils/productionPlanBom.ts`
- Create: `client/src/utils/__tests__/productionPlanBom.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { matchProductBoms, shouldResetProductBom } from '@/utils/productionPlanBom'

const boms = [
  { id: 'B1', item_code: 'P1' },
  { id: 'B2', item_code: 'P1' },
  { id: 'B3', item_code: 'P2' },
]

describe('生产计划 BOM 匹配', () => {
  it('只返回当前成品对应的 BOM', () => {
    expect(matchProductBoms(boms, 'P1').map(row => row.id)).toEqual(['B1', 'B2'])
    expect(matchProductBoms(boms, 'P2').map(row => row.id)).toEqual(['B3'])
    expect(matchProductBoms(boms, '')).toEqual([])
  })

  it('只有产品实际变化时清理旧 BOM', () => {
    expect(shouldResetProductBom('P1', 'P2')).toBe(true)
    expect(shouldResetProductBom('P1', 'P1')).toBe(false)
    expect(shouldResetProductBom('', 'P1')).toBe(false)
  })
})
```

- [ ] **Step 2: 确认测试因缺少模块失败**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: FAIL，提示找不到 `@/utils/productionPlanBom`。

- [ ] **Step 3: 实现最小纯函数**

```ts
export interface ProductBomLike {
  id: string
  item_code?: string
}

export function matchProductBoms<T extends ProductBomLike>(boms: T[], itemCode: string): T[] {
  const code = String(itemCode || '').trim()
  return code ? boms.filter(bom => bom.item_code === code) : []
}

export function shouldResetProductBom(previousItemCode: string, nextItemCode: string): boolean {
  return !!previousItemCode && previousItemCode !== nextItemCode
}
```

- [ ] **Step 4: 确认纯函数测试通过**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: 2 tests passed。

### Task 2: BOM 选择器按产品过滤

**Files:**
- Modify: `client/src/components/scm/BomPicker.vue`
- Test: `client/src/utils/__tests__/productionPlanBom.spec.ts`

- [ ] **Step 1: 扩展失败测试，覆盖单个和多个匹配结果**

```ts
it('单 BOM 可直接确定，多个 BOM 保留候选供用户选择', () => {
  expect(matchProductBoms(boms, 'P2')).toHaveLength(1)
  expect(matchProductBoms(boms, 'P1')).toHaveLength(2)
})
```

- [ ] **Step 2: 运行测试并确认新增断言先通过现有匹配函数**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: PASS；该步骤锁定 Task 1 已建立的公共规则，后续组件只接线，不重复实现过滤算法。

- [ ] **Step 3: 为选择器增加产品过滤参数**

```ts
import { matchProductBoms } from '@/utils/productionPlanBom'

const props = defineProps<{ modelValue: boolean; itemCode?: string }>()
const productBoms = computed(() => matchProductBoms(list.value, props.itemCode || ''))
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const base = props.itemCode ? productBoms.value : list.value
  if (!kw) return base
  return base.filter((b: any) =>
    [b.code, b.name, b.item_code, b.item_name, b.spec]
      .some(v => String(v || '').toLowerCase().includes(kw)))
})
```

- [ ] **Step 4: 运行测试**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: PASS。

### Task 3: 生产计划表单自动选择与双击过滤

**Files:**
- Modify: `client/src/views/scm/ProductionPlanForm.vue`
- Test: `client/src/utils/__tests__/productionPlanBom.spec.ts`

- [ ] **Step 1: 在表单中接入公共匹配规则**

```ts
import { matchProductBoms, shouldResetProductBom } from '@/utils/productionPlanBom'

async function onPickProduct(item: any, row: any) {
  const nextCode = String(item.code || '')
  if (shouldResetProductBom(row._resolved_item_code || '', nextCode)) {
    row.bom_id = ''
    row.lines = []
  }
  row.item_code = nextCode
  row.item_name = item.name
  row._resolved_item_code = nextCode
  if (row.bom_id || row.lines.length) return
  const matched = matchProductBoms(boms.value, nextCode)
  if (matched.length === 1) {
    row.bom_id = matched[0].id
    await loadBomInto(row, matched[0].id)
  }
}
```

- [ ] **Step 2: 保存产品解析标记**

新行增加 `_resolved_item_code: ''`；加载已有计划时设置 `_resolved_item_code: pd.item_code`，确保首次打开编辑页不清空已保存 BOM。

- [ ] **Step 3: 双击时传入当前产品编码**

```vue
<BomPicker
  v-if="bomPickerVisible"
  v-model="bomPickerVisible"
  :item-code="bomPickerItemCode"
  @confirm="onBomPicked"
/>
```

```ts
const bomPickerItemCode = ref('')
function openBomPicker(idx: number) {
  if (readonly.value) return
  const row = form.value.products[idx]
  if (!row?.item_code) return void ElMessage.warning('请先选择成品')
  bomPickerForIndex.value = idx
  bomPickerItemCode.value = row.item_code
  bomPickerVisible.value = true
}
```

- [ ] **Step 4: 运行针对性测试**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: PASS。

### Task 4: 验证与日志

**Files:**
- Modify: `优化日志.md`

- [ ] **Step 1: 运行前端相关测试**

Run: `npm.cmd run test -- --run src/utils/__tests__/productionPlanBom.spec.ts`

Expected: PASS。

- [ ] **Step 2: 运行 Vite 生产构建**

Run: `npm.cmd run build:deploy`

Expected: exit 0，生成 `client/dist`。

- [ ] **Step 3: 浏览器验收**

打开 `/scm/production-plans/new?plan_type=self`：验证单 BOM 自动带出；多 BOM 双击仅显示当前产品 BOM；更换产品不残留旧 BOM 和用料。

- [ ] **Step 4: 更新优化日志**

在 `优化日志.md` 的 `2026-07-19` 下记录修改文件、交互规则、测试结果，并注明仅前端修改、无需数据库迁移和后端重启。

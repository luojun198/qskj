# Government Accounts Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current built-in chart of accounts with the 2023 government accounting chart from the provided document, then force-rebuild the current account set and verify `/base/account` shows the full corrected hierarchy.

**Architecture:** Keep `server/src/scripts/seedAccounts.ts` as the single source of truth for standard accounts, but rewrite its account template data to match the approved 2023 document and add targeted validation helpers around rebuild safety checks. Reuse the existing initialization and rebuild entry points so first-run initialization and manual rebuild stay aligned, then verify both database state and the existing Vue tree table with the rebuilt data.

**Tech Stack:** Node.js, TypeScript, Express, SQLite, Vue 3, Vite, Element Plus.

---

## File Structure

- Modify: `server/src/scripts/seedAccounts.ts` — replace the outdated account template data with the approved 2023 financial + budget chart, keep insertion logic as the canonical seed path, and add small helpers for template validation if needed.
- Modify: `server/src/scripts/verifyAccounts.ts` — update verification output so it checks the rebuilt chart against the new key account expectations instead of the old structure.
- Modify: `server/src/scripts/rebuildAccounts.ts` — add pre-rebuild visibility into dependent data counts before deletion so the destructive action is explicit in logs.
- Modify: `client/src/views/base/Account.vue` — only if the rebuilt hierarchy exposes display or tree-state issues in `/base/account`.
- Reference: `2023年最新版政府会计准则制度（科目表+自动结转模板）.md` — source of truth for codes, names, directions, and the requirement to include classes 1-8.

### Task 1: Rewrite the standard account template to the approved 2023 chart

**Files:**
- Modify: `server/src/scripts/seedAccounts.ts`
- Reference: `2023年最新版政府会计准则制度（科目表+自动结转模板）.md`
- Test: `server/src/scripts/verifyAccounts.ts`

- [ ] **Step 1: Write the failing verification assertions for the corrected key accounts**

Update `server/src/scripts/verifyAccounts.ts` so it fails until the seed data is corrected. Replace the current loose summary-only output with explicit checks like this:

```ts
const requiredAccounts = [
  ['1001', '库存现金', 'debit'],
  ['1002', '银行存款', 'debit'],
  ['1011', '零余额账户用款额度', 'debit'],
  ['1021', '其他货币资金', 'debit'],
  ['1201', '财政应返还额度', 'debit'],
  ['1811', '政府储备物资', 'debit'],
  ['1821', '文物资源', 'debit'],
  ['3301', '本期盈余', 'credit'],
  ['6001', '财政拨款预算收入', 'credit'],
  ['8101', '财政拨款结转', 'credit'],
]

for (const [code, expectedName, expectedDirection] of requiredAccounts) {
  const row = accounts.find(account => account.code === code)
  if (!row) {
    throw new Error(`missing required account ${code}`)
  }
  if (row.name !== expectedName) {
    throw new Error(`account ${code} expected name ${expectedName} but got ${row.name}`)
  }
  if (row.direction !== expectedDirection) {
    throw new Error(
      `account ${code} expected direction ${expectedDirection} but got ${row.direction}`
    )
  }
}
```

Also add explicit guards so the old wrong codes fail fast:

```ts
if (accounts.some(account => account.code === '1012' && account.name === '其他货币资金')) {
  throw new Error('old account code 1012 for 其他货币资金 still exists')
}
```

- [ ] **Step 2: Run the verification script to confirm it fails against the old seed data**

Run: `npm run tsx --workspace=server src/scripts/verifyAccounts.ts`
Expected: FAIL with one of the new assertions, such as `missing required account 1201` or `old account code 1012 for 其他货币资金 still exists`.

- [ ] **Step 3: Replace the outdated `ACCOUNT_TEMPLATES` entries with the approved chart data**

Edit `server/src/scripts/seedAccounts.ts` so the template data reflects the approved document for classes 1-8. The replacement should follow the existing tuple format:

```ts
['1001', '库存现金', 'debit', 1, 1],
['1002', '银行存款', 'debit', 1, 0, 1],
['1011', '零余额账户用款额度', 'debit', 1],
['1021', '其他货币资金', 'debit', 1],
['1101', '短期投资', 'debit', 1],
['1201', '财政应返还额度', 'debit', 1],
['1211', '应收票据', 'debit', 1],
['1212', '应收账款', 'debit', 1, 0, 0, 1, 'supplier'],
['1214', '预付账款', 'debit', 1, 0, 0, 1, 'supplier'],
['1215', '应收股利', 'debit', 1],
['1216', '应收利息', 'debit', 1],
['1218', '其他应收款', 'debit', 1, 0, 0, 1, 'person'],
['1219', '坏账准备', 'credit', 1],
```

Continue this replacement through all required classes so the top-level chart matches the document for liabilities, net assets, financial income/expense, budget income/expense, and budget balances. Include the approved corrected top-level codes and names such as:

```ts
['1811', '政府储备物资', 'debit', 1],
['1821', '文物资源', 'debit', 1],
['1831', '保障性住房', 'debit', 1],
['1891', '受托代理资产', 'debit', 1],
['1901', '长期待摊费用', 'debit', 1],
['1902', '待处理财产损溢', 'debit', 1],
['2001', '短期借款', 'credit', 1],
['2101', '应交增值税', 'credit', 1],
['2102', '其他应交税费', 'credit', 1],
['2103', '应缴财政款', 'credit', 1],
['2201', '应付职工薪酬', 'credit', 1, 0, 0, 1, 'dept'],
['2301', '应付票据', 'credit', 1],
['2302', '应付账款', 'credit', 1, 0, 0, 1, 'supplier'],
['2303', '应付政府补贴款', 'credit', 1],
['2304', '应付利息', 'credit', 1],
['2305', '预收账款', 'credit', 1],
['2307', '其他应付款', 'credit', 1, 0, 0, 1, 'person'],
['2502', '应付长期政府债券', 'credit', 1],
['3302', '本年盈余分配', 'credit', 1],
['3401', '无偿调拨净资产', 'credit', 1],
['3501', '以前年度盈余调整', 'credit', 1],
['4001', '财政拨款收入', 'credit', 1, 0, 0, 1, 'dept'],
['4601', '非同级财政拨款收入', 'credit', 1],
['4602', '投资收益', 'credit', 1],
['4603', '捐赠收入', 'credit', 1],
['4604', '利息收入', 'credit', 1],
['4605', '租金收入', 'credit', 1],
['4609', '其他收入', 'credit', 1],
['5001', '业务活动费用', 'debit', 1, 0, 0, 1, 'dept'],
['5101', '单位管理费用', 'debit', 1, 0, 0, 1, 'dept'],
['5201', '经营费用', 'debit', 1, 0, 0, 1, 'project'],
['5301', '资产处置费用', 'debit', 1],
['5401', '上缴上级费用', 'debit', 1],
['5501', '对附属单位补助费用', 'debit', 1],
['5801', '所得税费用', 'debit', 1],
['5901', '其他费用', 'debit', 1],
['6001', '财政拨款预算收入', 'credit', 1],
['6101', '事业预算收入', 'credit', 1],
['6201', '上级补助预算收入', 'credit', 1],
['6301', '附属单位上缴预算收入', 'credit', 1],
['6401', '经营预算收入', 'credit', 1],
['6501', '债务预算收入', 'credit', 1],
['6601', '非同级财政拨款预算收入', 'credit', 1],
['6602', '投资预算收益', 'credit', 1],
['6609', '其他预算收入', 'credit', 1],
['7101', '行政支出', 'debit', 1],
['7201', '事业支出', 'debit', 1],
['7301', '经营支出', 'debit', 1],
['7401', '上缴上级支出', 'debit', 1],
['7501', '对附属单位补助支出', 'debit', 1],
['7601', '债务还本支出', 'debit', 1],
['7701', '其他支出', 'debit', 1],
['8001', '资金结存', 'debit', 1],
['8101', '财政拨款结转', 'credit', 1],
['8102', '财政拨款结余', 'credit', 1],
['8201', '非财政拨款结转', 'credit', 1],
['8202', '非财政拨款结余', 'credit', 1],
['8301', '专用结余', 'credit', 1],
['8401', '经营结余', 'credit', 1],
['8501', '其他结余', 'credit', 1],
['8701', '非财政拨款结余分配', 'credit', 1],
```

Use the document as the source of truth for any first-level code/name pair not shown above. Remove or rename legacy entries that conflict with the approved list.

- [ ] **Step 4: Keep insertion logic compatible with the rebuilt template shape**

If the rewritten template remains top-level only, leave `findParentCode()` and `insertAccounts()` unchanged. If you retain selected second-level rows, make sure the tuple shape still matches this destructuring in `server/src/scripts/seedAccounts.ts`:

```ts
const [code, name, direction, level, isCash = 0, isBank = 0, isAux = 0, auxType = null] = item
```

Do not introduce a new template format unless you also update every consumer in the same task.

- [ ] **Step 5: Run the verification script to confirm the corrected template passes**

Run: `npm run tsx --workspace=server src/scripts/verifyAccounts.ts`
Expected: PASS and prints summary output for the rebuilt chart without throwing.

- [ ] **Step 6: Commit the template rewrite**

```bash
git add server/src/scripts/seedAccounts.ts server/src/scripts/verifyAccounts.ts
git commit -m "feat: align standard government accounts with 2023 chart"
```

### Task 2: Make the rebuild path explicit about destructive impact and dependent data

**Files:**
- Modify: `server/src/scripts/rebuildAccounts.ts`
- Reference: `server/src/db/schema.sql`
- Test: `server/src/scripts/rebuildAccounts.ts`

- [ ] **Step 1: Add a pre-rebuild dependency summary query**

In `server/src/scripts/rebuildAccounts.ts`, before calling `rebuildAccounts(accountSet.id)`, add explicit counts for dependent records:

```ts
const voucherEntryCount = (
  db.prepare('SELECT COUNT(*) as c FROM voucher_entries WHERE account_set_id=?').get(accountSet.id) as any
).c
const initBalanceCount = (
  db.prepare('SELECT COUNT(*) as c FROM init_balances WHERE account_set_id=?').get(accountSet.id) as any
).c

console.log(`关联凭证分录数量: ${voucherEntryCount}`)
console.log(`关联期初余额数量: ${initBalanceCount}`)
console.log('即将删除当前账套全部科目并按 2023 文档重建')
```

- [ ] **Step 2: Keep the destructive rebuild operation unchanged**

Leave the actual destructive logic in `server/src/scripts/seedAccounts.ts` as-is so the script still performs a full delete and reinsert:

```ts
export function rebuildAccounts(accountSetId: string): number {
  const db = getDb()
  db.prepare('DELETE FROM accounts WHERE account_set_id=?').run(accountSetId)
  return insertAccounts(accountSetId)
}
```

This preserves the approved “force rebuild” behavior.

- [ ] **Step 3: Run the rebuild script and capture the actual rebuild result**

Run: `npm run tsx --workspace=server src/scripts/rebuildAccounts.ts`
Expected: output includes the current account set, dependent record counts, the pre-rebuild account count, and a successful post-rebuild account count.

- [ ] **Step 4: Commit the rebuild logging change**

```bash
git add server/src/scripts/rebuildAccounts.ts
git commit -m "chore: log account rebuild dependencies"
```

### Task 3: Re-verify the rebuilt database state from the script layer

**Files:**
- Modify: `server/src/scripts/verifyAccounts.ts` (only if verification reveals a missing check)
- Test: `server/src/scripts/verifyAccounts.ts`

- [ ] **Step 1: Add explicit coverage for class presence across 1-8**

Extend `server/src/scripts/verifyAccounts.ts` with a small coverage check that confirms at least one account exists for each required prefix class:

```ts
for (const prefix of ['1', '2', '3', '4', '5', '6', '7', '8']) {
  if (!accounts.some(account => account.code.startsWith(prefix))) {
    throw new Error(`missing account class ${prefix}`)
  }
}
```

- [ ] **Step 2: Run verification after the rebuild**

Run: `npm run tsx --workspace=server src/scripts/verifyAccounts.ts`
Expected: PASS with no thrown error.

- [ ] **Step 3: Commit the post-rebuild verification improvement**

```bash
git add server/src/scripts/verifyAccounts.ts
git commit -m "test: verify all government account classes exist"
```

### Task 4: Verify the account page behavior against the rebuilt chart

**Files:**
- Modify: `client/src/views/base/Account.vue` (only if needed)
- Test: `client/src/views/base/Account.vue`

- [ ] **Step 1: Reuse or start the client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Open the account page and verify the rebuilt hierarchy renders**

Navigate to: `http://localhost:5175/base/account`
Manual check:
- The page loads without a client error
- The tree table shows rebuilt accounts instead of an empty list
- Search still filters rows
- Expanding rows does not break selection or rendering

- [ ] **Step 3: Verify the key accounts appear with corrected codes and names**

Manual check on `/base/account`:
- Search `1021` and confirm it is `其他货币资金`
- Search `1811` and confirm it is `政府储备物资`
- Search `1821` and confirm it is `文物资源`
- Search `6001` and confirm it is `财政拨款预算收入`
- Search `8101` and confirm it is `财政拨款结转`

- [ ] **Step 4: Fix the page only if the rebuilt data exposes a rendering defect**

If the tree breaks because of rebuilt data shape, make the minimal fix in `client/src/views/base/Account.vue`. For example, keep the tree conversion focused on valid rows only:

```ts
for (const item of list.value) {
  if (!item?.id || seen.has(item.id)) continue
  seen.add(item.id)
  map[item.id] = { ...item, children: [] }
}
```

Do not change unrelated UI behavior.

- [ ] **Step 5: Run the client build after any page change**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 6: Commit the page verification fix only if one was required**

```bash
git add client/src/views/base/Account.vue
git commit -m "fix: keep account tree stable after chart rebuild"
```

Skip this commit if no client file changed.

## Self-review

- **Spec coverage:** The plan covers the single-source template rewrite, keeps the existing init/rebuild entry points, adds explicit destructive rebuild visibility, updates verification, and includes `/base/account` manual validation.
- **Placeholder scan:** No TODO/TBD placeholders remain; every code-modifying step includes concrete code or an exact required data shape, and every verification step includes an explicit command or manual check.
- **Type consistency:** The plan keeps the existing `AccountDef` tuple shape, `insertAccounts()` flow, `rebuildAccounts()` entry point, and `/base/account` tree rendering path consistent across all tasks.

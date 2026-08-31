# Voucher Audit Batch Unpost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom-level “批量反过账” action on `/voucher/audit` so users can unpost multiple posted vouchers in one flow using the existing single-voucher unpost backend.

**Architecture:** Keep the current frontend-only batch orchestration pattern already used by `batchPost()` in `client/src/views/voucher/Audit.vue`. Do not add a backend batch-unpost route. Instead, add a batch-unpost button, filter `selected` down to `posted` vouchers only, confirm once, then reuse the existing `POST /voucher/vouchers/:id/unpost` flow through a silent-capable `unPost()` helper to avoid repeated toast spam during bulk execution.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus `ElMessage`/`ElMessageBox`, existing Axios request wrapper, existing Express single-unpost route.

---

### Task 1: Lock the existing unpost behavior and silent-mode API in the audit page

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add loading state for batch unpost**

Extend the page state near the existing `batchPosting` ref.

```ts
const batchPosting = ref(false)
const batchUnposting = ref(false)
```

- [ ] **Step 2: Refactor `unPost()` to support optional silent mode and optional confirm prompt**

Replace the current `unPost()` implementation with a reusable helper that can be used by both row action and batch action.

```ts
async function unPost(
  row: any,
  options?: { silent?: boolean; skipConfirm?: boolean }
) {
  const voucherId = row._voucherId || row.id
  if (!options?.skipConfirm) {
    await ElMessageBox.confirm('确认反过账?', '提示')
  }
  await request.post(`/voucher/vouchers/${voucherId}/unpost`)
  if (!options?.silent) {
    ElMessage.success('反过账成功')
  }
  fetchData()
}
```

- [ ] **Step 3: Run the client build to verify the helper refactor compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the helper refactor**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "refactor: make voucher unpost reusable for batch flow"
```

### Task 2: Add the bottom “批量反过账” action and voucher filtering

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add the new bottom action button beside batch post**

Update the bottom action area so the new button sits next to “批量过账”.

```vue
<div style="margin-top: 12px">
  <el-button type="success" :disabled="!selected.length" @click="batchAudit">批量审核</el-button>
  <el-button type="primary" :disabled="!selected.length" :loading="batchPosting" @click="batchPost">批量过账</el-button>
  <el-button type="warning" :disabled="!selected.length" :loading="batchUnposting" @click="batchUnpost">
    批量反过账
  </el-button>
  <span style="margin-left: 12px; color: #909399">已选 {{ selected.length }} 张</span>
</div>
```

- [ ] **Step 2: Add batch-unpost candidate filtering and empty-selection feedback**

Create a dedicated `batchUnpost()` function that mirrors the structure of `batchPost()` but only targets posted vouchers.

```ts
async function batchUnpost() {
  const unpostableVouchers = selected.value.filter(r => r.status === 'posted')

  if (!unpostableVouchers.length) {
    ElMessage.error('当前所选凭证中没有可反过账的凭证')
    return
  }

  // confirm + execute will be added in the next task
}
```

- [ ] **Step 3: Run the client build to verify the new button and filter logic compile**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the UI entry and filter scaffold**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "feat: add voucher audit batch unpost entry"
```

### Task 3: Implement the confirmed batch-unpost execution flow

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add one-shot confirmation for the batch action**

Extend `batchUnpost()` with a single confirmation dialog before any API calls.

```ts
await ElMessageBox.confirm(
  `当前选中 ${unpostableVouchers.length} 张已过账凭证，是否确认批量反过账？`,
  '二次确认',
  { type: 'warning', confirmButtonText: '确认反过账', cancelButtonText: '取消' }
)
```

- [ ] **Step 2: Execute unpost sequentially using silent mode**

Finish `batchUnpost()` by reusing the single-record helper without repeated confirms or repeated success toasts.

```ts
async function batchUnpost() {
  const unpostableVouchers = selected.value.filter(r => r.status === 'posted')

  if (!unpostableVouchers.length) {
    ElMessage.error('当前所选凭证中没有可反过账的凭证')
    return
  }

  await ElMessageBox.confirm(
    `当前选中 ${unpostableVouchers.length} 张已过账凭证，是否确认批量反过账？`,
    '二次确认',
    { type: 'warning', confirmButtonText: '确认反过账', cancelButtonText: '取消' }
  )

  batchUnposting.value = true
  try {
    for (const r of unpostableVouchers) {
      await unPost(r, { silent: true, skipConfirm: true })
    }
    ElMessage.success(`批量反过账成功，共反过账 ${unpostableVouchers.length} 张凭证`)
    selected.value = []
    await fetchData()
  } finally {
    batchUnposting.value = false
  }
}
```

- [ ] **Step 3: Keep the row-level action unchanged for users**

Leave the row action binding as-is so it still uses the same helper with the default interactive behavior.

```vue
<el-button
  v-if="row.status === 'posted'"
  link
  type="warning"
  size="small"
  @click="unPost(row)"
>
  反过账
</el-button>
```

- [ ] **Step 4: Run the client build to verify the full batch-unpost flow compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 5: Commit the batch-unpost flow**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "feat: support batch voucher unpost from audit page"
```

### Task 4: Manually verify the batch-unpost behavior in the browser

**Files:**
- Modify: `client/src/views/voucher/Audit.vue` (only if manual verification reveals a defect)
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Start or reuse the local client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Verify only posted vouchers are processed by the new batch action**

Navigate to: `http://localhost:5175/voucher/audit`
Manual check:
- Select one or more `posted` vouchers
- Click `批量反过账`
- Confirm the one-shot dialog appears with the correct count
- Confirm the vouchers are unposted after execution
- Confirm a success message appears: `批量反过账成功，共反过账 X 张凭证`

- [ ] **Step 3: Verify mixed selection only unposts posted vouchers**

Manual check:
- Select a mixture of `posted` and non-`posted` vouchers
- Click `批量反过账`
- Confirm the dialog count matches only the posted vouchers
- Confirm non-posted vouchers are left untouched

- [ ] **Step 4: Verify empty eligible selection shows explicit feedback**

Manual check:
- Select only non-posted vouchers
- Click `批量反过账`
- Confirm an error toast appears: `当前所选凭证中没有可反过账的凭证`

- [ ] **Step 5: Verify the single-row unpost action still behaves the same**

Manual check:
- Click a row-level `反过账`
- Confirm the original single-record confirmation still appears
- Confirm a single-record success toast still appears

- [ ] **Step 6: Re-run the client build after any final tweaks**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 7: Commit the final verified UX change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: add batch voucher unpost workflow"
```

## Self-review

- **Spec coverage:** The plan covers the approved scope: add only a bottom batch-unpost button, reuse existing single-unpost backend behavior, confirm once, process only posted vouchers, and preserve the existing single-row flow.
- **Placeholder scan:** No placeholders remain; each modification step includes concrete code, each verification step includes an exact command or manual procedure, and no step relies on vague follow-up work.
- **Type consistency:** The plan consistently uses `batchUnposting`, `batchUnpost()`, `unpostableVouchers`, and the `unPost(row, { silent, skipConfirm })` helper signature across all tasks.

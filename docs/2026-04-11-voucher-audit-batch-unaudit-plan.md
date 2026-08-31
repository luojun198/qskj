# Voucher Audit Batch Unaudit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bottom-level “批量反审核” action immediately after “批量审核” on `/voucher/audit` so users can unaudit multiple audited vouchers in one flow using the existing single-voucher unaudit backend.

**Architecture:** Keep the existing frontend orchestration pattern used by `batchPost()` and `batchUnpost()` in `client/src/views/voucher/Audit.vue`. Do not add a backend batch-unaudit route. Instead, add a batch-unaudit button in the bottom action row, filter `selected` down to `audited` vouchers only, confirm once, then reuse the existing `POST /voucher/vouchers/:id/unaudit` flow through a silent-capable `unAudit()` helper to avoid repeated success toasts during bulk execution.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus `ElMessage`/`ElMessageBox`, existing Axios request wrapper, existing Express single-unaudit route.

---

### Task 1: Refactor single-record unaudit for batch reuse

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add loading state for batch unaudit**

Extend the page state near the existing batch action refs.

```ts
const batchPosting = ref(false)
const batchUnposting = ref(false)
const batchUnauditing = ref(false)
```

- [ ] **Step 2: Refactor `unAudit()` to support silent mode and optional confirm prompt**

Replace the current `unAudit()` implementation with a reusable helper for both row action and batch action.

```ts
async function unAudit(
  row: any,
  options?: { silent?: boolean; skipConfirm?: boolean }
) {
  const voucherId = row._voucherId || row.id
  if (!options?.skipConfirm) {
    await ElMessageBox.confirm('确认反审核?', '提示')
  }
  await request.post(`/voucher/vouchers/${voucherId}/unaudit`)
  if (!options?.silent) {
    ElMessage.success('反审核成功')
  }
  fetchData()
}
```

- [ ] **Step 3: Keep the existing row action binding unchanged**

Leave the row action template using the same helper with default interactive behavior.

```vue
<el-button
  v-if="row.status === 'audited'"
  link
  type="warning"
  size="small"
  @click="unAudit(row)"
>
  反审核
</el-button>
```

- [ ] **Step 4: Run the client build to verify the helper refactor compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 5: Commit the helper refactor**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "refactor: make voucher unaudit reusable for batch flow"
```

### Task 2: Add the bottom “批量反审核” button after “批量审核”

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Insert the new button in the required position**

Update the bottom action row so the order becomes: 批量审核 → 批量反审核 → 批量过账 → 批量反过账.

```vue
<div style="margin-top: 12px">
  <el-button type="success" :disabled="!selected.length" @click="batchAudit">批量审核</el-button>
  <el-button type="warning" :disabled="!selected.length" :loading="batchUnauditing" @click="batchUnAudit">
    批量反审核
  </el-button>
  <el-button type="primary" :disabled="!selected.length" :loading="batchPosting" @click="batchPost">批量过账</el-button>
  <el-button type="warning" :disabled="!selected.length" :loading="batchUnposting" @click="batchUnpost">
    批量反过账
  </el-button>
  <span style="margin-left: 12px; color: #909399">已选 {{ selected.length }} 张</span>
</div>
```

- [ ] **Step 2: Add audited-only candidate filtering and empty-selection feedback**

Create a dedicated `batchUnAudit()` function scaffold that only targets audited vouchers.

```ts
async function batchUnAudit() {
  const unauditableVouchers = selected.value.filter(r => r.status === 'audited')

  if (!unauditableVouchers.length) {
    ElMessage.error('当前所选凭证中没有可反审核的凭证')
    return
  }

  // confirm + execute will be added in the next task
}
```

- [ ] **Step 3: Run the client build to verify the new button and filter scaffold compile**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the UI entry and filter scaffold**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "feat: add voucher audit batch unaudit entry"
```

### Task 3: Implement the confirmed batch-unaudit execution flow

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add one-shot confirmation for batch unaudit**

Extend `batchUnAudit()` with a single confirmation dialog before any API calls.

```ts
await ElMessageBox.confirm(
  `当前选中 ${unauditableVouchers.length} 张已审核凭证，是否确认批量反审核？`,
  '二次确认',
  { type: 'warning', confirmButtonText: '确认反审核', cancelButtonText: '取消' }
)
```

- [ ] **Step 2: Execute unaudit sequentially using silent mode**

Finish `batchUnAudit()` by reusing the single-record helper without repeated confirms or repeated success toasts.

```ts
async function batchUnAudit() {
  const unauditableVouchers = selected.value.filter(r => r.status === 'audited')

  if (!unauditableVouchers.length) {
    ElMessage.error('当前所选凭证中没有可反审核的凭证')
    return
  }

  await ElMessageBox.confirm(
    `当前选中 ${unauditableVouchers.length} 张已审核凭证，是否确认批量反审核？`,
    '二次确认',
    { type: 'warning', confirmButtonText: '确认反审核', cancelButtonText: '取消' }
  )

  batchUnauditing.value = true
  try {
    for (const r of unauditableVouchers) {
      await unAudit(r, { silent: true, skipConfirm: true })
    }
    ElMessage.success(`批量反审核成功，共反审核 ${unauditableVouchers.length} 张凭证`)
    selected.value = []
    await fetchData()
  } finally {
    batchUnauditing.value = false
  }
}
```

- [ ] **Step 3: Run the client build to verify the full batch-unaudit flow compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the batch-unaudit flow**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "feat: support batch voucher unaudit from audit page"
```

### Task 4: Manually verify batch unaudit in the browser

**Files:**
- Modify: `client/src/views/voucher/Audit.vue` (only if manual verification reveals a defect)
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Start or reuse the local client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Verify audited vouchers can be batch-unaudited**

Navigate to: `http://localhost:5175/voucher/audit`
Manual check:
- Select one or more `audited` vouchers
- Click `批量反审核`
- Confirm the one-shot dialog appears with the correct count
- Confirm the vouchers become unaudited after execution
- Confirm a success message appears: `批量反审核成功，共反审核 X 张凭证`

- [ ] **Step 3: Verify mixed selection only processes audited vouchers**

Manual check:
- Select a mixture of `audited`, `draft`, and `posted` vouchers
- Click `批量反审核`
- Confirm the dialog count matches only the audited vouchers
- Confirm non-audited vouchers are left untouched

- [ ] **Step 4: Verify empty eligible selection shows explicit feedback**

Manual check:
- Select only non-audited vouchers
- Click `批量反审核`
- Confirm an error toast appears: `当前所选凭证中没有可反审核的凭证`

- [ ] **Step 5: Verify single-row unaudit still behaves normally**

Manual check:
- Click a row-level `反审核`
- Confirm the single-record confirmation still appears
- Confirm the single-record success toast still appears

- [ ] **Step 6: Re-run the client build after any final tweaks**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 7: Commit the final verified UX change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: add batch voucher unaudit workflow"
```

## Self-review

- **Spec coverage:** The plan covers the approved scope: add only a bottom batch-unaudit button placed immediately after batch audit, reuse existing single-unaudit backend behavior, confirm once, process only audited vouchers, and preserve the single-row unaudit flow.
- **Placeholder scan:** No placeholders remain; each step contains either concrete code or a precise verification procedure.
- **Type consistency:** The plan consistently uses `batchUnauditing`, `batchUnAudit()`, `unauditableVouchers`, and `unAudit(row, { silent, skipConfirm })` across all tasks.

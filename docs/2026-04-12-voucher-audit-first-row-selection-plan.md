# Voucher Audit First-Row Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `/voucher/audit` so only the first detail row of each voucher shows a selection checkbox while preserving the current expanded detail-row layout and voucher-level batch actions.

**Architecture:** Keep the existing flattened `flatList` rendering in `client/src/views/voucher/Audit.vue`, but annotate each rendered row with a first-row marker. Use Element Plus `el-table-column`’s `selectable` callback to allow selection only on rows marked as the first detail row of a voucher. Leave the existing `onSelect()` voucher-merging logic in place so selected state and batch actions continue to operate by voucher rather than by detail row.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus `el-table`, existing Axios-backed voucher list flow.

---

### Task 1: Mark the first detail row in the flattened audit list

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add first-row metadata to rows created from voucher entries**

Update the `flatList` computed block so each rendered row knows whether it is the first detail row of its voucher.

```ts
const flatList = computed(() => {
  const rows: any[] = []
  for (const [index, v] of list.value.entries()) {
    const seq = getVoucherSeq(v.voucher_no)
    const abbr = getTypeAbbr(v.voucher_type_name || '记')
    const voucherLabel = `${abbr}-${seq}`
    if (v.entries?.length) {
      for (const [entryIndex, e] of v.entries.entries()) {
        rows.push({
          ...v,
          ...e,
          voucher_no: voucherLabel,
          summary: e.summary || v.remark || '',
          _voucherId: v.id,
          _stripeGroup: index % 2,
          _isFirstEntryRow: entryIndex === 0,
        })
      }
    } else {
      rows.push({
        ...v,
        voucher_no: voucherLabel,
        summary: v.remark || '',
        _voucherId: v.id,
        _stripeGroup: index % 2,
        _isFirstEntryRow: true,
      })
    }
  }
  return rows
})
```

- [ ] **Step 2: Run the client build to verify the metadata change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 3: Commit the row-metadata change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "refactor: mark first voucher detail row in audit list"
```

### Task 2: Restrict the checkbox to first detail rows only

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add a selection predicate helper in `<script setup>`**

Create a focused helper that returns true only for the first row of each voucher.

```ts
function isSelectableRow(row: any) {
  return row._isFirstEntryRow === true
}
```

- [ ] **Step 2: Wire the selection column to the first-row-only predicate**

Update the selection column in the table template.

```vue
<el-table :data="flatList" border :row-class-name="getRowClass" @selection-change="onSelect">
  <el-table-column type="selection" width="40" :selectable="isSelectableRow" />
```

This keeps the current layout intact while leaving non-first rows with no usable checkbox.

- [ ] **Step 3: Keep voucher-level selection merging unchanged**

Do not change the existing `onSelect()` logic; keep the voucher-level merge behavior exactly as-is.

```ts
function onSelect(rows: any[]) {
  const voucherStatusMap = new Map(list.value.map(v => [v.id, v.status]))
  const map = new Map<string, any>()
  for (const row of rows) {
    const voucherId = row._voucherId || row.id
    if (!map.has(voucherId)) {
      map.set(voucherId, {
        ...row,
        id: voucherId,
        status: voucherStatusMap.get(voucherId) ?? row.status,
      })
    }
  }
  selected.value = Array.from(map.values())
}
```

- [ ] **Step 4: Run the client build to verify the selection restriction compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 5: Commit the first-row-only checkbox behavior**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: show audit selection checkbox only on first detail row"
```

### Task 3: Manually verify selection UX in the browser

**Files:**
- Modify: `client/src/views/voucher/Audit.vue` (only if manual verification reveals a defect)
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Start or reuse the local client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Verify only first detail rows show a checkbox**

Navigate to: `http://localhost:5175/voucher/audit`
Manual check:
- Find a voucher with multiple detail rows
- Confirm only the first row has a usable selection checkbox
- Confirm all later detail rows in the same voucher do not present a usable checkbox

- [ ] **Step 3: Verify voucher selection still works for batch actions**

Manual check:
- Select the first-row checkbox of a multi-detail voucher
- Confirm `已选 X 张` increases by 1
- Confirm batch buttons become enabled
- Confirm the selected voucher still participates normally in batch actions

- [ ] **Step 4: Verify single-detail vouchers still behave normally**

Manual check:
- Find a voucher rendered as a single row
- Confirm its row still shows a checkbox and can be selected normally

- [ ] **Step 5: Re-run the client build after any final tweaks**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 6: Commit the final verified UX fix**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: limit voucher audit selection to first detail row"
```

## Self-review

- **Spec coverage:** The plan implements the approved scope exactly: keep the expanded detail layout and change selection so only the first detail row shows a checkbox.
- **Placeholder scan:** No placeholders remain; every modification step includes exact code and every verification step includes a concrete command or manual check.
- **Type consistency:** The plan consistently uses `_isFirstEntryRow` and `isSelectableRow()` across the computed rows, template, and verification steps.

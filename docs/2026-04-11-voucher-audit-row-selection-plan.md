# Voucher Audit Row-Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep voucher detail rows expanded on `/voucher/audit` while making selection clearly voucher-level: only the first row of each voucher shows a checkbox, and clicking any row toggles selection for the whole voucher.

**Architecture:** Reuse the existing flattened `flatList` table in `client/src/views/voucher/Audit.vue`, but annotate each flattened row with voucher-level metadata (`_voucherId`, `_isVoucherFirstRow`, `_voucherRowCount`). Keep Element Plus selection column instead of replacing it. Add `tableRef`, `selectable`, and `row-click` handling so row interaction always maps back to the voucher’s first row and the existing `selected` state remains voucher-based.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus `el-table`, existing Axios request wrapper.

---

### Task 1: Mark first rows in the flattened audit table

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add voucher-row metadata to the flattened rows**

Update `flatList` so each generated row includes whether it is the first row of the voucher and how many detail rows belong to that voucher.

```ts
const flatList = computed(() => {
  const rows: any[] = []
  for (const [index, v] of list.value.entries()) {
    const seq = getVoucherSeq(v.voucher_no)
    const abbr = getTypeAbbr(v.voucher_type_name || '记')
    const voucherLabel = `${abbr}-${seq}`
    const entryCount = v.entries?.length || 1

    if (v.entries?.length) {
      v.entries.forEach((e: any, entryIndex: number) => {
        rows.push({
          ...v,
          ...e,
          voucher_no: voucherLabel,
          summary: e.summary || v.remark || '',
          _voucherId: v.id,
          _stripeGroup: index % 2,
          _isVoucherFirstRow: entryIndex === 0,
          _voucherRowCount: entryCount,
        })
      })
    } else {
      rows.push({
        ...v,
        voucher_no: voucherLabel,
        summary: v.remark || '',
        _voucherId: v.id,
        _stripeGroup: index % 2,
        _isVoucherFirstRow: true,
        _voucherRowCount: 1,
      })
    }
  }
  return rows
})
```

- [ ] **Step 2: Run the client build to verify the metadata change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 3: Commit the metadata-only change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "refactor: annotate voucher audit rows for selection"
```

### Task 2: Restrict checkbox rendering to voucher first rows

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add a table ref and first-row-only selection predicate**

In `<script setup>`, add a ref for the table instance and a helper for Element Plus selection gating.

```ts
const tableRef = ref()

function isVoucherSelectable(row: any) {
  return Boolean(row._isVoucherFirstRow)
}
```

- [ ] **Step 2: Wire the selection column to first-row-only behavior**

Update the table and selection column in the template.

```vue
<el-table
  ref="tableRef"
  :data="flatList"
  border
  :row-class-name="getRowClass"
  @selection-change="onSelect"
  @row-click="handleRowClick"
>
  <el-table-column type="selection" width="40" :selectable="isVoucherSelectable" />
```

This preserves the Element Plus checkbox column but disables the checkbox for non-first rows, which leaves those cells empty.

- [ ] **Step 3: Run the client build to verify the selection-column change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the selection-column restriction**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: show voucher audit checkbox only on first detail row"
```

### Task 3: Make clicking any row toggle the whole voucher

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add helpers to locate the first row and current selection state for a voucher**

Add focused helpers so row-click logic stays readable.

```ts
function getVoucherFirstRow(voucherId: string) {
  return flatList.value.find(row => row._voucherId === voucherId && row._isVoucherFirstRow)
}

function isVoucherSelected(voucherId: string) {
  return selected.value.some(row => row.id === voucherId)
}
```

- [ ] **Step 2: Add row-click handler that toggles the voucher via the first row**

Use Element Plus `toggleRowSelection` against the first row only.

```ts
function handleRowClick(row: any, _column: any, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('.el-button') || target?.closest('.el-checkbox')) {
    return
  }

  const voucherId = row._voucherId || row.id
  const firstRow = getVoucherFirstRow(voucherId)
  if (!firstRow || !tableRef.value) {
    return
  }

  tableRef.value.toggleRowSelection(firstRow, !isVoucherSelected(voucherId))
}
```

This keeps row-click fast while avoiding interference with action buttons and checkbox clicks.

- [ ] **Step 3: Keep `onSelect` voucher-based and leave bottom count unchanged**

Do not change the bottom `已选 {{ selected.length }} 张`; keep `onSelect` merging by `_voucherId` so the selected count remains voucher-level.

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

- [ ] **Step 4: Run the client build to verify the row-click change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 5: Commit the row-click selection behavior**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: toggle voucher selection from any audit detail row"
```

### Task 4: Manually verify voucher-level selection UX

**Files:**
- Modify: `client/src/views/voucher/Audit.vue` (only if manual verification reveals a defect)
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Start or reuse the local client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Open the audit page and verify checkbox placement**

Navigate to: `http://localhost:5175/voucher/audit`
Expected:
- Only the first row of each voucher shows a checkbox
- Subsequent detail rows have an empty selection cell
- The grouped row striping still makes each voucher block readable

- [ ] **Step 3: Verify row-click toggles voucher selection**

Manual check:
- Click a non-first detail row inside a voucher
- Confirm the voucher’s first-row checkbox becomes checked
- Confirm `已选 X 张` increments by 1, not by detail-row count
- Click another detail row of the same voucher again
- Confirm the voucher becomes unchecked and the count decreases by 1

- [ ] **Step 4: Verify action buttons still do not toggle selection**

Manual check:
- Click `查看`, `审核`, `反审核`, `过账`, or `反过账` on a row
- Confirm the action runs normally
- Confirm clicking the action button itself does not additionally toggle row selection

- [ ] **Step 5: Re-run the client build after any final tweaks**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 6: Commit the final verified UX change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: make voucher audit selection clearly voucher-level"
```

## Self-review

- **Spec coverage:** The plan covers the approved design: preserve detail expansion, show checkbox only on voucher first rows, leave non-first rows blank, and allow clicking any row to toggle whole-voucher selection.
- **Placeholder scan:** No `TODO`/`TBD` placeholders remain; each code-changing step includes concrete code and each verification step includes a command or exact manual check.
- **Type consistency:** The plan consistently uses `_voucherId`, `_isVoucherFirstRow`, `_voucherRowCount`, `tableRef`, `isVoucherSelectable`, `getVoucherFirstRow`, `isVoucherSelected`, and `handleRowClick` across all tasks.

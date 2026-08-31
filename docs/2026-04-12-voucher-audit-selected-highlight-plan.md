# Voucher Audit Selected-Voucher Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make selected vouchers on `/voucher/audit` visually obvious by applying a distinct background color to all detail rows belonging to a selected voucher.

**Architecture:** Keep the current expanded multi-row voucher layout and existing odd/even grouping classes, but extend the row-class logic in `client/src/views/voucher/Audit.vue` so a selected voucher gets an additional high-priority CSS class. Drive the selected state from the existing `selected` voucher array rather than introducing new table state, so highlighting stays aligned with current batch-action selection behavior.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Element Plus `el-table`, CSS row class styling.

---

### Task 1: Mark selected vouchers at row-class computation time

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add a helper that checks whether a voucher is selected**

Create a small helper that reuses the existing voucher-level `selected` array.

```ts
function isVoucherSelected(row: any) {
  const voucherId = row._voucherId || row.id
  return selected.value.some(item => item.id === voucherId)
}
```

- [ ] **Step 2: Extend `getRowClass()` to add a selected class**

Replace the current row-class function so it returns both the existing odd/even class and a selected marker when appropriate.

```ts
function getRowClass({ row }: { row: any }) {
  const classes = [row._stripeGroup === 0 ? 'voucher-group-even' : 'voucher-group-odd']
  if (isVoucherSelected(row)) {
    classes.push('voucher-selected')
  }
  return classes.join(' ')
}
```

- [ ] **Step 3: Run the client build to verify the row-class change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the selected-row-class logic**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "refactor: track selected vouchers in audit row classes"
```

### Task 2: Add high-priority selected voucher background styling

**Files:**
- Modify: `client/src/views/voucher/Audit.vue`
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Add a selected-voucher CSS rule that overrides odd/even striping**

Append a high-priority rule in the existing non-scoped style block.

```css
.voucher-selected td {
  background-color: #d9ecff !important;
}
```

Use a clearly visible but still soft background that distinguishes selected vouchers from the existing grey striping.

- [ ] **Step 2: Keep the existing odd/even row group colors in place for unselected vouchers**

Leave the current rules intact.

```css
.voucher-group-even td {
  background-color: #fcfcfc !important;
}
.voucher-group-odd td {
  background-color: #f5f7fa !important;
}
```

Because `.voucher-selected td` is added alongside those classes and appears after them, it will visually override them when a voucher is selected.

- [ ] **Step 3: Run the client build to verify the CSS change compiles**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 4: Commit the selected-voucher styling**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "style: highlight selected vouchers in audit table"
```

### Task 3: Manually verify selected-voucher highlighting

**Files:**
- Modify: `client/src/views/voucher/Audit.vue` (only if manual verification reveals a defect)
- Test: `npm run build --workspace=client`

- [ ] **Step 1: Start or reuse the local client dev server**

Run: `npm run dev:client`
Expected: Vite reports a local URL including `http://localhost:5175/`.

- [ ] **Step 2: Verify selected vouchers are obviously highlighted across all detail rows**

Navigate to: `http://localhost:5175/voucher/audit`
Manual check:
- Select a voucher with multiple detail rows
- Confirm all rows of that voucher switch to the selected background color
- Confirm the selected state is much easier to distinguish than before

- [ ] **Step 3: Verify unselected vouchers keep the original group striping**

Manual check:
- Look at neighboring unselected vouchers
- Confirm they still use the original odd/even backgrounds
- Confirm only selected vouchers get the blue highlight

- [ ] **Step 4: Verify deselection removes the highlight**

Manual check:
- Uncheck a selected voucher
- Confirm all of its detail rows return to the original unselected group background

- [ ] **Step 5: Re-run the client build after any final tweaks**

Run: `npm run build --workspace=client`
Expected: `✓ built` appears and the build exits with code 0.

- [ ] **Step 6: Commit the final verified highlight change**

```bash
git add client/src/views/voucher/Audit.vue
git commit -m "fix: improve selected voucher visibility in audit table"
```

## Self-review

- **Spec coverage:** The plan implements the approved design: selected vouchers are differentiated with a clear background, and the entire voucher block is highlighted rather than only the first row.
- **Placeholder scan:** No placeholders remain; every code step includes exact code and every verification step includes a concrete command or manual check.
- **Type consistency:** The plan consistently uses `isVoucherSelected`, `voucher-selected`, and the existing `selected` array across logic, styling, and verification steps.

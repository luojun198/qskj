# 角色权限批量选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在角色管理的权限编辑弹窗中增加顶部全局全选/反选，以及每个权限分组的全选/反选。

**Architecture:** 只修改前端页面 `client/src/views/system/Role.vue`，复用现有 `form.permissions` 数组作为唯一状态源。新增批量操作函数通过权限 code 列表更新数组，不改变后端接口、保存流程或权限数据结构。

**Tech Stack:** Vue 3 `<script setup>`、TypeScript、Element Plus、现有 `request` API 封装。

---

## File Structure

- Modify: `client/src/views/system/Role.vue`
  - 模板：在权限分组顶部增加全局操作条；在每个分组标题右侧增加分组操作按钮。
  - 脚本：新增 `getAllPermissionCodes`、`selectPermissionCodes`、`invertPermissionCodes`、`selectAllPermissions`、`invertAllPermissions`、`selectGroupPermissions`、`invertGroupPermissions`。
  - 样式：新增 `.perm-toolbar`、`.perm-group-actions`，并调整 `.perm-group-header` 为 flex 布局。
- Modify: `优化日志.md`
  - 记录本次前端功能调整、修改文件和验证结果。

---

### Task 1: 增加角色权限批量选择逻辑

**Files:**
- Modify: `client/src/views/system/Role.vue:111-129`

- [ ] **Step 1: 增加批量选择辅助函数**

在 `toggleGroup` 函数后、`openDialog` 函数前插入以下代码：

```ts
function getAllPermissionCodes(): string[] {
  return permissionGroups.value.flatMap(group => group.permissions.map(p => p.code))
}

function selectPermissionCodes(codes: string[]) {
  const existing = new Set(form.value.permissions)
  codes.forEach(code => existing.add(code))
  form.value.permissions = Array.from(existing)
}

function invertPermissionCodes(codes: string[]) {
  const targetCodes = new Set(codes)
  const existing = new Set(form.value.permissions)

  targetCodes.forEach(code => {
    if (existing.has(code)) {
      existing.delete(code)
    } else {
      existing.add(code)
    }
  })

  form.value.permissions = Array.from(existing)
}

function selectAllPermissions() {
  selectPermissionCodes(getAllPermissionCodes())
}

function invertAllPermissions() {
  invertPermissionCodes(getAllPermissionCodes())
}

function selectGroupPermissions(group: PermissionGroup) {
  selectPermissionCodes(group.permissions.map(p => p.code))
}

function invertGroupPermissions(group: PermissionGroup) {
  invertPermissionCodes(group.permissions.map(p => p.code))
}
```

- [ ] **Step 2: 精简现有 `toggleGroup` 的全选分支**

将 `toggleGroup` 改成：

```ts
function toggleGroup(group: PermissionGroup, checked: boolean) {
  const codes = group.permissions.map(p => p.code)
  if (checked) {
    selectPermissionCodes(codes)
  } else {
    form.value.permissions = form.value.permissions.filter((c: string) => !codes.includes(c))
  }
}
```

- [ ] **Step 3: 运行前端类型检查**

Run: `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS，输出中没有 `Role.vue` 的 TypeScript 错误。

---

### Task 2: 增加顶部和分组操作按钮

**Files:**
- Modify: `client/src/views/system/Role.vue:46-64`

- [ ] **Step 1: 替换权限配置模板块**

将现有：

```vue
          <div v-else class="perm-groups">
            <div v-for="group in permissionGroups" :key="group.module" class="perm-group">
              <div class="perm-group-header">
                <el-checkbox
                  :model-value="isGroupAllChecked(group)"
                  :indeterminate="isGroupIndeterminate(group)"
                  @change="(v: any) => toggleGroup(group, !!v)"
                >{{ group.moduleName }}</el-checkbox>
              </div>
              <div class="perm-items">
```

替换为：

```vue
          <div v-else class="perm-groups">
            <div class="perm-toolbar">
              <span>全部权限</span>
              <div class="perm-toolbar-actions">
                <el-button link type="primary" size="small" @click="selectAllPermissions">全部全选</el-button>
                <el-button link type="primary" size="small" @click="invertAllPermissions">全部反选</el-button>
              </div>
            </div>
            <div v-for="group in permissionGroups" :key="group.module" class="perm-group">
              <div class="perm-group-header">
                <el-checkbox
                  :model-value="isGroupAllChecked(group)"
                  :indeterminate="isGroupIndeterminate(group)"
                  @change="(v: any) => toggleGroup(group, !!v)"
                >{{ group.moduleName }}</el-checkbox>
                <div class="perm-group-actions">
                  <el-button link type="primary" size="small" @click="selectGroupPermissions(group)">全选</el-button>
                  <el-button link type="primary" size="small" @click="invertGroupPermissions(group)">反选</el-button>
                </div>
              </div>
              <div class="perm-items">
```

- [ ] **Step 2: 运行前端类型检查**

Run: `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS，输出中没有模板类型错误。

---

### Task 3: 调整权限区域样式

**Files:**
- Modify: `client/src/views/system/Role.vue:178-194`

- [ ] **Step 1: 在 `.perm-groups` 后新增顶部工具栏样式**

在 `.perm-groups` 规则后插入：

```css
.perm-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #f5f7fa;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  font-weight: 600;
}
.perm-toolbar-actions,
.perm-group-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 2: 替换 `.perm-group-header` 样式**

将 `.perm-group-header` 改成：

```css
.perm-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f5f7fa;
  padding: 6px 12px;
  font-weight: 600;
  border-bottom: 1px solid #e4e7ed;
}
```

- [ ] **Step 3: 运行前端类型检查**

Run: `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS。

---

### Task 4: 更新优化日志并做最终验证

**Files:**
- Modify: `优化日志.md`
- Verify: `client/src/views/system/Role.vue`

- [ ] **Step 1: 阅读优化日志现有格式**

Read: `优化日志.md`

Expected: 找到最新日期分组，按现有格式追加 2026-05-15 的本次修改记录。

- [ ] **Step 2: 追加日志内容**

在 `优化日志.md` 的 `2026-05-15` 日期分组下追加：

```markdown
### 角色权限批量选择优化

**修改文件：**
- `client/src/views/system/Role.vue`

**具体说明：**
- 在角色编辑弹窗的权限配置区域顶部新增“全部全选”和“全部反选”操作。
- 在每个权限分组标题右侧新增“全选”和“反选”操作。
- 新增权限 code 批量选择和反选辅助函数，统一通过 `form.permissions` 更新选择状态。
- 保留原分组复选框的全选、取消全选和半选状态逻辑。

**原因：**
- 编辑角色权限时需要更快捷地批量选择权限，减少逐项勾选成本。

**影响范围：**
- 仅影响系统管理中的角色权限编辑弹窗。
- 不涉及后端接口、数据库或权限保存数据结构变更。
```

- [ ] **Step 3: 运行最终类型检查**

Run: `npx vue-tsc --noEmit --noUnusedLocals --noUnusedParameters`

Expected: PASS。

- [ ] **Step 4: 手动验证清单**

打开角色管理页面并编辑任意角色，验证：

```text
1. 点击“全部全选”，所有权限复选框都被选中。
2. 点击“全部反选”，所有权限按当前状态反转。
3. 点击某个分组的“全选”，只有该分组权限被选中。
4. 点击某个分组的“反选”，只有该分组权限反转。
5. 原模块名称复选框仍能全选/清空该分组。
6. 分组部分选中时，模块名称复选框仍显示半选状态。
```

- [ ] **Step 5: 不提交代码**

本仓库当前有大量既有未提交修改。除非用户明确要求，本任务完成后不要执行 `git commit`。

---

## Self-Review

- Spec coverage: 顶部全局全选/反选由 Task 2 实现；分组全选/反选由 Task 2 实现；保留模块复选框语义由 Task 1 的 `toggleGroup` 实现；不改后端由 File Structure 和 Task 范围保证；验证由 Task 4 覆盖。
- Placeholder scan: 无 TBD、TODO、implement later 或未展开步骤。
- Type consistency: 函数名在模板和脚本中一致；`PermissionGroup`、`permissionGroups`、`form.permissions` 均来自现有 `Role.vue`。

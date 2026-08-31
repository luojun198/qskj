# 多角色与混合权限支持计划

## 概述

当前系统已支持"按角色分配"和"按用户分配"两种权限模式，但两者是互斥的（通过 `permission_mode` 字段控制）。本计划将实现：

1. **多角色支持**：用户可以同时关联多个角色
2. **混合权限模式**：用户可以同时拥有角色权限和自定义权限
3. **权限合并规则**：所有角色权限 + 自定义权限取并集

## 当前状态分析

### 数据库结构
- `users` 表有 `role_id` 字段（单角色，TEXT 类型）
- `users` 表有 `permission_mode` 字段（'role' 或 'custom'，互斥）
- `users` 表有 `custom_permissions` 字段（JSON 数组，存储自定义权限）
- `roles` 表有 `is_personal` 和 `owner_user_id` 字段（支持个人角色）

### 权限验证逻辑（`server/src/middleware/auth.ts`）
```typescript
// 当前逻辑：根据 permission_mode 二选一
if (user.permission_mode === 'custom' && user.custom_permissions) {
  permissions = JSON.parse(user.custom_permissions)
} else if (user.role_permissions) {
  permissions = JSON.parse(user.role_permissions)
}
```

### 前端界面（`client/src/views/system/User.vue`）
- 单选框：按用户分配 / 按角色分配（互斥）
- 按角色分配时显示角色下拉框（单选）
- 按用户分配时显示权限配置按钮

### 登录逻辑（`server/src/routes/auth.ts`）
- 验证用户必须有 `role_id`（第 457-465 行）
- 使用单个角色的权限

## 设计决策

### 1. 数据库设计
**创建 `user_roles` 关联表**（推荐方案）：
- 符合数据库规范化原则
- 支持多对多关系
- 易于查询和扩展
- 保留 `users.role_id` 字段用于向后兼容

```sql
CREATE TABLE user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, role_id, account_set_id)
);
```

### 2. 权限计算规则
**合并模式（并集）**：
```typescript
// 1. 获取用户所有角色的权限（从 user_roles 表）
// 2. 获取用户自定义权限（从 users.custom_permissions）
// 3. 合并去重：Set([...rolePerms1, ...rolePerms2, ...customPerms])
```

### 3. 字段变更
- **废弃** `users.permission_mode` 字段（不再需要互斥模式）
- **保留** `users.role_id` 字段（向后兼容，可作为"主角色"）
- **保留** `users.custom_permissions` 字段（存储自定义权限）
- **新增** `user_roles` 表（存储多角色关联）

### 4. 前端界面调整
- **移除**权限分配方式单选框
- **独立显示**角色选择（多选下拉框或标签选择器）
- **独立显示**自定义权限配置按钮
- 两者可以同时使用

## 实施步骤

### 步骤 1：数据库迁移
**文件**：`server/src/db/migrations/20260525_add_multi_role_support.ts`

**操作**：
1. 创建 `user_roles` 表
2. 迁移现有数据：将 `users.role_id` 迁移到 `user_roles` 表
3. 创建索引优化查询性能
4. 保留 `users.role_id` 字段（向后兼容）
5. 标记 `users.permission_mode` 为废弃（但不删除，避免破坏现有数据）

**SQL**：
```sql
-- 创建关联表
CREATE TABLE user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  account_set_id TEXT NOT NULL REFERENCES account_sets(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, role_id, account_set_id)
);

-- 迁移现有数据
INSERT INTO user_roles (id, user_id, role_id, account_set_id)
SELECT 
  lower(hex(randomblob(16))),
  id,
  role_id,
  account_set_id
FROM users
WHERE role_id IS NOT NULL;

-- 创建索引
CREATE INDEX idx_user_roles_user ON user_roles(user_id, account_set_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id, account_set_id);
```

### 步骤 2：修改权限验证中间件
**文件**：`server/src/middleware/auth.ts`

**修改点**：
1. 查询用户的所有角色（从 `user_roles` 表）
2. 查询用户的自定义权限（从 `users.custom_permissions`）
3. 合并所有权限并去重

**代码**：
```typescript
// 查询用户的所有角色权限
const userRoles = db
  .prepare(`
    SELECT r.permissions
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = ? AND ur.account_set_id = ?
  `)
  .all(payload.userId, payload.accountSetId) as Array<{ permissions: string | null }>

// 查询用户的自定义权限
const user = db
  .prepare(`
    SELECT custom_permissions
    FROM users
    WHERE id = ? AND account_set_id = ?
  `)
  .get(payload.userId, payload.accountSetId) as { custom_permissions: string | null } | undefined

// 合并所有权限
const permissionSet = new Set<string>()

// 添加角色权限
userRoles.forEach(role => {
  if (role.permissions) {
    try {
      const perms = JSON.parse(role.permissions)
      perms.forEach((p: string) => permissionSet.add(p))
    } catch {}
  }
})

// 添加自定义权限
if (user?.custom_permissions) {
  try {
    const customPerms = JSON.parse(user.custom_permissions)
    customPerms.forEach((p: string) => permissionSet.add(p))
  } catch {}
}

req.permissions = Array.from(permissionSet)
```

### 步骤 3：修改 generateToken 函数
**文件**：`server/src/middleware/auth.ts`

**修改点**：
- 使用相同的权限合并逻辑生成 token

### 步骤 4：修改用户管理 API
**文件**：`server/src/routes/system.ts`

#### 4.1 GET /api/system/users（用户列表）
**修改**：
- 查询用户关联的所有角色（JOIN `user_roles` 表）
- 返回 `role_ids` 数组和 `role_names` 数组

**SQL**：
```typescript
const query = buildSystemUsersQuery({ currentAccountSetId })
const rawList = db.prepare(query.sql).all(...query.params)

// 为每个用户查询关联的角色
const list = rawList.map(user => {
  const roles = db.prepare(`
    SELECT r.id, r.name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = ? AND ur.account_set_id = ?
  `).all(user.id, user.account_set_id)
  
  return {
    ...user,
    role_ids: roles.map(r => r.id),
    role_names: roles.map(r => r.name).join(', '),
    custom_permissions: user.custom_permissions ? JSON.parse(user.custom_permissions) : null
  }
})
```

#### 4.2 POST /api/system/users（创建用户）
**修改**：
- 接收 `role_ids` 数组（可选）
- 接收 `custom_permissions` 数组（可选）
- 移除 `permission_mode` 验证
- 插入用户后，批量插入 `user_roles` 记录

**代码**：
```typescript
const { username, password, nickname, role_ids, email, phone, custom_permissions } = req.body

// 验证角色存在性
if (role_ids && Array.isArray(role_ids) && role_ids.length > 0) {
  const placeholders = role_ids.map(() => '?').join(',')
  const validRoles = db.prepare(`
    SELECT id FROM roles 
    WHERE id IN (${placeholders}) AND account_set_id = ?
  `).all(...role_ids, accountSetId)
  
  if (validRoles.length !== role_ids.length) {
    return res.status(400).json({ message: '部分角色不存在或不属于当前账套' })
  }
}

// 插入用户
const userId = uuidv4()
db.prepare(`
  INSERT INTO users (id, username, password, nickname, role_id, account_set_id, email, phone, custom_permissions)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  userId, username, hash, nickname || username, 
  role_ids?.[0] || null,  // 第一个角色作为主角色（向后兼容）
  accountSetId, email, phone,
  custom_permissions ? JSON.stringify(custom_permissions) : null
)

// 插入角色关联
if (role_ids && role_ids.length > 0) {
  const insertRole = db.prepare(`
    INSERT INTO user_roles (id, user_id, role_id, account_set_id)
    VALUES (?, ?, ?, ?)
  `)
  role_ids.forEach(roleId => {
    insertRole.run(uuidv4(), userId, roleId, accountSetId)
  })
}
```

#### 4.3 PUT /api/system/users/:id（更新用户）
**修改**：
- 接收 `role_ids` 数组（可选）
- 接收 `custom_permissions` 数组（可选）
- 移除 `permission_mode` 验证
- 使用事务更新：先删除旧的角色关联，再插入新的

**代码**：
```typescript
const { password, nickname, role_ids, status, email, phone, custom_permissions } = req.body

// 使用事务更新
db.transaction(() => {
  // 更新用户基本信息
  const updates = []
  const params = []
  
  if (password) { updates.push('password = ?'); params.push(bcrypt.hashSync(password, 10)) }
  if (nickname !== undefined) { updates.push('nickname = ?'); params.push(nickname) }
  if (status) { updates.push('status = ?'); params.push(status) }
  if (email !== undefined) { updates.push('email = ?'); params.push(email) }
  if (phone !== undefined) { updates.push('phone = ?'); params.push(phone) }
  if (custom_permissions !== undefined) {
    updates.push('custom_permissions = ?')
    params.push(custom_permissions ? JSON.stringify(custom_permissions) : null)
  }
  if (role_ids !== undefined && role_ids.length > 0) {
    updates.push('role_id = ?')
    params.push(role_ids[0])  // 第一个角色作为主角色
  }
  
  if (updates.length > 0) {
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ? AND account_set_id = ?`)
      .run(...params, id, accountSetId)
  }
  
  // 更新角色关联
  if (role_ids !== undefined) {
    // 删除旧的关联
    db.prepare('DELETE FROM user_roles WHERE user_id = ? AND account_set_id = ?')
      .run(id, accountSetId)
    
    // 插入新的关联
    if (role_ids.length > 0) {
      const insertRole = db.prepare(`
        INSERT INTO user_roles (id, user_id, role_id, account_set_id)
        VALUES (?, ?, ?, ?)
      `)
      role_ids.forEach(roleId => {
        insertRole.run(uuidv4(), id, roleId, accountSetId)
      })
    }
  }
})()
```

#### 4.4 DELETE /api/system/users/:id（删除用户）
**修改**：
- 级联删除 `user_roles` 记录（数据库外键已设置 ON DELETE CASCADE）
- 保持现有的个人角色删除逻辑

### 步骤 5：修改登录逻辑
**文件**：`server/src/routes/auth.ts`

**修改点**：
- 移除"用户必须有 role_id"的验证（第 457-465 行）
- 改为验证"用户至少有一个角色或自定义权限"

**代码**：
```typescript
// 验证用户权限配置
const hasRoles = db.prepare(`
  SELECT COUNT(*) as count FROM user_roles 
  WHERE user_id = ? AND account_set_id = ?
`).get(user.id, effectiveAccountSetId) as { count: number }

const hasCustomPerms = user.custom_permissions && JSON.parse(user.custom_permissions).length > 0

if (hasRoles.count === 0 && !hasCustomPerms) {
  return res.status(403).json({ 
    code: 403, 
    message: '该用户未配置权限，无法登录，请联系管理员' 
  })
}
```

### 步骤 6：修改前端用户管理界面
**文件**：`client/src/views/system/User.vue`

#### 6.1 表格列调整
**修改**：
- 移除"权限模式"列
- "角色"列显示多个角色名称（逗号分隔）

#### 6.2 编辑对话框调整
**移除**：
- 权限分配方式单选框

**修改**：
- 角色选择改为多选下拉框（`el-select` 添加 `multiple` 属性）
- 自定义权限配置按钮独立显示（不再受权限模式控制）

**代码**：
```vue
<el-form-item label="角色">
  <el-select 
    v-model="form.role_ids" 
    multiple 
    placeholder="请选择角色（可多选）" 
    style="width: 100%"
  >
    <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
  </el-select>
</el-form-item>

<el-form-item label="自定义权限">
  <el-button type="primary" @click="openPermissionDialog()">配置权限</el-button>
  <span style="margin-left: 10px; color: #909399; font-size: 12px;">
    已选择 {{ form.custom_permissions?.length || 0 }} 项权限
  </span>
</el-form-item>
```

#### 6.3 数据处理
**修改**：
- `form` 对象使用 `role_ids` 数组替代 `role_id`
- 移除 `permission_mode` 字段
- 移除 `onPermissionModeChange` 函数

**代码**：
```typescript
function openDialog(type: string, row?: any) {
  dialogType.value = type
  if (type === 'add') {
    form.value = { 
      status: 'active', 
      role_ids: [], 
      custom_permissions: [] 
    }
  } else {
    const customPerms = row.custom_permissions 
      ? (typeof row.custom_permissions === 'string' 
          ? JSON.parse(row.custom_permissions) 
          : row.custom_permissions)
      : []
    form.value = { 
      ...row, 
      role_ids: row.role_ids || [],
      custom_permissions: Array.isArray(customPerms) ? [...customPerms] : []
    }
  }
  dialogVisible.value = true
}

async function handleSave() {
  // 验证必填字段
  if (!form.value.username?.trim()) {
    ElMessage.warning('请输入登录账号')
    return
  }
  if (dialogType.value === 'add' && !form.value.password?.trim()) {
    ElMessage.warning('请输入密码')
    return
  }
  
  // 验证至少有角色或自定义权限
  const hasRoles = form.value.role_ids && form.value.role_ids.length > 0
  const hasCustomPerms = form.value.custom_permissions && form.value.custom_permissions.length > 0
  if (!hasRoles && !hasCustomPerms) {
    ElMessage.warning('请至少选择一个角色或配置自定义权限')
    return
  }

  saving.value = true
  try {
    const submitData = { ...form.value }
    
    if (dialogType.value === 'add') {
      await request.post('/system/users', submitData)
    } else {
      await request.put(`/system/users/${form.value.id}`, submitData)
    }
    ElMessage.success(dialogType.value === 'add' ? '新增用户成功' : '保存成功')
    dialogVisible.value = false
    await fetchData()
  } finally {
    saving.value = false
  }
}
```

### 步骤 7：更新 systemQuery 服务
**文件**：`server/src/services/systemQuery.ts`

**修改**：
- `buildSystemUsersQuery` 函数移除 `permission_mode` 字段
- 添加子查询获取角色列表

**代码**：
```typescript
export function buildSystemUsersQuery(filters: {
  currentAccountSetId: string
}) {
  const conditions = ['u.account_set_id = ?']
  const params: SqlParam[] = [filters.currentAccountSetId]

  return {
    sql: `
      SELECT u.id, u.username, u.nickname, u.email, u.phone, u.status, 
             u.last_login_at, u.created_at, u.account_set_id, u.role_id, 
             u.custom_permissions, a.name as account_set_name,
             r.name as role_name, r.is_personal as is_personal_role
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id AND r.account_set_id = u.account_set_id
      LEFT JOIN account_sets a ON a.id = u.account_set_id
      ${buildWhereClause(conditions)}
    `,
    params,
  }
}
```

## 向后兼容性

### 保留字段
- `users.role_id`：保留作为"主角色"，用于向后兼容
- `users.permission_mode`：保留但不再使用，避免破坏现有数据

### 数据迁移
- 现有用户的 `role_id` 会自动迁移到 `user_roles` 表
- 现有的 `custom_permissions` 保持不变
- 现有的权限验证逻辑会自动适配新的合并规则

### API 兼容性
- 旧的 API 请求（使用 `role_id` 和 `permission_mode`）仍然可以工作
- 新的 API 请求使用 `role_ids` 数组

## 验证步骤

### 1. 数据库验证
```sql
-- 验证 user_roles 表创建成功
SELECT * FROM sqlite_master WHERE type='table' AND name='user_roles';

-- 验证数据迁移成功
SELECT COUNT(*) FROM user_roles;

-- 验证索引创建成功
SELECT * FROM sqlite_master WHERE type='index' AND tbl_name='user_roles';
```

### 2. 功能测试
1. **创建多角色用户**：选择 2-3 个角色，验证保存成功
2. **创建混合权限用户**：选择角色 + 配置自定义权限，验证保存成功
3. **编辑用户角色**：修改角色列表，验证更新成功
4. **登录测试**：使用多角色用户登录，验证权限合并正确
5. **权限验证**：访问需要特定权限的功能，验证权限检查正确
6. **删除用户**：验证 `user_roles` 记录级联删除

### 3. 性能测试
- 测试权限验证中间件的查询性能
- 验证索引是否生效
- 测试大量角色关联的场景

## 风险与注意事项

### 风险
1. **数据迁移风险**：现有用户的 `role_id` 迁移可能失败
2. **性能风险**：多角色查询可能影响性能
3. **兼容性风险**：旧代码可能依赖 `permission_mode` 字段

### 缓解措施
1. **备份数据库**：迁移前备份
2. **索引优化**：创建必要的索引
3. **渐进式迁移**：保留旧字段，逐步废弃
4. **充分测试**：在测试环境验证所有功能

## 时间估算

- 数据库迁移：1 小时
- 后端 API 修改：2-3 小时
- 前端界面修改：1-2 小时
- 测试验证：1-2 小时
- **总计**：5-8 小时

## 总结

本计划通过创建 `user_roles` 关联表实现多角色支持，同时保留自定义权限功能，两者可以共存并合并。权限计算采用并集规则，确保用户拥有所有角色和自定义权限的总和。前端界面调整为独立的角色选择和权限配置，提供更灵活的权限管理体验。

# 权限分配方式重构 Spec

## Why
当前系统的权限管理采用单一的"角色-权限"模式，所有用户必须关联到一个角色才能获得权限。这种设计存在以下问题：
1. 对于需要特殊权限组合的用户，必须创建专门的角色，导致角色数量膨胀
2. 无法为单个用户快速授予临时或特殊权限
3. 缺乏灵活性，不适应复杂的权限管理场景

## What Changes
- 新增"按用户分配权限"模式，支持直接为用户分配权限
- 保留"按角色分配权限"模式，两种模式可共存
- 用户可以选择使用角色权限或自定义权限
- 当用户未选择角色时，默认创建一个"个人角色"（仅该用户可用，不可被其他用户引用）
- 权限计算规则：用户自定义权限优先，若未设置则使用角色权限

## Impact
- **影响的功能**：用户管理、角色管理、权限验证、登录认证
- **影响的代码**：
  - 数据库表结构：`users` 表需新增权限相关字段
  - 后端路由：`server/src/routes/system.ts`（用户管理、角色管理）
  - 后端中间件：`server/src/middleware/auth.ts`（权限验证逻辑）
  - 前端页面：`client/src/views/system/User.vue`（用户管理界面）
  - 前端页面：`client/src/views/system/Role.vue`（角色管理界面）

## ADDED Requirements

### Requirement: 用户权限分配模式选择
系统应当支持两种权限分配模式：按角色分配和按用户分配。

#### Scenario: 用户选择按角色分配权限
- **WHEN** 管理员在用户管理界面选择"按角色分配"并选择一个角色
- **THEN** 该用户继承所选角色的所有权限

#### Scenario: 用户选择按用户分配权限
- **WHEN** 管理员在用户管理界面选择"按用户分配"并勾选具体权限
- **THEN** 该用户获得所勾选的权限，不受角色限制

#### Scenario: 用户未选择角色（个人角色模式）
- **WHEN** 管理员创建用户时不选择角色，直接分配权限
- **THEN** 系统自动为该用户创建一个"个人角色"（标记为 `is_personal=1`），该角色仅该用户可用

### Requirement: 权限计算优先级
系统应当按照明确的优先级计算用户的实际权限。

#### Scenario: 用户同时拥有角色权限和自定义权限
- **WHEN** 用户既关联了角色，又设置了自定义权限
- **THEN** 系统使用自定义权限，忽略角色权限

#### Scenario: 用户仅关联角色
- **WHEN** 用户仅关联了角色，未设置自定义权限
- **THEN** 系统使用角色权限

#### Scenario: 用户既无角色也无自定义权限
- **WHEN** 用户既未关联角色，也未设置自定义权限
- **THEN** 系统拒绝该用户的所有操作（除登录外）

## MODIFIED Requirements

### Requirement: 用户管理界面
用户管理界面应当支持两种权限分配方式的切换和配置。

**原有功能**：
- 用户列表展示
- 新增/编辑用户（必须选择角色）
- 删除用户

**修改后功能**：
- 用户列表展示（新增"权限模式"列，显示"角色"或"自定义"）
- 新增/编辑用户时，提供"权限分配方式"选择：
  - 选项1：按角色分配（选择角色下拉框）
  - 选项2：按用户分配（权限树形勾选框）
- 删除用户时，若用户使用个人角色，同时删除该角色

### Requirement: 角色管理界面
角色管理界面应当区分普通角色和个人角色。

**原有功能**：
- 角色列表展示（显示"系统"或"自定义"类型）
- 新增/编辑角色
- 删除角色（系统角色不可删除）

**修改后功能**：
- 角色列表展示（新增"个人角色"类型标识）
- 个人角色不可编辑、不可删除（仅在删除用户时自动删除）
- 个人角色不出现在用户管理的角色选择下拉框中

### Requirement: 权限验证逻辑
权限验证中间件应当支持新的权限计算规则。

**原有逻辑**：
```typescript
// 从 JWT token 中获取 permissions（来自角色）
req.permissions = payload.permissions || []
```

**修改后逻辑**：
```typescript
// 1. 检查用户是否有自定义权限（users.custom_permissions）
// 2. 若有，使用自定义权限
// 3. 若无，使用角色权限（roles.permissions）
// 4. 若都无，返回空数组
```

## REMOVED Requirements
无

## Database Schema Changes

### 修改 `users` 表
```sql
ALTER TABLE users ADD COLUMN permission_mode TEXT DEFAULT 'role' CHECK(permission_mode IN ('role', 'custom'));
ALTER TABLE users ADD COLUMN custom_permissions TEXT; -- JSON 数组，存储自定义权限代码
```

### 修改 `roles` 表
```sql
ALTER TABLE roles ADD COLUMN is_personal INTEGER DEFAULT 0; -- 1 表示个人角色
ALTER TABLE roles ADD COLUMN owner_user_id TEXT REFERENCES users(id); -- 个人角色的所属用户
```

## API Changes

### 修改 `POST /api/system/users`（创建用户）
**请求体新增字段**：
```typescript
{
  permission_mode: 'role' | 'custom',  // 权限分配方式
  role_id?: string,                     // 角色ID（permission_mode='role'时必填）
  custom_permissions?: string[]         // 自定义权限列表（permission_mode='custom'时必填）
}
```

### 修改 `PUT /api/system/users/:id`（更新用户）
**请求体新增字段**：同上

### 修改 `GET /api/system/users`（用户列表）
**响应体新增字段**：
```typescript
{
  permission_mode: 'role' | 'custom',
  custom_permissions: string[] | null,
  is_personal_role: boolean  // 是否使用个人角色
}
```

## UI Changes

### 用户管理界面（User.vue）
1. 表格新增"权限模式"列，显示"角色"或"自定义"
2. 编辑对话框新增"权限分配方式"单选框：
   - 选项1：按角色分配（显示角色下拉框）
   - 选项2：按用户分配（显示权限树形勾选框，复用 Role.vue 的权限选择组件）
3. 根据选择的分配方式，动态显示/隐藏对应的表单项

### 角色管理界面（Role.vue）
1. 表格"类型"列新增"个人"标识（is_personal=1）
2. 个人角色的"编辑"和"删除"按钮置灰或隐藏
3. 个人角色显示所属用户信息

## Migration Strategy
1. 为现有用户设置 `permission_mode='role'`（保持现有行为）
2. 为现有角色设置 `is_personal=0`
3. 不影响现有用户的权限和登录状态

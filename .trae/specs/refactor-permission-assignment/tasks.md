# Tasks

## 数据库迁移任务
- [x] Task 1: 创建数据库迁移脚本
  - [x] SubTask 1.1: 为 `users` 表添加 `permission_mode` 和 `custom_permissions` 字段
  - [x] SubTask 1.2: 为 `roles` 表添加 `is_personal` 和 `owner_user_id` 字段
  - [x] SubTask 1.3: 为现有数据设置默认值（`permission_mode='role'`, `is_personal=0`）
  - [x] SubTask 1.4: 在 `migrationList.ts` 中注册新迁移

## 后端实现任务
- [x] Task 2: 修改用户管理 API
  - [x] SubTask 2.1: 修改 `POST /api/system/users` 接口，支持 `permission_mode` 和 `custom_permissions` 参数
  - [x] SubTask 2.2: 修改 `PUT /api/system/users/:id` 接口，支持权限模式切换
  - [x] SubTask 2.3: 修改 `GET /api/system/users` 接口，返回权限模式和自定义权限信息
  - [x] SubTask 2.4: 修改 `DELETE /api/system/users/:id` 接口，删除用户时同时删除个人角色

- [x] Task 3: 修改角色管理 API
  - [x] SubTask 3.1: 修改 `GET /api/system/roles` 接口，过滤个人角色（不在用户选择列表中显示）
  - [x] SubTask 3.2: 修改角色删除逻辑，禁止删除个人角色
  - [x] SubTask 3.3: 修改角色编辑逻辑，禁止编辑个人角色

- [x] Task 4: 修改权限验证中间件
  - [x] SubTask 4.1: 修改 `authMiddleware`，在验证 token 后查询用户的权限模式
  - [x] SubTask 4.2: 实现权限计算逻辑：优先使用 `custom_permissions`，否则使用角色权限
  - [x] SubTask 4.3: 修改 `generateToken` 函数，在生成 token 时包含正确的权限列表

- [x] Task 5: 修改登录逻辑
  - [x] SubTask 5.1: 修改 `POST /api/auth/login` 接口，登录时计算用户的实际权限
  - [x] SubTask 5.2: 确保 JWT token 中包含正确的权限列表

## 前端实现任务
- [x] Task 6: 修改用户管理界面
  - [x] SubTask 6.1: 在用户列表表格中新增"权限模式"列
  - [x] SubTask 6.2: 在编辑对话框中添加"权限分配方式"单选框
  - [x] SubTask 6.3: 实现权限分配方式切换逻辑（显示/隐藏角色选择或权限树）
  - [x] SubTask 6.4: 复用 Role.vue 的权限选择组件，创建权限树勾选界面
  - [x] SubTask 6.5: 修改保存逻辑，根据权限模式提交不同的数据

- [x] Task 7: 修改角色管理界面
  - [x] SubTask 7.1: 在角色列表表格的"类型"列中显示"个人"标识
  - [x] SubTask 7.2: 为个人角色禁用"编辑"和"删除"按钮
  - [x] SubTask 7.3: 在个人角色行显示所属用户信息

## 测试任务
- [x] Task 8: 功能测试
  - [x] SubTask 8.1: 测试按角色分配权限（创建用户、编辑用户、验证权限）
  - [x] SubTask 8.2: 测试按用户分配权限（创建用户、编辑用户、验证权限）
  - [x] SubTask 8.3: 测试权限模式切换（从角色切换到自定义，从自定义切换到角色）
  - [x] SubTask 8.4: 测试个人角色的创建和删除
  - [x] SubTask 8.5: 测试现有用户的兼容性（确保不影响现有用户）

# Task Dependencies
- Task 2 依赖 Task 1（数据库迁移完成后才能修改 API）
- Task 3 依赖 Task 1
- Task 4 依赖 Task 1
- Task 5 依赖 Task 4（权限验证逻辑修改后才能修改登录逻辑）
- Task 6 依赖 Task 2（后端 API 修改完成后才能修改前端）
- Task 7 依赖 Task 3
- Task 8 依赖 Task 2, Task 3, Task 4, Task 5, Task 6, Task 7（所有功能实现完成后进行测试）

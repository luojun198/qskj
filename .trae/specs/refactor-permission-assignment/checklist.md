# Checklist

## 数据库迁移
- [x] `users` 表已添加 `permission_mode` 字段（默认值 'role'）
- [x] `users` 表已添加 `custom_permissions` 字段（TEXT 类型，存储 JSON）
- [x] `roles` 表已添加 `is_personal` 字段（默认值 0）
- [x] `roles` 表已添加 `owner_user_id` 字段（外键关联 users.id）
- [x] 现有用户的 `permission_mode` 已设置为 'role'
- [x] 现有角色的 `is_personal` 已设置为 0
- [x] 迁移脚本已在 `migrationList.ts` 中注册

## 后端 API 实现
- [x] `POST /api/system/users` 接口支持 `permission_mode` 参数
- [x] `POST /api/system/users` 接口支持 `custom_permissions` 参数
- [x] `POST /api/system/users` 接口在 `permission_mode='role'` 时验证 `role_id` 必填
- [x] `POST /api/system/users` 接口在 `permission_mode='custom'` 时验证 `custom_permissions` 必填
- [x] `PUT /api/system/users/:id` 接口支持权限模式切换
- [x] `GET /api/system/users` 接口返回 `permission_mode` 字段
- [x] `GET /api/system/users` 接口返回 `custom_permissions` 字段（已解析为数组）
- [x] `GET /api/system/users` 接口返回 `is_personal_role` 字段
- [x] `DELETE /api/system/users/:id` 接口在删除用户时同时删除个人角色
- [x] `GET /api/system/roles` 接口过滤个人角色（`is_personal=1` 的角色不返回）
- [x] 角色删除接口禁止删除个人角色（返回错误提示）
- [x] 角色编辑接口禁止编辑个人角色（返回错误提示）

## 权限验证逻辑
- [x] `authMiddleware` 在验证 token 后查询用户的 `permission_mode`
- [x] 当 `permission_mode='custom'` 时，使用 `users.custom_permissions`
- [x] 当 `permission_mode='role'` 时，使用 `roles.permissions`
- [x] 当用户既无角色也无自定义权限时，返回空权限数组
- [x] `generateToken` 函数根据权限模式生成正确的权限列表
- [x] 登录接口 `POST /api/auth/login` 计算用户的实际权限并写入 token

## 前端用户管理界面
- [x] 用户列表表格显示"权限模式"列（显示"角色"或"自定义"）
- [x] 编辑对话框包含"权限分配方式"单选框（"按角色分配"/"按用户分配"）
- [x] 选择"按角色分配"时显示角色下拉框，隐藏权限树
- [x] 选择"按用户分配"时显示权限树，隐藏角色下拉框
- [x] 权限树组件复用 Role.vue 的权限选择逻辑
- [x] 保存用户时根据权限模式提交正确的数据结构
- [x] 角色下拉框不显示个人角色

## 前端角色管理界面
- [x] 角色列表表格的"类型"列显示"个人"标识（`is_personal=1`）
- [x] 个人角色的"编辑"按钮被禁用或隐藏
- [x] 个人角色的"删除"按钮被禁用或隐藏
- [x] 个人角色行显示所属用户信息（如"用户：张三"）

## 功能测试
- [ ] 创建新用户并选择"按角色分配"，验证用户继承角色权限
- [ ] 创建新用户并选择"按用户分配"，验证用户获得自定义权限
- [ ] 编辑现有用户，从"按角色分配"切换到"按用户分配"，验证权限正确更新
- [ ] 编辑现有用户，从"按用户分配"切换到"按角色分配"，验证权限正确更新
- [ ] 删除使用个人角色的用户，验证个人角色同时被删除
- [ ] 尝试编辑个人角色，验证操作被禁止
- [ ] 尝试删除个人角色，验证操作被禁止
- [ ] 现有用户登录后权限正常，不受新功能影响
- [ ] 使用自定义权限的用户登录后，JWT token 包含正确的权限列表
- [ ] 使用角色权限的用户登录后，JWT token 包含正确的权限列表

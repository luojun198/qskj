# 源单选择器首次加载修复设计

## 问题

`DocForm` 仅在 `sourcePickerVisible=true` 时创建 `SourceDocPicker`。组件创建时 `modelValue` 已经为 `true`，但源单数据仅依赖 `el-dialog` 的 `open` 事件加载。该初始打开场景未触发事件，因此没有发送 `/api/scm/docs` 请求，弹窗错误显示“无可选源单”。

## 方案

- 移除模板上的 `@open="onOpen"`。
- 监听 `props.modelValue`，在值为 `true` 时调用 `onOpen()`。
- 使用 `{ immediate: true }` 覆盖组件首次创建即打开的场景。
- 保留关闭后重新打开时重新加载、清空旧选择的现有行为。

## 验证

- 组件测试：以 `modelValue=true` 首次挂载时必须调用 `scmApi.getDocs()`。
- 真实页面：新增销售出库，点击“选择源单（销售订单）”，显示 3 张已审核未下推订单。
- 控制台无错误，请求返回成功。

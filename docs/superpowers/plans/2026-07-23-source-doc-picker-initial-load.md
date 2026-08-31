# Source Document Picker Initial Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确保源单选择器首次创建即打开时主动加载可选源单。

**Architecture:** 将数据加载触发点从 Element Plus 弹窗事件改为 Vue 属性监听。`modelValue` 是组件可见性的真实状态源，立即监听可同时覆盖首次挂载和后续重开。

**Tech Stack:** Vue 3、Element Plus、Vitest、Vue Test Utils

---

### Task 1: 首次打开加载源单

**Files:**
- Create: `client/src/components/scm/__tests__/SourceDocPicker.spec.ts`
- Modify: `client/src/components/scm/SourceDocPicker.vue`

- [ ] 写组件失败测试：`modelValue=true` 挂载后断言 `scmApi.getDocs()` 被调用。
- [ ] 运行测试，确认当前实现失败。
- [ ] 移除 `@open="onOpen"`，导入 `watch`，立即监听 `props.modelValue` 并在打开时执行 `onOpen()`。
- [ ] 重新运行测试，确认通过。

### Task 2: 页面回归与记录

**Files:**
- Modify: `优化日志.md`

- [ ] 更新优化日志，说明根因、修复和影响范围。
- [ ] 使用真实 Edge 打开新增销售出库页面并点击选择源单。
- [ ] 确认显示 3 张销售订单，API 请求成功且控制台无错误。

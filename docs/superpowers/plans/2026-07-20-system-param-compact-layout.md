# System Param Compact Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将系统参数页，尤其供应链页签，改造成美观、优雅、紧凑的配置页面。

**Architecture:** 保留 `Param.vue` 的数据模型与事件处理，仅调整供应链模板语义类名和 scoped CSS。复用项目现有薄荷色设计令牌，以 12 列网格组织供应链配置，并用响应式规则降级为单列。

**Tech Stack:** Vue 3、TypeScript、Element Plus、scoped CSS、Vite

---

### Task 1: 供应链语义布局

**Files:**
- Modify: `client/src/views/system/Param.vue`

- [ ] 为供应链配置容器和各区域增加网格语义类。
- [ ] 重排四张超量控制卡片的信息层级，保留原有 `v-model` 与校验属性。
- [ ] 将供应链保存按钮改为统一底部操作栏。

### Task 2: 紧凑视觉样式

**Files:**
- Modify: `client/src/views/system/Param.vue`

- [ ] 压缩页头、页签、区域间距与卡片内边距。
- [ ] 实现供应链 12 列布局和超量控制启用态。
- [ ] 添加 1280px、900px、640px 响应式规则。

### Task 3: 验证与记录

**Files:**
- Modify: `优化日志.md`

- [ ] 运行 `npm run build:deploy --workspace=client`，预期 Vite 构建成功。
- [ ] 检查 `Param.vue` 差异，确认未修改接口与保存逻辑。
- [ ] 更新优化日志，注明仅前端改动、无需数据库迁移和后端重启。

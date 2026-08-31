# start-dev Database Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 cw0523 一键开发启动固定使用独立数据库 `data/finance-0523.db`。

**Architecture:** 启动脚本继续通过 `restart-dev-processes.ps1` 显式传递绝对数据库路径，但该路径与 `server/.env` 统一为 `finance-0523.db`。部署包仍使用其目录内的 `finance.db`，两类用途互不影响。

**Tech Stack:** Windows Batch、PowerShell、Vitest

---

### Task 1: 锁定启动数据库路径

**Files:**
- Modify: `client/src/utils/__tests__/deployPackageScript.spec.ts`
- Modify: `start-dev.bat`

- [ ] **Step 1: 写失败测试**

在 `deployPackageScript.spec.ts` 增加：

```ts
describe('本地开发启动数据库配置', () => {
  it('cw0523 启动脚本使用分支独立数据库', () => {
    const script = readFileSync(resolve(__dirname, '../../../../start-dev.bat'), 'utf8')

    expect(script).toContain('set "DEV_DB_PATH=%ROOT%\\data\\finance-0523.db"')
    expect(script).not.toContain('set "DEV_DB_PATH=%ROOT%\\data\\finance.db"')
  })
})
```

- [ ] **Step 2: 验证测试失败**

运行：

```powershell
npm.cmd run test --workspace=client -- src/utils/__tests__/deployPackageScript.spec.ts --run
```

预期：新增断言失败，实际脚本仍指向 `finance.db`。

- [ ] **Step 3: 最小修复**

将 `start-dev.bat` 修改为：

```bat
set "DEV_DB_PATH=%ROOT%\data\finance-0523.db"
```

- [ ] **Step 4: 验证测试通过**

重新运行同一测试，预期全部通过。

### Task 2: 记录并验证运行结果

**Files:**
- Modify: `优化日志.md`

- [ ] **Step 1: 更新优化日志**

记录启动脚本数据库隔离、无迁移、需要重新登录，以及部署包策略不变。

- [ ] **Step 2: 重启目标服务**

运行 `start-dev.bat`，确认仅监听 3105/5275。

- [ ] **Step 3: 验证数据库数据**

通过 3105 API 登录“出纳测试”，确认：

```text
产品总数 = 69
BOM 总数 = 10
```

- [ ] **Step 4: 验证部署构建测试**

再次运行 `deployPackageScript.spec.ts`，确认本地启动与部署包数据库命名规则同时通过。

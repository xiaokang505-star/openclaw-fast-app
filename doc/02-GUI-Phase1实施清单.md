# GUI Phase1 实施清单（多步任务编排）

> 目标：从“单步 GUI 执行”升级为“多步任务执行骨架”，不依赖 OCR/图像识别也可稳定串联多个动作。

---

## 1. 范围与验收

- 范围：
  - 新增任务计划结构与步骤执行器；
  - 支持一个请求拆成多个 GUI 步骤并顺序执行；
  - 支持步骤级超时、重试、失败终止与回执。
- 本阶段不包含：
  - OCR、图像匹配、点击坐标智能定位；
  - 跨平台适配（默认先对 macOS 打通）。
- 验收标准：
  - 命令“打开微信，输入‘你好’，按回车”可按 3+ 步执行并给出步骤进度；
  - 审计日志可看到 `taskId + stepId` 级别记录；
  - 任一步失败时，回执指出失败步骤与原因。

---

## 2. 文件级改造计划

### 2.1 `src/main/gui-executor.ts`

- 新增动作结果模型（步骤级）：
  - `GuiStepActionResult`（含 `stepId`, `status`, `errorCode`, `durationMs`）。
- 保留并复用已有原子动作：
  - `openApp`, `pressHotkey`, `typeText`。
- 新增动作（Phase1 可先做基础版）：
  - `pressKey('enter' | 'esc' | 'tab')`
  - `waitMs(ms)`
- 增加统一动作分发函数：
  - `runGuiStep(step: GuiStep): Promise<GuiStepActionResult>`

### 2.2 新增 `src/main/gui-task-planner.ts`

- 定义计划类型：
  - `GuiTaskPlan`, `GuiStep`, `GuiTaskRisk`。
- 实现规则型解析器（先规则后模型）：
  - 从一句话中提取 `open_app`、`type_text`、`press_key`、`hotkey`。
  - 支持中文连接词拆分（“并且/然后/再/接着”）。
- 输出统一计划：
  - `buildGuiTaskPlan(userText, context): GuiTaskPlan | null`

### 2.3 新增 `src/main/gui-task-runner.ts`

- 核心执行器：
  - `runGuiTaskPlan(plan, options): Promise<GuiTaskRunResult>`
- 功能要求：
  - 顺序执行；
  - 每步 timeout；
  - 可配置重试（默认 1 次）；
  - 任一步失败则终止并返回失败摘要。
- 产出：
  - `taskResult`（成功/失败、失败步、总耗时、stepResults[]）。

### 2.4 `src/main/main.ts`

- 在 `ipcMain.handle('chat-send', ...)` 中接入新流程：
  1. 识别 `guiIntent`；
  2. 生成 `GuiTaskPlan`；
  3. 执行 `runGuiTaskPlan`；
  4. 返回任务级执行回执（不是单步回执）。
- 兼容：
  - 若计划构建失败，回退到当前网关路径；
  - 若是高风险，沿用现有确认机制。

### 2.5 `src/renderer/src/env.d.ts`

- 扩展类型：
  - `GuiExecutionReceipt` 增加任务级字段：
    - `taskId`, `stepIndex`, `stepTotal`, `failedStepId?`, `failedReason?`

### 2.6 `src/renderer/src/App.vue`

- 优化回执展示：
  - 显示任务进度：`正在执行第 2/5 步`；
  - 失败时显示：`失败于步骤：选择联系人`；
  - 保留技术细节折叠展示（reason/errorCode）。

### 2.7 审计日志（沿用现有文件）

- 每条日志增加：
  - `taskId`, `stepId`, `stepAction`, `attempt`, `durationMs`。
- 保持兼容旧字段，不破坏现有表格渲染。

---

## 3. 开发顺序（建议）

1. 先写 `gui-task-planner.ts` 类型与基础拆分；
2. 再写 `gui-task-runner.ts`（可先用 mock step）；
3. 接入 `gui-executor.ts` 的真实动作；
4. 在 `main.ts` 串联主流程；
5. 最后更新 `App.vue` 回执文案与进度显示；
6. 补充日志字段并验证导出格式。

---

## 4. 测试用例（Phase1）

- 用例 A：`打开微信`
  - 预期：1 步成功，回执 `1/1`。
- 用例 B：`打开微信，然后输入“你好”`
  - 预期：2 步成功，回执最终 `2/2`。
- 用例 C：`打开微信，然后输入“你好”，并按回车`
  - 预期：3 步执行；失败时指出具体步骤。
- 用例 D：高风险句式（含“删除/支付”）
  - 预期：按现有策略确认或阻断，不进入自动执行。

---

## 5. 交付物

- 代码：
  - `gui-task-planner.ts`
  - `gui-task-runner.ts`
  - `gui-executor.ts`（扩展）
  - `main.ts` / `env.d.ts` / `App.vue`（接入）
- 文档：
  - 本清单 + `01-执行方案.md` 状态更新
- 验证：
  - `pnpm exec tsc --noEmit`
  - 关键流程手工验证 4 条用例


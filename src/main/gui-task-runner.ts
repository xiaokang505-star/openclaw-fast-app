import { openApp, pressHotkey, pressKey, typeText } from './gui-executor';
import type { GuiTaskPlan, GuiTaskStep } from './gui-task-planner';

export type GuiStepRunResult = {
  stepId: string;
  action: GuiTaskStep['action'];
  success: boolean;
  message: string;
  error?: string;
  attempt: number;
  durationMs: number;
};

export type GuiTaskRunResult = {
  success: boolean;
  taskId: string;
  totalSteps: number;
  completedSteps: number;
  failedStepId?: string;
  failedReason?: string;
  stepResults: GuiStepRunResult[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(step: GuiTaskStep): Promise<{ success: boolean; detail?: string; error?: string }> {
  if (step.action === 'open_app') {
    const r = await openApp(step.app);
    if (r.success) await sleep(900);
    return r;
  }
  if (step.action === 'type_text') return typeText(step.text);
  if (step.action === 'hotkey') return pressHotkey(step.combo);
  if (step.action === 'press_key') return pressKey(step.key);
  if (step.action === 'wait') {
    await sleep(step.ms);
    return { success: true, detail: `等待 ${step.ms}ms 完成` };
  }
  return { success: false, error: '未知动作' };
}

export async function runGuiTaskPlan(plan: GuiTaskPlan): Promise<GuiTaskRunResult> {
  const stepResults: GuiStepRunResult[] = [];
  for (const step of plan.steps) {
    const maxRetries = Math.max(0, step.maxRetries ?? 0);
    const timeoutMs = Math.max(1000, step.timeoutMs ?? 10000);
    let done = false;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const t0 = Date.now();
      try {
        const res = await Promise.race([
          runStep(step),
          new Promise<{ success: false; error: string }>((resolve) =>
            setTimeout(() => resolve({ success: false, error: `步骤超时（>${timeoutMs}ms）` }), timeoutMs)
          ),
        ]);
        const durationMs = Date.now() - t0;
        const record: GuiStepRunResult = {
          stepId: step.id,
          action: step.action,
          success: res.success,
          message: res.success ? (res.detail || '执行成功') : '执行失败',
          error: res.success ? undefined : (res.error || 'unknown_error'),
          attempt,
          durationMs,
        };
        stepResults.push(record);
        if (res.success) {
          done = true;
          break;
        }
      } catch (e) {
        stepResults.push({
          stepId: step.id,
          action: step.action,
          success: false,
          message: '执行异常',
          error: (e as Error).message,
          attempt,
          durationMs: Date.now() - t0,
        });
      }
    }
    if (!done) {
      const last = [...stepResults].reverse().find((x) => x.stepId === step.id);
      return {
        success: false,
        taskId: plan.id,
        totalSteps: plan.steps.length,
        completedSteps: new Set(stepResults.filter((x) => x.success).map((x) => x.stepId)).size,
        failedStepId: step.id,
        failedReason: last?.error || 'step_failed',
        stepResults,
      };
    }
  }
  return {
    success: true,
    taskId: plan.id,
    totalSteps: plan.steps.length,
    completedSteps: plan.steps.length,
    stepResults,
  };
}

import { app, BrowserWindow, ipcMain, dialog, type MessageBoxOptions } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runDetection } from './detection';
import {
  getNodeDownloadUrlHandler,
  openConfigDirHandler,
  installOpenClawHandler,
  installDaemonHandler,
  startGatewayInProcessHandler,
  stopGatewayInProcessHandler,
  disposeGatewayProcess,
} from './installer';
import {
  readOpenClawConfig,
  writeOpenClawConfig,
  getFormConfigFromRaw,
  ensureOllamaLocalAuthProfile,
  type OpenClawFormConfig,
} from './openclaw-config';
import { sendChat, sendChatStream, getOpenClawGateway500Diagnostic, testGatewayV1Models, verifyRequestChain } from './openclaw-chat';
import { sendOllamaChat, sendOllamaChatStream } from './ollama-chat';
import { isOllamaRunning, ensureOllamaServe, listOllamaModels, getOllamaStatus } from './ollama';
import { writeOllamaProvider, mergeOllamaProviderIntoConfig } from './ollama-adapter';
import { detectDirectGuiAction, normalizeRequestedAppName, openApp, pressHotkey, typeText } from './gui-executor';
import { buildGuiTaskPlan } from './gui-task-planner';
import { runGuiTaskPlan } from './gui-task-runner';
import {
  isNvmInstalled,
  installNvm,
  nvmInstallVersion,
  nvmAliasDefault,
  nvmListInstalled,
  SUGGESTED_NODE_VERSIONS,
} from './nvm';
import { getSettings, setSettings, getPathEnvAsync, getGatewayChatTimeoutMs, NPM_REGISTRY_PRESETS, NVM_NODE_MIRROR_PRESETS } from './settings';

let mainWindow: BrowserWindow | null = null;

type GuiRiskLevel = 'low' | 'medium' | 'high';
type GuiExecutionReceipt = {
  mode: 'gui';
  status: 'blocked' | 'confirmed' | 'executing';
  risk: GuiRiskLevel;
  reason: string;
  requestedApp?: string | null;
  allowApps?: string[];
  taskId?: string;
  stepIndex?: number;
  stepTotal?: number;
  failedStepId?: string;
  failedReason?: string;
};

function getGuiAuditLogPath(): string {
  return path.join(os.homedir(), '.openclaw', 'logs', 'gui-actions.jsonl');
}

async function readGuiAuditLogs(limit = 80): Promise<Array<{
  ts: string;
  status: 'blocked' | 'confirmed' | 'bypassed' | 'executing';
  reason: string;
  risk: GuiRiskLevel;
  message: string;
  allowApps?: string[];
  requestedApp?: string | null;
}>> {
  try {
    const p = getGuiAuditLogPath();
    const raw = await fs.promises.readFile(p, 'utf8');
    const rows = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-Math.max(1, Math.min(500, Math.round(limit))));
    const parsed: Array<{
      ts: string;
      status: 'blocked' | 'confirmed' | 'bypassed' | 'executing';
      reason: string;
      risk: GuiRiskLevel;
      message: string;
      allowApps?: string[];
      requestedApp?: string | null;
    }> = [];
    for (const line of rows) {
      try {
        const j = JSON.parse(line) as {
          ts?: string;
          status?: 'blocked' | 'confirmed' | 'bypassed' | 'executing';
          reason?: string;
          risk?: GuiRiskLevel;
          message?: string;
          allowApps?: string[];
          requestedApp?: string | null;
        };
        if (!j.ts || !j.status || !j.reason || !j.risk) continue;
        parsed.push({
          ts: j.ts,
          status: j.status,
          reason: j.reason,
          risk: j.risk,
          message: typeof j.message === 'string' ? j.message : '',
          allowApps: Array.isArray(j.allowApps) ? j.allowApps : undefined,
          requestedApp: j.requestedApp ?? null,
        });
      } catch {
        // ignore broken line
      }
    }
    return parsed.reverse();
  } catch {
    return [];
  }
}

async function appendGuiAudit(entry: {
  status: 'blocked' | 'confirmed' | 'bypassed' | 'executing';
  reason: string;
  risk: GuiRiskLevel;
  message: string;
  allowApps?: string[];
  requestedApp?: string | null;
  taskId?: string;
  stepId?: string;
  stepAction?: string;
  stepIndex?: number;
  stepTotal?: number;
}): Promise<void> {
  try {
    const p = getGuiAuditLogPath();
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      ...entry,
    };
    await fs.promises.appendFile(p, JSON.stringify(row) + '\n', 'utf8');
  } catch {
    // ignore audit write errors
  }
}

function isGuiIntent(text: string): boolean {
  const t = text.toLowerCase();
  const zh = /(打开|点击|双击|输入|粘贴|切换到|关闭窗口|拖拽|截图|选中|在.*里.*点击)/;
  const en = /\b(open|click|double\s*click|type|paste|switch to|focus window|screenshot|select)\b/;
  return zh.test(text) || en.test(t);
}

function detectGuiRisk(text: string): GuiRiskLevel {
  const t = text.toLowerCase();
  // 高风险：删除/格式化/支付/账号凭据相关
  if (/(删除|清空|格式化|抹掉|卸载|付款|转账|支付|密码|验证码|token|密钥)/.test(text)) return 'high';
  if (/\b(delete|remove|format|wipe|uninstall|pay|transfer|password|token|secret)\b/.test(t)) return 'high';
  // 中风险：系统设置、批量动作、终端命令执行
  if (/(系统设置|偏好设置|批量|自动化|终端执行|脚本执行|权限)/.test(text)) return 'medium';
  if (/\b(system settings|preferences|batch|automation|run in terminal|execute script|permission)\b/.test(t)) return 'medium';
  return 'low';
}

function parseAllowAppsCsv(csv: string | undefined): string[] {
  return String(csv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractRequestedApp(text: string): string | null {
  const m1 = text.match(/打开\s*([A-Za-z0-9\u4e00-\u9fa5._ -]{2,40})/);
  if (m1?.[1]) {
    const app = normalizeRequestedAppName(m1[1]);
    if (app) return app;
  }
  const m2 = text.match(/\bopen\s+([A-Za-z0-9._ -]{2,40})/i);
  if (m2?.[1]) {
    const app = normalizeRequestedAppName(m2[1]);
    if (app) return app;
  }
  return null;
}

function buildGuiPolicySystemPrompt(allowAppsCsv: string | undefined): string {
  const allowApps = String(allowAppsCsv || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowText = allowApps.length ? allowApps.join(', ') : '未设置（可操作任意应用，但仍需遵循安全确认）';
  return [
    '你处于 GUI 执行模式。',
    '优先执行本机 GUI/系统操作，不要调用跨渠道消息投递工具（如 message / sessions_send）。',
    `允许操作应用白名单：${allowText}。`,
    '若动作失败，必须返回：失败原因、当前状态、下一步可执行动作。',
  ].join('\n');
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 700,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'OpenClaw 安装助手',
    show: false,
  });

  // Vue 构建产物在 dist/renderer（生产）；开发时需先 npm run build:renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => disposeGatewayProcess());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: 供渲染进程调用
ipcMain.handle('get-platform-info', () => ({
  platform: process.platform,
  arch: process.arch,
}));

ipcMain.handle('run-detection', async () => {
  const settings = await getSettings();
  return runDetection(mainWindow?.webContents ?? null, { nodePath: settings.nodePath });
});

ipcMain.handle('get-settings', () => getSettings());
ipcMain.handle('set-settings', (_: unknown, s: Parameters<typeof setSettings>[0]) => setSettings(s));

ipcMain.handle('nvm-is-installed', () => isNvmInstalled());
ipcMain.handle('nvm-install', () => installNvm(mainWindow?.webContents ?? null));
ipcMain.handle('nvm-install-version', async (
  _: unknown,
  version: string,
  nodeMirror?: string
) => nvmInstallVersion(version, nodeMirror, mainWindow?.webContents ?? null));
ipcMain.handle('nvm-alias-default', (_: unknown, version: string) => nvmAliasDefault(version));
ipcMain.handle('nvm-list-installed', () => nvmListInstalled());
ipcMain.handle('nvm-suggested-versions', () => SUGGESTED_NODE_VERSIONS);
ipcMain.handle('get-npm-registry-presets', () => NPM_REGISTRY_PRESETS);
ipcMain.handle('get-nvm-node-mirror-presets', () => NVM_NODE_MIRROR_PRESETS);

ipcMain.handle('get-node-download-url', () => getNodeDownloadUrlHandler());
ipcMain.handle('open-config-dir', () => openConfigDirHandler());
ipcMain.handle('install-openclaw', () =>
  installOpenClawHandler(mainWindow?.webContents ?? null)
);
ipcMain.handle('install-daemon', () => installDaemonHandler());
ipcMain.handle('start-gateway-in-process', () => startGatewayInProcessHandler());
ipcMain.handle('stop-gateway-in-process', () => stopGatewayInProcessHandler());

ipcMain.handle('get-openclaw-config', async () => {
  const raw = await readOpenClawConfig();
  return { form: getFormConfigFromRaw(raw) };
});
ipcMain.handle('openclaw-gateway-500-diagnostic', () => getOpenClawGateway500Diagnostic());
ipcMain.handle('test-gateway-v1-models', async () => {
  const settings = await getSettings();
  return testGatewayV1Models(getGatewayChatTimeoutMs(settings));
});
ipcMain.handle('verify-request-chain', () => verifyRequestChain());
ipcMain.handle('get-gui-audit-logs', async (_: unknown, limit?: number) => readGuiAuditLogs(typeof limit === 'number' ? limit : 80));
ipcMain.handle('export-gui-audit-logs', async (_: unknown, payload: string) => {
  try {
    const dir = path.join(os.homedir(), '.openclaw', 'logs');
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `gui-audit-export-${Date.now()}.txt`);
    await fs.promises.writeFile(filePath, payload, 'utf8');
    return { success: true, path: filePath };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
});
ipcMain.handle('set-openclaw-config', async (_: unknown, form: OpenClawFormConfig) => {
  const existing = await readOpenClawConfig();
  return writeOpenClawConfig(existing, form);
});

ipcMain.handle('openclaw-chat-send', async (_: unknown, messages: { role: string; content: string }[], stream?: boolean) => {
  const list = messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
  // OpenClaw /v1/chat/completions 的 model 填 agent 标识（如 openclaw/main），实际模型由 agents.defaults.model.primary 决定；传具体模型 id 可能触发 500 api_error
  if (stream) {
    return sendChatStream(mainWindow?.webContents ?? null, list, { model: 'openclaw' });
  }
  return sendChat(list, { model: 'openclaw' });
});

/** 对话直连 Ollama，不经过 OpenClaw；model 为空时从 settings 读取 */
ipcMain.handle('ollama-chat-send', async (
  _: unknown,
  messages: { role: string; content: string }[],
  stream?: boolean,
  model?: string
) => {
  const list = messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
  const settings = await getSettings();
  const useModel = (model?.trim() || settings.ollamaChatModel?.trim() || 'llama3.2').trim();
  if (stream) {
    return sendOllamaChatStream(mainWindow?.webContents ?? null, list, useModel);
  }
  return sendOllamaChat(list, useModel);
});

/** 统一对话入口：按设置 chatBackend 走 OpenClaw 网关或 Ollama 直连（直连可绕过网关 16k 上下文限制） */
ipcMain.handle('chat-send', async (_: unknown, messages: { role: string; content: string }[], stream?: boolean) => {
  const settings = await getSettings();
  const list = messages.map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));
  const gatewayTimeoutMs = getGatewayChatTimeoutMs(settings);
  const lastUser = [...list].reverse().find((m) => m.role === 'user');
  const guiIntent = lastUser ? isGuiIntent(lastUser.content) : false;
  const raw = await readOpenClawConfig();
  const form = getFormConfigFromRaw(raw);
  const guiEnabled = settings.guiEnabled === true;
  const guiRisk = lastUser ? detectGuiRisk(lastUser.content) : 'low';
  const allowApps = parseAllowAppsCsv(settings.guiAllowApps);
  const requestedApp = lastUser ? extractRequestedApp(lastUser.content) : null;
  const makeReceipt = (status: GuiExecutionReceipt['status'], reason: string): GuiExecutionReceipt => ({
    mode: 'gui',
    status,
    risk: guiRisk,
    reason,
    requestedApp,
    allowApps,
  });
  const listWithGuiPolicy = guiIntent
    ? [{ role: 'system' as const, content: buildGuiPolicySystemPrompt(settings.guiAllowApps) }, ...list]
    : list;

  if (guiIntent && !guiEnabled) {
    await appendGuiAudit({
      status: 'blocked',
      reason: 'gui_disabled',
      risk: guiRisk,
      message: lastUser?.content ?? '',
      allowApps,
      requestedApp,
    });
    return {
      success: false,
      error:
        '检测到 GUI 操作意图（如打开/点击/输入），但当前未启用 GUI 执行。请在 OpenClaw 配置中开启「GUI 操作总开关」后重试。',
      executionReceipt: makeReceipt('blocked', 'gui_disabled'),
    };
  }

  if (guiIntent && allowApps.length > 0 && requestedApp) {
    const hit = allowApps.some((a) => a.toLowerCase() === requestedApp.toLowerCase());
    if (!hit) {
      await appendGuiAudit({
        status: 'blocked',
        reason: 'app_not_in_allowlist',
        risk: guiRisk,
        message: lastUser?.content ?? '',
        allowApps,
        requestedApp,
      });
      return {
        success: false,
        error: `GUI 请求被策略拦截：应用「${requestedApp}」不在白名单（${allowApps.join(', ')}）。请在 OpenClaw 配置中更新「允许操作的应用」。`,
        executionReceipt: makeReceipt('blocked', 'app_not_in_allowlist'),
      };
    }
  }

  if (guiIntent && guiRisk === 'high' && settings.guiRequireConfirmForDangerous !== false) {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
    const boxOpts: MessageBoxOptions = {
      type: 'warning',
      buttons: ['取消', '继续执行'],
      defaultId: 1,
      cancelId: 0,
      title: '高风险 GUI 操作确认',
      message: '检测到高风险 GUI 操作请求，是否继续？',
      detail: `用户请求：${lastUser?.content ?? ''}`,
    };
    const res = win ? await dialog.showMessageBox(win, boxOpts) : await dialog.showMessageBox(boxOpts);
    if (res.response !== 1) {
      await appendGuiAudit({
        status: 'blocked',
        reason: 'user_declined_high_risk',
        risk: guiRisk,
        message: lastUser?.content ?? '',
        allowApps,
        requestedApp,
      });
      return { success: false, error: '已取消：高风险 GUI 操作未执行。', executionReceipt: makeReceipt('blocked', 'user_declined_high_risk') };
    }
    await appendGuiAudit({
      status: 'confirmed',
      reason: 'user_confirmed_high_risk',
      risk: guiRisk,
      message: lastUser?.content ?? '',
      allowApps,
      requestedApp,
    });
  } else if (guiIntent) {
    await appendGuiAudit({
      status: 'executing',
      reason: guiRisk === 'medium' ? 'gui_medium_risk_auto' : 'gui_low_risk_auto',
      risk: guiRisk,
      message: lastUser?.content ?? '',
      allowApps,
      requestedApp,
    });
  }

  // 多步 GUI 任务执行器（Phase1）：先规则拆计划，再逐步执行
  if (guiIntent && lastUser) {
    const plan = buildGuiTaskPlan(lastUser.content, guiRisk);
    if (plan && guiRisk !== 'high') {
      const planSummary = plan.steps.map((s) => {
        if (s.action === 'open_app') return `open_app(${s.app})`;
        if (s.action === 'type_text') return `type_text(${s.text})`;
        if (s.action === 'hotkey') return `hotkey(${s.combo})`;
        if (s.action === 'press_key') return `press_key(${s.key})`;
        if (s.action === 'wait') return `wait(${s.ms}ms)`;
        return 'unknown';
      }).join(' -> ');
      const taskResult = await runGuiTaskPlan(plan);
      for (let i = 0; i < taskResult.stepResults.length; i++) {
        const s = taskResult.stepResults[i];
        await appendGuiAudit({
          status: s.success ? 'executing' : 'blocked',
          reason: s.success ? 'task_step_ok' : 'task_step_failed',
          risk: guiRisk,
          message: `${lastUser.content}\n[step ${i + 1}/${taskResult.totalSteps}] ${s.action} ${s.success ? 'ok' : 'failed'}`,
          allowApps,
          requestedApp,
          taskId: taskResult.taskId,
          stepId: s.stepId,
          stepAction: s.action,
          stepIndex: i + 1,
          stepTotal: taskResult.totalSteps,
        });
      }
      if (taskResult.success) {
        return {
          success: true,
          content: `已执行 GUI 任务，共 ${taskResult.totalSteps} 步，全部完成。\n计划：${planSummary}`,
          executionReceipt: {
            ...makeReceipt('executing', 'gui_task_ok'),
            taskId: taskResult.taskId,
            stepIndex: taskResult.completedSteps,
            stepTotal: taskResult.totalSteps,
          },
        };
      }
      return {
        success: false,
        error: `GUI 任务在步骤 ${taskResult.completedSteps + 1}/${taskResult.totalSteps} 失败：${taskResult.failedReason || 'unknown_error'}。\n计划：${planSummary}`,
        executionReceipt: {
          ...makeReceipt('blocked', 'gui_task_failed'),
          taskId: taskResult.taskId,
          stepIndex: taskResult.completedSteps + 1,
          stepTotal: taskResult.totalSteps,
          failedStepId: taskResult.failedStepId,
          failedReason: taskResult.failedReason,
        },
      };
    }

    const direct = detectDirectGuiAction(lastUser.content);
    if (direct) {
      if (guiRisk !== 'high') {
        let actionRes:
          | { success: boolean; detail?: string; error?: string }
          | null = null;
        if (direct.kind === 'open_app') actionRes = await openApp(direct.app);
        else if (direct.kind === 'hotkey') actionRes = await pressHotkey(direct.combo);
        else if (direct.kind === 'type_text') actionRes = await typeText(direct.content);

        if (actionRes) {
          if (actionRes.success) {
            await appendGuiAudit({
              status: 'executing',
              reason: `direct_${direct.kind}_ok`,
              risk: guiRisk,
              message: lastUser.content,
              allowApps,
              requestedApp,
            });
            return {
              success: true,
              content: actionRes.detail ?? '已执行 GUI 操作。',
              executionReceipt: makeReceipt('executing', `direct_${direct.kind}_ok`),
            };
          }
          await appendGuiAudit({
            status: 'blocked',
            reason: `direct_${direct.kind}_failed`,
            risk: guiRisk,
            message: lastUser.content,
            allowApps,
            requestedApp,
          });
          return {
            success: false,
            error: actionRes.error ?? 'GUI 直接执行失败。',
            executionReceipt: makeReceipt('blocked', `direct_${direct.kind}_failed`),
          };
        }
      }
    }
  }

  // GUI 意图下始终走 OpenClaw 网关，避免落到 Ollama 直连仅对话模式
  if (!guiIntent && settings.chatBackend === 'ollama') {
    let useModel = settings.ollamaChatModel?.trim();
    if (!useModel) {
      useModel = form.defaultModel?.replace(/^ollama-local\/|^ollama\//, '').trim() || 'llama3.2';
    }
    if (stream) {
      return sendOllamaChatStream(mainWindow?.webContents ?? null, list, useModel);
    }
    return sendOllamaChat(list, useModel);
  }
  if (stream) {
    const r = await sendChatStream(mainWindow?.webContents ?? null, listWithGuiPolicy, { model: 'openclaw' });
    return guiIntent ? { ...r, executionReceipt: makeReceipt('executing', guiRisk === 'high' ? 'user_confirmed_high_risk' : (guiRisk === 'medium' ? 'gui_medium_risk_auto' : 'gui_low_risk_auto')) } : r;
  }
  const r = await sendChat(listWithGuiPolicy, { model: 'openclaw', timeoutMs: gatewayTimeoutMs });
  return guiIntent ? { ...r, executionReceipt: makeReceipt('executing', guiRisk === 'high' ? 'user_confirmed_high_risk' : (guiRisk === 'medium' ? 'gui_medium_risk_auto' : 'gui_low_risk_auto')) } : r;
});

ipcMain.handle('ollama-is-running', () => isOllamaRunning());
ipcMain.handle('ollama-status', () => getOllamaStatus());
ipcMain.handle('ollama-serve', () => ensureOllamaServe(mainWindow?.webContents ?? null));
ipcMain.handle('ollama-list-models', () => listOllamaModels());
ipcMain.handle('ollama-write-provider', (_: unknown, modelName: string) => writeOllamaProvider(modelName));

/** 一键应用本地模型：先合并 models.providers["ollama-local"] 再写默认模型与 gateway，一次写文件，避免 models 被覆盖 */
ipcMain.handle('apply-local-model', async (_: unknown, modelName: string) => {
  const trimmed = String(modelName).trim();
  if (!trimmed) return { success: false, error: '模型名为空' };
  const existing = await readOpenClawConfig();
  const configWithProvider = mergeOllamaProviderIntoConfig(existing, trimmed);
  const defaultModelId = `ollama-local/${trimmed}`;
  const result = await writeOpenClawConfig(configWithProvider as Record<string, unknown>, {
    modelSource: 'local',
    defaultModel: defaultModelId,
  });
  if (result.success) await ensureOllamaLocalAuthProfile();
  return result;
});

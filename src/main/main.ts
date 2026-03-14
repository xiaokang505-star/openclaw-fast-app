import { app, BrowserWindow, ipcMain } from 'electron';
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
  if (settings.chatBackend === 'ollama') {
    let useModel = settings.ollamaChatModel?.trim();
    if (!useModel) {
      const raw = await readOpenClawConfig();
      const form = getFormConfigFromRaw(raw);
      useModel = form.defaultModel?.replace(/^ollama-local\/|^ollama\//, '').trim() || 'llama3.2';
    }
    if (stream) {
      return sendOllamaChatStream(mainWindow?.webContents ?? null, list, useModel);
    }
    return sendOllamaChat(list, useModel);
  }
  if (stream) {
    return sendChatStream(mainWindow?.webContents ?? null, list, { model: 'openclaw' });
  }
  return sendChat(list, { model: 'openclaw', timeoutMs: gatewayTimeoutMs });
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

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  runDetection: () => ipcRenderer.invoke('run-detection'),
  onDetectionProgress: (callback: (data: { step: string; message: string }) => void) => {
    const handler = (_: unknown, data: { step: string; message: string }) => callback(data);
    ipcRenderer.on('detection-progress', handler);
    return () => ipcRenderer.removeListener('detection-progress', handler);
  },
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (s: {
    nodePath?: string;
    npmRegistry?: string;
    nvmNodeMirror?: string;
    nvmDefaultVersion?: string;
    wizardCompleted?: boolean;
    openclawPackageVersion?: string;
    ollamaChatModel?: string;
    chatBackend?: 'ollama' | 'openclaw';
    gatewayChatTimeoutSec?: number;
    guiEnabled?: boolean;
    guiAllowApps?: string;
    guiRequireConfirmForDangerous?: boolean;
  }) => ipcRenderer.invoke('set-settings', s),
  getNodeDownloadUrl: () => ipcRenderer.invoke('get-node-download-url'),
  nvmIsInstalled: () => ipcRenderer.invoke('nvm-is-installed'),
  nvmInstall: () => ipcRenderer.invoke('nvm-install'),
  nvmInstallVersion: (version: string, nodeMirror?: string) => ipcRenderer.invoke('nvm-install-version', version, nodeMirror),
  nvmAliasDefault: (version: string) => ipcRenderer.invoke('nvm-alias-default', version),
  nvmListInstalled: () => ipcRenderer.invoke('nvm-list-installed'),
  nvmSuggestedVersions: () => ipcRenderer.invoke('nvm-suggested-versions'),
  getNpmRegistryPresets: () => ipcRenderer.invoke('get-npm-registry-presets'),
  getNvmNodeMirrorPresets: () => ipcRenderer.invoke('get-nvm-node-mirror-presets'),
  onNvmProgress: (callback: (msg: string) => void) => {
    const handler = (_: unknown, msg: string) => callback(msg);
    ipcRenderer.on('nvm-progress', handler);
    return () => ipcRenderer.removeListener('nvm-progress', handler);
  },
  openConfigDir: () => ipcRenderer.invoke('open-config-dir'),
  getOpenClawConfig: () => ipcRenderer.invoke('get-openclaw-config'),
  setOpenClawConfig: (form: {
    modelSource?: string;
    defaultModel?: string;
    gatewayPort?: number;
    gatewayToken?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    googleGeminiApiKey?: string;
    discordEnabled?: boolean;
    discordBotToken?: string;
    discordAllowFromUserId?: string;
    discordGuildId?: string;
    telegramBotToken?: string;
    slackBotToken?: string;
    slackAppToken?: string;
    feishuAppSecret?: string;
    mattermostBotToken?: string;
  }) => ipcRenderer.invoke('set-openclaw-config', form),
  /** 诊断 500 可能原因：默认模型、Ollama 状态、模型是否已拉取 */
  openclawGateway500Diagnostic: () => ipcRenderer.invoke('openclaw-gateway-500-diagnostic') as Promise<{ summary: string; details: string[] }>,
  testGatewayV1Models: () => ipcRenderer.invoke('test-gateway-v1-models') as Promise<{ success: boolean; status?: number; statusText?: string; modelIds?: string[]; rawBody?: string; error?: string; chatCompletionsCheck?: { ok: boolean; status: number; bodyPreview: string } }>,
  verifyRequestChain: () => ipcRenderer.invoke('verify-request-chain') as Promise<{ ollama: { ok: boolean; ms: number; error?: string }; gateway: { ok: boolean; ms: number; error?: string }; model: string }>,
  getGuiAuditLogs: (limit?: number) => ipcRenderer.invoke('get-gui-audit-logs', limit) as Promise<Array<{
    ts: string;
    status: 'blocked' | 'confirmed' | 'bypassed' | 'executing';
    reason: string;
    risk: 'low' | 'medium' | 'high';
    message: string;
    allowApps?: string[];
    requestedApp?: string | null;
    taskId?: string;
    stepId?: string;
    stepAction?: string;
    stepIndex?: number;
    stepTotal?: number;
  }>>,
  exportGuiAuditLogs: (payload: string) => ipcRenderer.invoke('export-gui-audit-logs', payload) as Promise<{ success: boolean; path?: string; error?: string }>,
  openclawChatSend: (messages: { role: string; content: string }[], stream?: boolean) => ipcRenderer.invoke('openclaw-chat-send', messages, stream),
  /** 对话直连 Ollama；model 可选，不传则用设置中的 ollamaChatModel */
  ollamaChatSend: (messages: { role: string; content: string }[], stream?: boolean, model?: string) => ipcRenderer.invoke('ollama-chat-send', messages, stream, model),
  /** 统一对话：按设置 chatBackend 走网关或 Ollama 直连 */
  chatSend: (messages: { role: string; content: string }[], stream?: boolean) => ipcRenderer.invoke('chat-send', messages, stream),
  onChatStreamDelta: (callback: (delta: string) => void) => {
    const handler = (_: unknown, delta: string) => callback(delta);
    ipcRenderer.on('chat-stream-delta', handler);
    return () => ipcRenderer.removeListener('chat-stream-delta', handler);
  },
  onChatStreamDone: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('chat-stream-done', handler);
    return () => ipcRenderer.removeListener('chat-stream-done', handler);
  },
  ollamaIsRunning: () => ipcRenderer.invoke('ollama-is-running'),
  ollamaStatus: () => ipcRenderer.invoke('ollama-status') as Promise<{ running: boolean; loadedModels: string[] }>,
  ollamaServe: () => ipcRenderer.invoke('ollama-serve'),
  ollamaListModels: () => ipcRenderer.invoke('ollama-list-models'),
  ollamaWriteProvider: (modelName: string) => ipcRenderer.invoke('ollama-write-provider', modelName),
  applyLocalModel: (modelName: string) => ipcRenderer.invoke('apply-local-model', modelName) as Promise<{ success: boolean; error?: string }>,
  onOllamaServeProgress: (callback: (msg: string) => void) => {
    const handler = (_: unknown, msg: string) => callback(msg);
    ipcRenderer.on('ollama-serve-progress', handler);
    return () => ipcRenderer.removeListener('ollama-serve-progress', handler);
  },
  installOpenClaw: () => ipcRenderer.invoke('install-openclaw'),
  installDaemon: () => ipcRenderer.invoke('install-daemon'),
  startGatewayInProcess: () => ipcRenderer.invoke('start-gateway-in-process'),
  stopGatewayInProcess: () => ipcRenderer.invoke('stop-gateway-in-process'),
  onInstallOpenClawProgress: (
    callback: (data: { type: string; data: string }) => void
  ) => {
    const handler = (_: unknown, data: { type: string; data: string }) => callback(data);
    ipcRenderer.on('install-openclaw-progress', handler);
    return () => ipcRenderer.removeListener('install-openclaw-progress', handler);
  },
});

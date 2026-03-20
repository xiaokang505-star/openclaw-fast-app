/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

import type { DetectionReport } from './types';

export interface AppSettings {
  nodePath?: string;
  npmRegistry?: string;
  nvmNodeMirror?: string;
  nvmDefaultVersion?: string;
  wizardCompleted?: boolean;
  openclawPackageVersion?: string;
  ollamaChatModel?: string;
  chatBackend?: 'ollama' | 'openclaw';
  /** 经 OpenClaw 网关对话超时（秒），30～300，默认 90 */
  gatewayChatTimeoutSec?: number;
  guiEnabled?: boolean;
  guiAllowApps?: string;
  guiRequireConfirmForDangerous?: boolean;
}

export interface OpenClawFormConfig {
  modelSource?: 'cloud' | 'local';
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
}

export interface RegistryPreset {
  id: string;
  name: string;
  url: string;
}

export interface GuiExecutionReceipt {
  mode: 'gui';
  status: 'blocked' | 'confirmed' | 'executing';
  risk: 'low' | 'medium' | 'high';
  reason: string;
  requestedApp?: string | null;
  allowApps?: string[];
  taskId?: string;
  stepIndex?: number;
  stepTotal?: number;
  failedStepId?: string;
  failedReason?: string;
}

export interface GuiAuditLogEntry {
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
}

export interface LocalUserContext {
  username: string;
  realName?: string;
  homeDir: string;
  hostName: string;
  platform: string;
  arch: string;
  locale: string;
  timezone: string;
}

declare global {
  interface Window {
    electronAPI: {
      getPlatformInfo: () => Promise<{ platform: string; arch: string }>;
      getLocalUserContext: () => Promise<LocalUserContext>;
      runDetection: () => Promise<DetectionReport>;
      windowMinimize: () => Promise<void>;
      windowMaximizeToggle: () => Promise<boolean>;
      windowIsMaximized: () => Promise<boolean>;
      windowClose: () => Promise<void>;
      onDetectionProgress: (callback: (data: { step: string; message: string }) => void) => () => void;
      getSettings: () => Promise<AppSettings>;
      setSettings: (s: AppSettings) => Promise<void>;
      nvmIsInstalled: () => Promise<boolean>;
      nvmInstall: () => Promise<{ success: boolean; error?: string }>;
      nvmInstallVersion: (version: string, nodeMirror?: string) => Promise<{ success: boolean; stdout: string; stderr: string; error?: string }>;
      nvmAliasDefault: (version: string) => Promise<{ success: boolean; error?: string }>;
      nvmListInstalled: () => Promise<string[]>;
      nvmSuggestedVersions: () => Promise<string[]>;
      getNpmRegistryPresets: () => Promise<RegistryPreset[]>;
      getNvmNodeMirrorPresets: () => Promise<RegistryPreset[]>;
      onNvmProgress: (callback: (msg: string) => void) => () => void;
      getNodeDownloadUrl: () => Promise<string>;
      openConfigDir: () => Promise<{ success: boolean; error?: string }>;
      getOpenClawConfig: () => Promise<{ form: OpenClawFormConfig }>;
      setOpenClawConfig: (form: OpenClawFormConfig) => Promise<{ success: boolean; error?: string }>;
      openclawGateway500Diagnostic: () => Promise<{ summary: string; details: string[] }>;
      testGatewayV1Models: () => Promise<{ success: boolean; status?: number; statusText?: string; modelIds?: string[]; rawBody?: string; error?: string; chatCompletionsCheck?: { ok: boolean; status: number; bodyPreview: string }; diagnosticDetails?: string[] }>;
      verifyRequestChain: () => Promise<{ ollama: { ok: boolean; ms: number; error?: string }; gateway: { ok: boolean; ms: number; error?: string }; model: string }>;
      getGuiAuditLogs: (limit?: number) => Promise<GuiAuditLogEntry[]>;
      exportGuiAuditLogs: (payload: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      openclawChatSend: (messages: { role: string; content: string }[], stream?: boolean) => Promise<{ success: boolean; content?: string; error?: string }>;
      ollamaChatSend: (messages: { role: string; content: string }[], stream?: boolean, model?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
      chatSend: (messages: { role: string; content: string }[], stream?: boolean) => Promise<{ success: boolean; content?: string; error?: string; executionReceipt?: GuiExecutionReceipt }>;
      onChatStreamDelta: (callback: (delta: string) => void) => () => void;
      onChatStreamDone: (callback: () => void) => () => void;
      ollamaIsRunning: () => Promise<boolean>;
      ollamaStatus: () => Promise<{ running: boolean; loadedModels: string[] }>;
      ollamaServe: () => Promise<{ success: boolean; error?: string }>;
      ollamaListModels: () => Promise<{ name: string; digest?: string }[]>;
      ollamaWriteProvider: (modelName: string) => Promise<{ success: boolean; error?: string }>;
      applyLocalModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
      onOllamaServeProgress: (callback: (msg: string) => void) => () => void;
      installOpenClaw: () => Promise<{ success: boolean; stdout: string; stderr: string; error?: string }>;
      installDaemon: () => Promise<{ success: boolean; stdout: string; stderr: string; error?: string }>;
      startGatewayInProcess: () => Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }>;
      stopGatewayInProcess: () => Promise<{ success: boolean }>;
      onInstallOpenClawProgress: (callback: (data: { type: string; data: string }) => void) => () => void;
    };
  }
}

export {};

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isNvmInstalled, nvmWhichDefault } from './nvm';

/** 将「设置中的 Node 路径」解析为目录，并返回用于子进程的 env（PATH 优先使用该目录） */
export function getPathEnvForNode(nodePath?: string): NodeJS.ProcessEnv | undefined {
  if (!nodePath || !nodePath.trim()) return undefined;
  const trimmed = nodePath.trim();
  const base = path.basename(trimmed).toLowerCase();
  const nodeDir =
    base === 'node' || base === 'node.exe'
      ? path.dirname(trimmed)
      : trimmed;
  const existingPath = process.env.PATH || process.env.Path || '';
  return {
    ...process.env,
    PATH: nodeDir + path.delimiter + existingPath,
  };
}

/** 根据设置解析 Node 环境（优先 nodePath，否则 nvm default），用于检测与安装 */
export async function getPathEnvAsync(settings: AppSettings): Promise<NodeJS.ProcessEnv> {
  if (settings.nodePath?.trim()) {
    const env = getPathEnvForNode(settings.nodePath);
    if (env) return env;
  }
  if (process.platform !== 'win32' && isNvmInstalled()) {
    const nodeBin = await nvmWhichDefault();
    if (nodeBin) {
      const env = getPathEnvForNode(path.dirname(nodeBin));
      if (env) return env;
    }
  }
  return process.env;
}

export interface AppSettings {
  nodePath?: string;
  npmRegistry?: string;
  nvmNodeMirror?: string;
  nvmDefaultVersion?: string;
  /** 是否已完成安装向导（阶段二配置完成），下次启动可直入主界面 */
  wizardCompleted?: boolean;
  /** OpenClaw 包版本，如 latest 或 1.2.3，安装时使用 openclaw@${openclawPackageVersion} */
  openclawPackageVersion?: string;
  /** 对话使用的 Ollama 模型名，直连 Ollama 时使用 */
  ollamaChatModel?: string;
  /** 对话后端：ollama 本地免费 / openclaw 网关（可操作电脑） */
  chatBackend?: 'ollama' | 'openclaw';
  /** 经 OpenClaw 网关对话的超时时间（秒），仅对网关对话生效；默认 90，范围 30～300 */
  gatewayChatTimeoutSec?: number;
  /** GUI 执行总开关（应用侧策略，不写 openclaw.json） */
  guiEnabled?: boolean;
  /** GUI 允许操作应用白名单（逗号分隔字符串） */
  guiAllowApps?: string;
  /** 高风险 GUI 操作前二次确认 */
  guiRequireConfirmForDangerous?: boolean;
}

export const GATEWAY_CHAT_TIMEOUT_SEC_MIN = 30;
export const GATEWAY_CHAT_TIMEOUT_SEC_MAX = 3000;
export const GATEWAY_CHAT_TIMEOUT_SEC_DEFAULT = 3000;

/** 根据设置返回网关对话超时毫秒数（已做范围限制） */
export function getGatewayChatTimeoutMs(settings: AppSettings): number {
  const sec = typeof settings.gatewayChatTimeoutSec === 'number' && Number.isFinite(settings.gatewayChatTimeoutSec)
    ? settings.gatewayChatTimeoutSec
    : GATEWAY_CHAT_TIMEOUT_SEC_DEFAULT;
  const clamped = Math.min(GATEWAY_CHAT_TIMEOUT_SEC_MAX, Math.max(GATEWAY_CHAT_TIMEOUT_SEC_MIN, Math.round(sec)));
  return clamped * 1000;
}

/** npm 源预设（供设置页图形化切换） */
export const NPM_REGISTRY_PRESETS: { id: string; name: string; url: string }[] = [
  { id: 'official', name: '官方', url: 'https://registry.npmjs.org/' },
  { id: 'npmmirror', name: 'npmmirror（淘宝）', url: 'https://registry.npmmirror.com/' },
  { id: 'tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/npm/' },
  { id: 'huawei', name: '华为云', url: 'https://repo.huaweicloud.com/repository/npm/' },
];

/** nvm Node 下载镜像预设 */
export const NVM_NODE_MIRROR_PRESETS: { id: string; name: string; url: string }[] = [
  { id: 'official', name: '官方', url: 'https://nodejs.org/dist/' },
  { id: 'npmmirror', name: 'npmmirror', url: 'https://npmmirror.com/mirrors/node/' },
  { id: 'tencent', name: '腾讯云', url: 'https://mirrors.cloud.tencent.com/nodejs-release/' },
];

const SETTINGS_FILE = 'settings.json';

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const p = getSettingsPath();
    const raw = await fs.promises.readFile(p, 'utf8');
    const data = JSON.parse(raw) as AppSettings;
    return {
      nodePath: typeof data.nodePath === 'string' ? data.nodePath.trim() || undefined : undefined,
      npmRegistry: typeof data.npmRegistry === 'string' ? data.npmRegistry.trim() || undefined : undefined,
      nvmNodeMirror: typeof data.nvmNodeMirror === 'string' ? data.nvmNodeMirror.trim() || undefined : undefined,
      nvmDefaultVersion: typeof data.nvmDefaultVersion === 'string' ? data.nvmDefaultVersion.trim() || undefined : undefined,
      wizardCompleted: data.wizardCompleted === true,
      openclawPackageVersion: typeof data.openclawPackageVersion === 'string' ? data.openclawPackageVersion.trim() || undefined : undefined,
      ollamaChatModel: typeof data.ollamaChatModel === 'string' ? data.ollamaChatModel.trim() || undefined : undefined,
      chatBackend: data.chatBackend === 'openclaw' || data.chatBackend === 'ollama' ? data.chatBackend : undefined,
      gatewayChatTimeoutSec: typeof data.gatewayChatTimeoutSec === 'number' && Number.isFinite(data.gatewayChatTimeoutSec)
        ? Math.min(GATEWAY_CHAT_TIMEOUT_SEC_MAX, Math.max(GATEWAY_CHAT_TIMEOUT_SEC_MIN, Math.round(data.gatewayChatTimeoutSec)))
        : undefined,
      guiEnabled: data.guiEnabled === true,
      guiAllowApps: typeof data.guiAllowApps === 'string' ? data.guiAllowApps.trim() || undefined : undefined,
      guiRequireConfirmForDangerous: data.guiRequireConfirmForDangerous !== false,
    };
  } catch {
    return {};
  }
}

export async function setSettings(settings: AppSettings): Promise<void> {
  const p = getSettingsPath();
  const dir = path.dirname(p);
  await fs.promises.mkdir(dir, { recursive: true });
  const prev = await getSettings().catch(() => ({} as AppSettings));
  const merged = {
    nodePath: settings.nodePath !== undefined ? (settings.nodePath?.trim() || undefined) : prev.nodePath,
    npmRegistry: settings.npmRegistry !== undefined ? (settings.npmRegistry?.trim() || undefined) : prev.npmRegistry,
    nvmNodeMirror: settings.nvmNodeMirror !== undefined ? (settings.nvmNodeMirror?.trim() || undefined) : prev.nvmNodeMirror,
    nvmDefaultVersion: settings.nvmDefaultVersion !== undefined ? (settings.nvmDefaultVersion?.trim() || undefined) : prev.nvmDefaultVersion,
    wizardCompleted: settings.wizardCompleted !== undefined ? settings.wizardCompleted : prev.wizardCompleted,
    openclawPackageVersion: settings.openclawPackageVersion !== undefined ? (settings.openclawPackageVersion?.trim() || undefined) : prev.openclawPackageVersion,
    ollamaChatModel: settings.ollamaChatModel !== undefined ? (settings.ollamaChatModel?.trim() || undefined) : prev.ollamaChatModel,
    chatBackend: settings.chatBackend !== undefined ? settings.chatBackend : prev.chatBackend,
    gatewayChatTimeoutSec: settings.gatewayChatTimeoutSec !== undefined
      ? (typeof settings.gatewayChatTimeoutSec === 'number' && Number.isFinite(settings.gatewayChatTimeoutSec)
          ? Math.min(GATEWAY_CHAT_TIMEOUT_SEC_MAX, Math.max(GATEWAY_CHAT_TIMEOUT_SEC_MIN, Math.round(settings.gatewayChatTimeoutSec)))
          : undefined)
      : prev.gatewayChatTimeoutSec,
    guiEnabled: settings.guiEnabled !== undefined ? settings.guiEnabled : prev.guiEnabled,
    guiAllowApps: settings.guiAllowApps !== undefined ? (settings.guiAllowApps?.trim() || undefined) : prev.guiAllowApps,
    guiRequireConfirmForDangerous: settings.guiRequireConfirmForDangerous !== undefined
      ? settings.guiRequireConfirmForDangerous
      : prev.guiRequireConfirmForDangerous,
  };
  await fs.promises.writeFile(p, JSON.stringify(merged, null, 2), 'utf8');
  if (merged.npmRegistry) {
    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const pathEnv = await getPathEnvAsync(merged);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      await promisify(execFile)(npm, ['config', 'set', 'registry', merged.npmRegistry], {
        env: pathEnv,
        timeout: 5000,
      });
    } catch {
      // ignore
    }
  }
}

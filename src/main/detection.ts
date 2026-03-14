import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebContents } from 'electron';
import { getPathEnvForNode } from './settings';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 12000;
const HTTP_TIMEOUT_MS = 10000;

const SUPPORTED_PLATFORMS: Record<string, string[]> = {
  win32: ['x64', 'arm64'],
  darwin: ['x64', 'arm64'],
  linux: ['x64', 'arm64'],
};

export interface StepResult {
  ok: boolean;
  message?: string;
  version?: string;
  path?: string;
  registry?: string;
  error?: string;
}

export interface DetectionReport {
  env: StepResult;
  node: StepResult;
  npm: StepResult;
  openclaw: StepResult;
  daemon: StepResult;
  config: StepResult;
  ollama: StepResult;
  canEnterGuide: boolean;
  firstFailingStep: string | null;
}

function sendProgress(webContents: WebContents | null, step: string, message: string): void {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send('detection-progress', { step, message });
  }
}

function runEnv(): StepResult {
  const platform = process.platform as string;
  const arch = process.arch;
  const supported = SUPPORTED_PLATFORMS[platform]?.includes(arch);
  return {
    ok: !!supported,
    message: supported ? `${platform} / ${arch}` : `不支持的平台或架构: ${platform} / ${arch}`,
    error: supported ? undefined : `当前系统 ${platform} (${arch}) 不在支持列表中`,
  };
}

async function runNode(
  webContents: WebContents | null,
  pathEnv: NodeJS.ProcessEnv
): Promise<StepResult> {
  sendProgress(webContents, 'node', '正在检测 Node.js…');
  try {
    const { stdout } = await execFileAsync('node', ['-v'], {
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      env: pathEnv,
    });
    const raw = (stdout || '').trim();
    const match = raw.match(/v?(\d+)\.(\d+)/);
    if (!match) {
      return { ok: false, version: raw, error: '无法解析 Node 版本' };
    }
    const major = parseInt(match[1], 10);
    if (major < 22) {
      return { ok: false, version: raw, error: `需要 Node.js 22+，当前: ${raw}` };
    }
    let nodePath: string | undefined;
    try {
      const { stdout: pathOut } = await execFileAsync('node', ['-p', 'process.execPath'], {
        encoding: 'utf8',
        timeout: 3000,
        env: pathEnv,
      });
      nodePath = (pathOut || '').trim();
    } catch {
      // ignore
    }
    return { ok: true, version: raw, path: nodePath };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    const msg = err?.message || String(e);
    return { ok: false, error: msg.includes('ENOENT') ? '未找到 Node，请先安装 Node.js 22+' : msg };
  }
}

async function runNpm(
  webContents: WebContents | null,
  pathEnv: NodeJS.ProcessEnv
): Promise<StepResult> {
  sendProgress(webContents, 'npm', '正在检测 npm…');
  try {
    const { stdout: versionOut } = await execFileAsync('npm', ['-v'], {
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      env: pathEnv,
    });
    const version = (versionOut || '').trim();
    let registry = '';
    try {
      const { stdout: regOut } = await execFileAsync('npm', ['config', 'get', 'registry'], {
        encoding: 'utf8',
        timeout: 5000,
        env: pathEnv,
      });
      registry = (regOut || '').trim();
    } catch {
      // ignore
    }
    return { ok: true, version, registry: registry || undefined };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    const msg = err?.message || String(e);
    return { ok: false, error: msg.includes('ENOENT') ? '未找到 npm（通常随 Node 安装）' : msg };
  }
}

async function runOpenClaw(
  webContents: WebContents | null,
  pathEnv: NodeJS.ProcessEnv
): Promise<StepResult> {
  sendProgress(webContents, 'openclaw', '正在检测 OpenClaw CLI…');
  const cmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  try {
    const { stdout } = await execFileAsync(cmd, ['-v'], {
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      env: pathEnv,
    });
    const version = (stdout || '').trim();
    return { ok: true, version: version || '已安装' };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    const msg = err?.message || String(e);
    return { ok: false, error: msg.includes('ENOENT') ? '未检测到 OpenClaw，需执行 npm install -g openclaw' : msg };
  }
}

async function httpGet(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, method: 'GET' });
    return res.ok || res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function runDaemon(webContents: WebContents | null): Promise<StepResult> {
  sendProgress(webContents, 'daemon', '正在检测 OpenClaw Daemon…');
  const ok = await httpGet('http://127.0.0.1:18789', HTTP_TIMEOUT_MS);
  return ok
    ? { ok: true, message: '网关已运行' }
    : { ok: false, error: '未检测到 OpenClaw 网关。请点击「由本应用启动网关」或执行 openclaw onboard --install-daemon' };
}

async function runConfig(webContents: WebContents | null): Promise<StepResult> {
  sendProgress(webContents, 'config', '正在检测配置文件…');
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    await fs.promises.access(configPath, fs.constants.R_OK);
    const raw = await fs.promises.readFile(configPath, 'utf8');
    let hasContent = false;
    try {
      const json = JSON.parse(raw);
      hasContent = json && typeof json === 'object';
    } catch {
      hasContent = raw.length > 0;
    }
    return { ok: true, path: configPath, message: hasContent ? '配置文件存在' : '配置文件为空或格式异常' };
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return { ok: false, path: configPath, error: '未找到配置文件，需在引导中创建或运行 openclaw configure' };
    }
    return { ok: false, path: configPath, error: (err as Error)?.message || String(e) };
  }
}

async function runOllama(webContents: WebContents | null): Promise<StepResult> {
  sendProgress(webContents, 'ollama', '正在检测 Ollama（可选）…');
  const ok = await httpGet('http://127.0.0.1:11434', HTTP_TIMEOUT_MS);
  return ok ? { ok: true, message: 'Ollama 已运行' } : { ok: false, message: '未检测到 Ollama，可选' };
}

export interface DetectionOptions {
  nodePath?: string;
  /** 若由主进程传入已解析的 pathEnv，则优先使用，否则根据 nodePath 解析 */
  pathEnv?: NodeJS.ProcessEnv;
}

export async function runDetection(
  webContents: WebContents | null,
  options?: DetectionOptions
): Promise<DetectionReport> {
  const pathEnv = options?.pathEnv ?? getPathEnvForNode(options?.nodePath) ?? process.env;
  const env = runEnv();
  const node = await runNode(webContents, pathEnv);
  const npm = await runNpm(webContents, pathEnv);
  const openclaw = await runOpenClaw(webContents, pathEnv);
  const daemon = await runDaemon(webContents);
  const config = await runConfig(webContents);
  const ollama = await runOllama(webContents);

  const steps = [
    { key: 'env', ok: env.ok },
    { key: 'node', ok: node.ok },
    { key: 'npm', ok: npm.ok },
    { key: 'openclaw', ok: openclaw.ok },
    { key: 'daemon', ok: daemon.ok },
    { key: 'config', ok: config.ok },
  ];
  const firstFailing = steps.find((s) => !s.ok);
  const canEnterGuide = env.ok; // 仅当运行环境支持时才允许进入引导

  return {
    env,
    node,
    npm,
    openclaw,
    daemon,
    config,
    ollama,
    canEnterGuide,
    firstFailingStep: firstFailing ? firstFailing.key : null,
  };
}

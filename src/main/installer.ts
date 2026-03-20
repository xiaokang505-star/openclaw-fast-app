import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { shell } from 'electron';
import * as os from 'os';
import * as path from 'path';
import { WebContents } from 'electron';
import { getSettings, getPathEnvAsync } from './settings';
import { getGatewayChatConfig, isCurrentPortServingGateway } from './openclaw-chat';
import { ensureGatewayChatCompletionsEnabled, getOpenClawConfigPath } from './openclaw-config';

/** 由本应用启动的网关子进程（未调用 install-daemon，兼容性更好） */
let gatewayChild: ChildProcess | null = null;

/** 打开 Node 官方下载页，由用户选择对应平台与 LTS 版本（需 Node 22+） */
function getNodeDownloadUrl(): string {
  return 'https://nodejs.org/en/download/';
}

export function getNodeDownloadUrlHandler(): string {
  return getNodeDownloadUrl();
}

export function openConfigDirHandler(): Promise<{ success: boolean; error?: string }> {
  const dir = path.join(os.homedir(), '.openclaw');
  return shell.openPath(dir).then((err) => ({
    success: !err,
    error: err || undefined,
  }));
}

export async function installOpenClawHandler(
  webContents: WebContents | null
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const settings = await getSettings();
  const pathEnv = await getPathEnvAsync(settings);
  const version = settings.openclawPackageVersion?.trim() || 'latest';
  const pkg = version === 'latest' ? 'openclaw@latest' : `openclaw@${version}`;
  return new Promise((resolve) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(npm, ['install', '-g', pkg], {
      env: pathEnv,
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stdout += s;
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('install-openclaw-progress', { type: 'stdout', data: s });
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      stderr += s;
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('install-openclaw-progress', { type: 'stderr', data: s });
      }
    });
    child.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr,
        error: err.message,
      });
    });
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        error: code !== 0 ? `进程退出码: ${code}` : undefined,
      });
    });
  });
}

export async function installDaemonHandler(): Promise<{
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const settings = await getSettings();
  const pathEnv = await getPathEnvAsync(settings);
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
    const child = spawn(cmd, ['onboard', '--install-daemon'], {
      env: { ...pathEnv, CI: '1' },
      shell: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      resolve({
        success: false,
        stdout,
        stderr,
        error: err.message,
      });
    });
    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr,
        error: code !== 0 ? `进程退出码: ${code}` : undefined,
      });
    });
  });
}

const GATEWAY_START_WAIT_MS = 25000;

/** OpenClaw 网关运行时要求 Node >=22.16（与 CLI 入口的 22.12 校验可能不一致） */
function gatewayLogHint(tail: string): string {
  if (/Node\s*>=?\s*22\.16|requires Node >=22\.16/i.test(tail)) {
    return (
      '\n\n提示：当前全局 OpenClaw 要求 Node.js 22.16.0 或更高。若在终端执行 `node -v` 低于 22.16，请用 nvm 升级：' +
      '`nvm install 22`（或 `nvm install node`）后 `nvm alias default 22`，再在应用「设置」中填写 Node 可执行文件路径并保存，然后重新「由本应用启动网关」。'
    );
  }
  return '';
}

/** 由本应用直接启动网关进程（不安装系统 Daemon，兼容性更好；关闭应用后网关会停止） */
export async function startGatewayInProcessHandler(): Promise<{
  success: boolean;
  error?: string;
  alreadyRunning?: boolean;
}> {
  if (gatewayChild) {
    try {
      const servingApi = await isCurrentPortServingGateway();
      if (servingApi) return { success: true, alreadyRunning: true };
    } catch {
      // ignore
    }
    gatewayChild.kill('SIGTERM');
    gatewayChild = null;
  }

  const settings = await getSettings();
  const pathEnv = await getPathEnvAsync(settings);
  let port = 18789;
  try {
    const cfg = await getGatewayChatConfig();
    port = cfg.port;
  } catch {
    // use default
  }

  // 若端口已被其他 OpenClaw 网关占用（如 launchctl 管理的服务），先执行 openclaw gateway stop 释放端口
  const stopCmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  spawnSync(stopCmd, ['gateway', 'stop'], { env: { ...pathEnv }, timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1500));

  try {
    await ensureGatewayChatCompletionsEnabled(port);
  } catch (e) {
    return { success: false, error: '写入配置失败: ' + (e as Error).message };
  }

  const cmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  const args = ['gateway', '--port', String(port), '--allow-unconfigured', '--force'];
  try {
    gatewayChild = spawn(cmd, args, {
      env: {
        ...pathEnv,
        OPENCLAW_GATEWAY_PORT: String(port),
        OPENCLAW_CONFIG_PATH: getOpenClawConfigPath(),
      },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  if (!gatewayChild) return { success: false, error: '启动失败' };

  let gatewayStderr = '';
  let gatewayStdout = '';
  let gatewayExited = false;
  let gatewayExitCode: number | null = null;
  gatewayChild.stdout?.on('data', (chunk: Buffer | string) => {
    gatewayStdout += chunk.toString();
  });
  gatewayChild.stderr?.on('data', (chunk: Buffer | string) => {
    gatewayStderr += chunk.toString();
  });
  gatewayChild.on('error', () => {});
  gatewayChild.on('exit', (code) => {
    gatewayExited = true;
    gatewayExitCode = code;
    gatewayChild = null;
  });
  gatewayChild.unref();

  const deadline = Date.now() + GATEWAY_START_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (gatewayExited && gatewayExitCode !== 0) {
      const tail = gatewayStderr.trim() || gatewayStdout.trim();
      const logSnippet = tail ? `\n\n网关进程输出（最后 600 字）：\n${tail.slice(-600)}` : '';
      const hint = gatewayLogHint(tail);
      return {
        success: false,
        error: `网关进程已退出，退出码: ${gatewayExitCode}。${logSnippet || ' 请在终端运行 openclaw gateway --port ' + port + ' --allow-unconfigured 查看完整启动日志。'}${hint}`,
      };
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }).catch(() => null);
      if (res !== null && res.ok) return { success: true };
    } catch {
      // retry
    }
  }
  const tail = gatewayStderr.trim() || gatewayStdout.trim();
  const logSnippet = tail ? `\n\n网关进程输出（最后 600 字）：\n${tail.slice(-600)}` : '';
  const hint = gatewayLogHint(tail);
  return {
    success: false,
    error: `网关在 ${GATEWAY_START_WAIT_MS / 1000} 秒内未在端口 ${port} 响应。请检查：1) 端口是否被占用（终端运行 lsof -i :${port}）；2) openclaw 是否安装正常（终端运行 openclaw gateway --port ${port} --allow-unconfigured 查看启动日志）；3) 若网关启动较慢可稍后重试。${logSnippet}${hint}`,
  };
}

/** 停止由本应用启动的网关进程；若本应用未启动过网关，也会尝试执行 openclaw gateway stop 以停止系统/其它方式启动的网关 */
export async function stopGatewayInProcessHandler(): Promise<{ success: boolean }> {
  if (gatewayChild) {
    try {
      gatewayChild.kill('SIGTERM');
      gatewayChild = null;
      return { success: true };
    } catch {
      return { success: false };
    }
  }
  const pathEnv = await getPathEnvAsync(await getSettings());
  const stopCmd = process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw';
  spawnSync(stopCmd, ['gateway', 'stop'], { env: { ...pathEnv }, timeout: 8000 });
  return { success: true };
}

/** 应用退出时清理网关子进程 */
export function disposeGatewayProcess(): void {
  if (gatewayChild) {
    try {
      gatewayChild.kill('SIGTERM');
    } catch {
      // ignore
    }
    gatewayChild = null;
  }
}

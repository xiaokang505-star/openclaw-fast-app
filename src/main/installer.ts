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

/** 冷启动或首次拉模型时网关可能较慢；过短易误报「未响应」 */
const GATEWAY_START_WAIT_MS = 90_000;

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
  /** spawn 失败（如 ENOENT）时仅有 error 事件，不会走 exit；勿吞掉否则会一直等到超时。用 ref 避免 TS 在 while 内误判 let 始终为 null（回调赋值不参与控制流分析）。 */
  const gatewaySpawnFail = { current: null as { message: string; code?: string } | null };
  gatewayChild.stdout?.on('data', (chunk: Buffer | string) => {
    gatewayStdout += chunk.toString();
  });
  gatewayChild.stderr?.on('data', (chunk: Buffer | string) => {
    gatewayStderr += chunk.toString();
  });
  gatewayChild.on('error', (err: NodeJS.ErrnoException) => {
    gatewaySpawnFail.current = { message: err.message, code: err.code };
    gatewayChild = null;
  });
  gatewayChild.on('exit', (code) => {
    gatewayExited = true;
    gatewayExitCode = code;
    gatewayChild = null;
  });
  gatewayChild.unref();

  const deadline = Date.now() + GATEWAY_START_WAIT_MS;
  let pollTicks = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    pollTicks += 1;
    const spawnErr = gatewaySpawnFail.current;
    if (spawnErr) {
      const hint =
        spawnErr.code === 'ENOENT'
          ? '\n\n未找到 openclaw 命令。请：(1) 终端执行 `npm install -g openclaw`；(2) 在应用「设置」中填写本机 Node 可执行文件路径并保存——从访达启动时默认 PATH 往往不含 npm 全局目录，会导致子进程找不到 CLI。可用终端 `which openclaw` 确认安装位置。'
          : '';
      return {
        success: false,
        error: `无法启动网关进程：${spawnErr.message}。${hint}`,
      };
    }
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
      // 任意 HTTP 响应（含 404）均表示端口已有服务在监听；OpenClaw 对 GET / 可能非 2xx，勿用 res.ok 误判
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (res !== null) return { success: true };
      // 部分版本根路径较晚就绪，但 /v1/models 或 chat/completions 已可用——用与对话一致的探测避免误报超时
      if (pollTicks % 4 === 0 && (await isCurrentPortServingGateway())) {
        return { success: true };
      }
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

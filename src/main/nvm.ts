import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebContents } from 'electron';

const NVM_DIR_DEFAULT = path.join(os.homedir(), '.nvm');
const NVM_INSTALL_URL = 'https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh';

function getNvmDir(): string {
  return process.env.NVM_DIR || NVM_DIR_DEFAULT;
}

function getNvmSh(): string {
  return path.join(getNvmDir(), 'nvm.sh');
}

/** 是否已安装 nvm（仅 Unix：存在 nvm.sh） */
export function isNvmInstalled(): boolean {
  if (process.platform === 'win32') {
    return false; // Windows 使用 nvm-windows，需单独处理
  }
  try {
    return fs.existsSync(getNvmSh());
  } catch {
    return false;
  }
}

/** 在已 source nvm 的 shell 中执行命令，返回 stdout */
function runNvmScript(
  script: string,
  extraEnv: NodeJS.ProcessEnv = {},
  timeoutMs = 60000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const nvmSh = getNvmSh();
    const fullScript = `source "${nvmSh}" 2>/dev/null; ${script}`;
    const child = spawn(
      process.platform === 'darwin' ? 'bash' : 'bash',
      ['-c', fullScript],
      {
        env: { ...process.env, ...extraEnv },
        cwd: os.homedir(),
      }
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ stdout, stderr, code: -1 });
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ stdout, stderr, code: code ?? -1 });
    });
    child.on('error', () => resolve({ stdout, stderr, code: -1 }));
  });
}

/** 安装 nvm（仅 Unix：拉取 install.sh 并执行，不 source nvm） */
export async function installNvm(
  webContents: WebContents | null,
  nodeMirror?: string
): Promise<{ success: boolean; error?: string }> {
  if (process.platform === 'win32') {
    return { success: false, error: 'Windows 请使用 nvm-windows，请从 https://github.com/coreybutler/nvm-windows 下载安装' };
  }
  const send = (msg: string) => {
    if (webContents && !webContents.isDestroyed()) webContents.send('nvm-progress', msg);
  };
  send('正在下载 nvm 安装脚本…');
  const env: NodeJS.ProcessEnv = { NVM_DIR: getNvmDir(), PROFILE: '/dev/null' };
  if (nodeMirror) env.NVM_NODEJS_ORG_MIRROR = nodeMirror;
  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', `curl -sSf "${NVM_INSTALL_URL}" | bash`], {
      env: { ...process.env, ...env },
      cwd: os.homedir(),
    });
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    const t = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ success: false, error: '安装超时' });
    }, 120000);
    child.on('close', (code) => {
      clearTimeout(t);
      if (code !== 0) resolve({ success: false, error: stderr || '安装失败' });
      else if (!fs.existsSync(getNvmSh())) resolve({ success: false, error: 'nvm.sh 未找到' });
      else resolve({ success: true });
    });
    child.on('error', (e) => resolve({ success: false, error: e.message }));
  });
}

/** 可选的 Node 版本列表（LTS + 最新 22） */
export const SUGGESTED_NODE_VERSIONS = ['22', '20', '18'];

/** 通过 nvm 安装指定 Node 版本 */
export async function nvmInstallVersion(
  version: string,
  nodeMirror?: string,
  webContents?: WebContents | null
): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const send = (msg: string) => {
    if (webContents && !webContents.isDestroyed()) webContents.send('nvm-progress', msg);
  };
  send(`正在安装 Node ${version}…`);
  const env: NodeJS.ProcessEnv = {};
  if (nodeMirror) env.NVM_NODEJS_ORG_MIRROR = nodeMirror;
  const { stdout, stderr, code } = await runNvmScript(`nvm install ${version}`, env, 300000);
  if (code !== 0) return { success: false, stdout, stderr, error: stderr || '安装失败' };
  return { success: true, stdout, stderr };
}

/** 设置 nvm 默认版本 */
export async function nvmAliasDefault(version: string): Promise<{ success: boolean; error?: string }> {
  const { stderr, code } = await runNvmScript(`nvm alias default ${version}`);
  return { success: code === 0, error: code !== 0 ? stderr : undefined };
}

/** 已安装的 Node 版本列表（nvm list 解析） */
export async function nvmListInstalled(): Promise<string[]> {
  const { stdout } = await runNvmScript('nvm list --no-alias 2>/dev/null');
  const versions: string[] = [];
  const re = /v(\d+\.\d+\.\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stdout)) !== null) versions.push(m[1]);
  return [...new Set(versions)].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

/** 当前 default 对应的 node 可执行文件路径，用于 PATH */
export async function nvmWhichDefault(): Promise<string | null> {
  const { stdout, code } = await runNvmScript('nvm which default 2>/dev/null');
  if (code !== 0) return null;
  const p = stdout.trim();
  return p && fs.existsSync(p) ? p : null;
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

export type LlvStrategy = 'round_robin' | 'least_inflight' | 'weighted';

export interface LlvTargetConfig {
  id: string;
  baseUrl: string;
  weight: number;
  enabled: boolean;
  apiKey?: string;
}

export interface LlvOllamaConfig {
  enabled: boolean;
  listenHost: string;
  listenPort: number;
  strategy: LlvStrategy;
  stickyByModel: boolean;
  aggregateModels: boolean;
  healthIntervalSec: number;
  healthTimeoutMs: number;
  healthFailThreshold: number;
  targets: LlvTargetConfig[];
}

const DEFAULT_CONFIG: LlvOllamaConfig = {
  enabled: false,
  listenHost: '127.0.0.1',
  listenPort: 11435,
  strategy: 'least_inflight',
  stickyByModel: false,
  aggregateModels: true,
  healthIntervalSec: 15,
  healthTimeoutMs: 3000,
  healthFailThreshold: 3,
  targets: [{ id: 'local-1', baseUrl: 'http://127.0.0.1:11434', weight: 1, enabled: true }],
};

let llvChild: ChildProcess | null = null;
let llvLastError = '';

function getConfigPath(): string {
  return path.join(os.homedir(), '.openclaw', 'llv-ollama.json');
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalizeTarget(raw: Partial<LlvTargetConfig> | undefined, idx: number): LlvTargetConfig {
  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id.trim() : `target-${idx + 1}`,
    baseUrl: typeof raw?.baseUrl === 'string' ? raw.baseUrl.trim() : '',
    weight: clampInt(raw?.weight, 1, 100, 1),
    enabled: raw?.enabled !== false,
    apiKey: typeof raw?.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : undefined,
  };
}

export function normalizeLlvOllamaConfig(raw?: Partial<LlvOllamaConfig> | null): LlvOllamaConfig {
  const strategy: LlvStrategy =
    raw?.strategy === 'round_robin' || raw?.strategy === 'weighted' || raw?.strategy === 'least_inflight'
      ? raw.strategy
      : DEFAULT_CONFIG.strategy;

  const targets = Array.isArray(raw?.targets) ? raw!.targets.map((t, i) => normalizeTarget(t, i)) : DEFAULT_CONFIG.targets;

  return {
    enabled: raw?.enabled === true,
    listenHost: typeof raw?.listenHost === 'string' && raw.listenHost.trim() ? raw.listenHost.trim() : DEFAULT_CONFIG.listenHost,
    listenPort: clampInt(raw?.listenPort, 1024, 65535, DEFAULT_CONFIG.listenPort),
    strategy,
    stickyByModel: raw?.stickyByModel === true,
    aggregateModels: raw?.aggregateModels !== false,
    healthIntervalSec: clampInt(raw?.healthIntervalSec, 5, 120, DEFAULT_CONFIG.healthIntervalSec),
    healthTimeoutMs: clampInt(raw?.healthTimeoutMs, 500, 10000, DEFAULT_CONFIG.healthTimeoutMs),
    healthFailThreshold: clampInt(raw?.healthFailThreshold, 1, 10, DEFAULT_CONFIG.healthFailThreshold),
    targets: targets.length ? targets : DEFAULT_CONFIG.targets,
  };
}

export async function getLlvOllamaConfig(): Promise<LlvOllamaConfig> {
  try {
    const p = getConfigPath();
    const raw = await fs.promises.readFile(p, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LlvOllamaConfig>;
    return normalizeLlvOllamaConfig(parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function setLlvOllamaConfig(next: Partial<LlvOllamaConfig>): Promise<LlvOllamaConfig> {
  const prev = await getLlvOllamaConfig();
  const merged = normalizeLlvOllamaConfig({ ...prev, ...next });
  const p = getConfigPath();
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function isLlvRunning(): boolean {
  return Boolean(llvChild && !llvChild.killed);
}

export function getLlvOllamaProcessStatus(): { running: boolean; pid?: number; lastError?: string } {
  return {
    running: isLlvRunning(),
    pid: llvChild?.pid,
    lastError: llvLastError || undefined,
  };
}

export async function startLlvOllamaProcess(pathEnv: NodeJS.ProcessEnv): Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }> {
  if (isLlvRunning()) return { success: true, alreadyRunning: true };

  const cfg = await getLlvOllamaConfig();
  const configPath = getConfigPath();
  await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
  await fs.promises.writeFile(configPath, JSON.stringify(cfg, null, 2), 'utf8');

  const cmd = process.platform === 'win32' ? 'llv-ollama.cmd' : 'llv-ollama';
  const args = ['serve', '--config', configPath];
  llvLastError = '';
  try {
    llvChild = spawn(cmd, args, {
      env: { ...pathEnv },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  llvChild.stdout?.on('data', () => {
    // keep process output attached for future diagnostics
  });
  llvChild.stderr?.on('data', (chunk: Buffer | string) => {
    llvLastError = chunk.toString().slice(-600);
  });
  llvChild.on('error', (err: NodeJS.ErrnoException) => {
    llvLastError = err.message;
    llvChild = null;
  });
  llvChild.on('exit', (code) => {
    if (code !== 0) llvLastError = llvLastError || `llv-ollama 退出码: ${code}`;
    llvChild = null;
  });
  llvChild.unref();
  return { success: true };
}

export function stopLlvOllamaProcess(): { success: boolean } {
  if (!llvChild) return { success: true };
  try {
    llvChild.kill('SIGTERM');
    llvChild = null;
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function probeLlvTarget(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const url = baseUrl.replace(/\/+$/, '') + '/api/tags';
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(3500) });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

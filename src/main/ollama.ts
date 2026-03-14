import { app } from 'electron';
import type { WebContents } from 'electron';
import ElectronOllama from 'electron-ollama';

let eo: InstanceType<typeof ElectronOllama> | null = null;

function getOllama(): InstanceType<typeof ElectronOllama> {
  if (!eo) {
    eo = new ElectronOllama({
      basePath: app.getPath('userData'),
      directory: 'ollama',
    });
  }
  return eo;
}

/** 检测 Ollama 是否已在运行（本机或 electron-ollama 启动的） */
export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 通过 electron-ollama 启动 Ollama；若已在运行则直接返回成功 */
export async function ensureOllamaServe(
  webContents: WebContents | null,
  options?: { timeoutSec?: number }
): Promise<{ success: boolean; error?: string }> {
  if (await isOllamaRunning()) return { success: true };
  try {
    const ollama = getOllama();
    const meta = await ollama.getMetadata('latest');
    const version = meta?.version ?? 'latest';
    const send = (msg: string) => {
      if (webContents && !webContents.isDestroyed()) webContents.send('ollama-serve-progress', msg);
    };
    await ollama.serve(version, {
      serverLog: (m) => send(m),
      downloadLog: (p, m) => send(`${Math.round(p)}% ${m}`),
      timeoutSec: options?.timeoutSec ?? 120,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** 获取已安装的模型列表（Ollama /api/tags） */
export async function listOllamaModels(): Promise<{ name: string; digest?: string }[]> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string; digest?: string }> };
    return data?.models ?? [];
  } catch {
    return [];
  }
}

/** 获取 Ollama 运行状态与当前已加载模型（/api/ps），用于判断请求是否到达 Ollama */
export async function getOllamaStatus(): Promise<{ running: boolean; loadedModels: string[] }> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { running: false, loadedModels: [] };
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = data?.models ?? [];
    const loadedModels = models.map((m) => m.name ?? m.model ?? '').filter(Boolean);
    return { running: true, loadedModels };
  } catch {
    return { running: false, loadedModels: [] };
  }
}

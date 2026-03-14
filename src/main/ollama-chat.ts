import type { WebContents } from 'electron';

const OLLAMA_HOST = 'http://127.0.0.1:11434';

/** 请求时传给 Ollama 的 options，减小上下文与生成长度以提升速度（仍保留足够对话空间） */
const OLLAMA_SPEED_OPTIONS = {
  num_ctx: 8192,   // 上下文 token 上限，比默认 32k 小，推理更快
  num_predict: 2048, // 单次最多生成 token 数，避免过长回复拖慢
};

export interface OllamaChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 直接调用 Ollama /api/chat（非流式），返回助手回复内容或错误 */
export async function sendOllamaChat(
  messages: OllamaChatMessage[],
  model: string
): Promise<{ success: boolean; content?: string; error?: string }> {
  const url = `${OLLAMA_HOST}/api/chat`;
  const body = { model, messages, stream: false, options: OLLAMA_SPEED_OPTIONS };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { message?: { content?: string }; error?: string };
    if (data.error) return { success: false, error: data.error };
    const content = data?.message?.content ?? '';
    return { success: true, content };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

function isEndMarker(s: string): boolean {
  const t = s.replace(/\uFEFF/g, '').replace(/\r/g, '').trim().toLowerCase();
  return t === 'terminated' || t === '[done]';
}

/** 流式调用 Ollama /api/chat，向 webContents 发送 chat-stream-delta 与 chat-stream-done。过滤结束标记 "terminated"/"[done]" 不转发。 */
export async function sendOllamaChatStream(
  webContents: WebContents | null,
  messages: OllamaChatMessage[],
  model: string
): Promise<{ success: boolean; error?: string }> {
  const url = `${OLLAMA_HOST}/api/chat`;
  const body = { model, messages, stream: true, options: OLLAMA_SPEED_OPTIONS };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let pendingDelta = '';
    const flush = (s: string) => {
      if (s && webContents && !webContents.isDestroyed()) webContents.send('chat-stream-delta', s);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const data = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
          let delta = data?.message?.content;
          if (delta != null && typeof delta === 'string') {
            const n = delta.replace(/\uFEFF/g, '').replace(/\r/g, '');
            const t = n.trim().toLowerCase();
            if (t === 'terminated' || t === '[done]') delta = '';
            else if (/\n\s*(terminated|\[done\])\s*$/i.test(n)) delta = n.replace(/\n\s*(terminated|\[done\])\s*$/i, '').trimEnd();
          }
          if (data?.done && webContents && !webContents.isDestroyed()) {
            if (pendingDelta && !isEndMarker(pendingDelta)) flush(pendingDelta);
            pendingDelta = '';
            webContents.send('chat-stream-done', {});
          }
          if (delta === '') continue;
          const combined = pendingDelta + delta;
          if (isEndMarker(combined)) {
            pendingDelta = '';
            continue;
          }
          if (/\n\s*(terminated|\[done\])\s*$/i.test(combined)) {
            const safe = combined.replace(/\n\s*(terminated|\[done\])\s*$/i, '').trimEnd();
            if (safe.length > 0) flush(safe);
            pendingDelta = '';
            continue;
          }
          if (pendingDelta) {
            flush(pendingDelta);
            pendingDelta = '';
          }
          if (typeof delta !== 'string' || isEndMarker(delta)) continue;
          pendingDelta = delta;
        } catch {
          // ignore parse
        }
      }
    }
    if (pendingDelta && !isEndMarker(pendingDelta)) flush(pendingDelta);
    if (webContents && !webContents.isDestroyed()) webContents.send('chat-stream-done', {});
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

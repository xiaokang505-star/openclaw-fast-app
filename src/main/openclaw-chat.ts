import * as fs from 'fs';
import { WebContents } from 'electron';
import { listOllamaModels, isOllamaRunning } from './ollama';
import { readOpenClawConfig, getFormConfigFromRaw, getOpenClawConfigPath, parseJsonLenient } from './openclaw-config';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** 将 fetch 抛出的错误转为用户可读的提示 */
function formatFetchError(e: unknown, port: number): string {
  const err = e as Error & { cause?: { code?: string }; code?: string };
  const code = err.cause?.code ?? err.code ?? '';
  const msg = err.message || String(e);
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.toLowerCase().includes('fetch failed')) {
    return `无法连接到 OpenClaw 网关（127.0.0.1:${port}）。请先在设置中点击「由本应用启动网关」或确保 Daemon 已启动。`;
  }
  if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('Timeout')) {
    return `连接网关超时或不可达（端口 ${port}）。请确认网关已启动。`;
  }
  return msg || '请求失败，请确认网关已启动。';
}

/** 从 openclaw.json 读取网关端口与鉴权 token（用于 Chat Completions） */
export async function getGatewayChatConfig(): Promise<{
  port: number;
  token: string | null;
  chatEnabled: boolean;
}> {
  const config = await readOpenClawConfig();
  const gw = config?.gateway as { port?: number; auth?: { token?: string }; http?: { endpoints?: { chatCompletions?: { enabled?: boolean } } } } | undefined;
  const port = typeof gw?.port === 'number' ? gw.port : 18789;
  const token = typeof gw?.auth?.token === 'string' ? gw.auth.token : null;
  const chatEnabled = gw?.http?.endpoints?.chatCompletions?.enabled !== false;
  return { port, token, chatEnabled };
}

/** 检测网关是否可达（请求根路径） */
async function isGatewayReachable(): Promise<boolean> {
  try {
    const { port } = await getGatewayChatConfig();
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(body: string): boolean {
  const t = body.trim().toLowerCase();
  return t.startsWith('<!') || t.startsWith('<html');
}

/** 请求网关 GET /v1/models，返回模型 id 列表；失败或响应为 HTML 返回 null */
async function fetchGatewayModelsList(): Promise<string[] | null> {
  try {
    const { port, token } = await getGatewayChatConfig();
    const url = `http://127.0.0.1:${port}/v1/models`;
    const headers: Record<string, string> = { 'x-openclaw-agent-id': 'main' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const rawBody = await res.text();
    if (looksLikeHtml(rawBody)) return null;
    const data = JSON.parse(rawBody) as { data?: Array<{ id?: string }> };
    const list = data?.data ?? [];
    return list.map((m) => (m?.id ?? '')).filter(Boolean);
  } catch {
    return null;
  }
}

/** 检测 POST /v1/chat/completions 是否返回 API 响应（非 HTML）。OpenClaw 官方仅提供该端点，不保证提供 /v1/models */
async function postChatCompletionsReturnsApi(): Promise<boolean> {
  try {
    const { port, token } = await getGatewayChatConfig();
    const url = `http://127.0.0.1:${port}/v1/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': 'main',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'openclaw', messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(5000),
    });
    const rawBody = await res.text();
    if (looksLikeHtml(rawBody)) return false;
    return true;
  } catch {
    return false;
  }
}

/** 当前配置的端口是否在提供 API 网关。优先用 /v1/models；若返回 HTML 则改用 POST /v1/chat/completions 检测（OpenClaw 仅文档化该端点） */
export async function isCurrentPortServingGateway(): Promise<boolean> {
  if ((await fetchGatewayModelsList()) !== null) return true;
  return postChatCompletionsReturnsApi();
}

/** 手动测试 GET /v1/models，若返回 HTML 则再测 POST /v1/chat/completions 并一并返回（OpenClaw 仅文档化 chat/completions）。timeoutMs 为 POST 检测超时，默认 95000 */
export async function testGatewayV1Models(timeoutMs = 95_000): Promise<{
  success: boolean;
  status?: number;
  statusText?: string;
  modelIds?: string[];
  rawBody?: string;
  error?: string;
  /** 当 GET /v1/models 为 HTML 时，额外检测 POST /v1/chat/completions 是否返回 API */
  chatCompletionsCheck?: { ok: boolean; status: number; bodyPreview: string };
  /** POST 返回 500 时的配置/模型诊断项 */
  diagnosticDetails?: string[];
}> {
  try {
    const { port, token } = await getGatewayChatConfig();
    const url = `http://127.0.0.1:${port}/v1/models`;
    const headers: Record<string, string> = { 'x-openclaw-agent-id': 'main' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    const rawBody = await res.text();
    const bodyPreview = rawBody.length > 800 ? rawBody.slice(0, 800) + '…' : rawBody;
    if (!res.ok) {
      return {
        success: false,
        status: res.status,
        statusText: res.statusText,
        rawBody: bodyPreview,
        error: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    if (looksLikeHtml(rawBody)) {
      let chatCompletionsCheck: { ok: boolean; status: number; bodyPreview: string } | undefined;
      try {
        const chatUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
        const chatHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': 'main',
        };
        if (token) chatHeaders['Authorization'] = `Bearer ${token}`;
        const chatRes = await fetch(chatUrl, {
          method: 'POST',
          headers: chatHeaders,
          body: JSON.stringify({ model: 'openclaw', messages: [{ role: 'user', content: 'hi' }] }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const chatBody = await chatRes.text();
        const preview = chatBody.length > 300 ? chatBody.slice(0, 300) + '…' : chatBody;
        const isJson = !looksLikeHtml(chatBody);
        const isSuccess = chatRes.status >= 200 && chatRes.status < 300;
        chatCompletionsCheck = {
          ok: isJson && isSuccess,
          status: chatRes.status,
          bodyPreview: preview,
        };
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        chatCompletionsCheck = { ok: false, status: 0, bodyPreview: errMsg ? `(请求异常: ${errMsg})` : '(请求异常)' };
      }
      const extra =
        chatCompletionsCheck?.ok === true
          ? ' 已额外检测：POST /v1/chat/completions 返回 200，对话 API 可用，可直接使用主界面对话。'
          : chatCompletionsCheck != null && chatCompletionsCheck.status === 500
            ? ' 已额外检测：POST /v1/chat/completions 返回 500（internal error），主界面对话会报同样错误；下方「500 诊断」可帮助排查。'
            : chatCompletionsCheck != null && chatCompletionsCheck.status === 0
              ? ` 已额外检测：POST /v1/chat/completions 在 ${Math.round(timeoutMs / 1000)} 秒内未返回。若直连 Ollama 有响应而经网关超时，说明网关未转发或卡住。请：1) 重新「一键应用本地模型」后「停止网关」再「由本应用启动网关」；2) 用「验证请求链」对比直连与网关耗时；3) 终端运行 openclaw gateway --verbose 后重试，观察网关是否向 Ollama 发请求。可在设置中调整「网关对话超时」后重试。`
              : chatCompletionsCheck != null
                ? ' 已额外检测：POST /v1/chat/completions 未返回有效 API，请确认 gateway.http.endpoints.chatCompletions.enabled 为 true 并重启网关。'
                : '';
      let diagnosticDetails: string[] | undefined;
      if (chatCompletionsCheck?.status === 500) {
        const diag = await getOpenClawGateway500Diagnostic();
        diagnosticDetails = diag.details;
      }
      return {
        success: false,
        status: res.status,
        statusText: res.statusText,
        rawBody: bodyPreview,
        error: `GET /v1/models 响应为 HTML（OpenClaw 官方未提供该接口，属正常）。${extra}`,
        chatCompletionsCheck,
        diagnosticDetails,
      };
    }
    let modelIds: string[] = [];
    try {
      const data = JSON.parse(rawBody) as { data?: Array<{ id?: string }> };
      const list = data?.data ?? [];
      modelIds = list.map((m) => (m?.id ?? '')).filter(Boolean);
    } catch {
      // 非 JSON 或格式不符
    }
    return {
      success: true,
      status: res.status,
      statusText: res.statusText,
      modelIds,
      rawBody: bodyPreview,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg, rawBody: undefined };
  }
}

/** 验证请求链：先直连 Ollama，再请求网关，分别返回耗时与成功与否，用于判断请求是否到达 Ollama */
export async function verifyRequestChain(): Promise<{
  ollama: { ok: boolean; ms: number; error?: string };
  gateway: { ok: boolean; ms: number; error?: string };
  model: string;
}> {
  const config = await readOpenClawConfig();
  const form = getFormConfigFromRaw(config);
  const model = form.defaultModel?.replace(/^ollama-local\/|^ollama\//, '').trim() || 'llama3.2';
  const ollamaUrl = 'http://127.0.0.1:11434/api/chat';
  const ollamaBody = JSON.stringify({ model, messages: [{ role: 'user', content: '1' }], stream: false });
  let ollamaOk = false;
  let ollamaMs = 0;
  let ollamaError: string | undefined;
  const t0 = Date.now();
  try {
    const res = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ollamaBody,
      signal: AbortSignal.timeout(15000),
    });
    ollamaMs = Date.now() - t0;
    ollamaOk = res.ok;
    if (!res.ok) ollamaError = await res.text().then((t) => t.slice(0, 150));
  } catch (e) {
    ollamaMs = Date.now() - t0;
    ollamaError = e instanceof Error ? e.message : String(e);
  }
  const { port, token } = await getGatewayChatConfig();
  const gwUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
  const gwHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'x-openclaw-agent-id': 'main' };
  if (token) gwHeaders['Authorization'] = `Bearer ${token}`;
  let gatewayOk = false;
  let gatewayMs = 0;
  let gatewayError: string | undefined;
  const t1 = Date.now();
  try {
    const res = await fetch(gwUrl, {
      method: 'POST',
      headers: gwHeaders,
      body: JSON.stringify({ model: 'openclaw', messages: [{ role: 'user', content: '1' }] }),
      signal: AbortSignal.timeout(25000),
    });
    gatewayMs = Date.now() - t1;
    const text = await res.text();
    gatewayOk = res.ok && !looksLikeHtml(text);
    if (!gatewayOk && !gatewayError) gatewayError = res.ok ? '响应非 JSON' : text.slice(0, 150);
  } catch (e) {
    gatewayMs = Date.now() - t1;
    gatewayError = e instanceof Error ? e.message : String(e);
  }
  return {
    ollama: { ok: ollamaOk, ms: ollamaMs, error: ollamaError },
    gateway: { ok: gatewayOk, ms: gatewayMs, error: gatewayError },
    model,
  };
}

/** 500 时诊断：配置的默认模型、Ollama 是否运行、本地模型是否已拉取、网关是否已加载配置 */
export async function getOpenClawGateway500Diagnostic(): Promise<{ summary: string; details: string[] }> {
  const details: string[] = [];
  let config = await readOpenClawConfig();
  let readError: NodeJS.ErrnoException | null = null;
  if (!config) {
    const configPath = getOpenClawConfigPath();
    try {
      const raw = await fs.promises.readFile(configPath, 'utf8');
      config = parseJsonLenient(raw);
    } catch (e) {
      readError = e as NodeJS.ErrnoException;
    }
  }
  const form = getFormConfigFromRaw(config);
  const defaultModel = form.defaultModel?.trim();

  if (!defaultModel) {
    if (!config) {
      const pathStr = getOpenClawConfigPath();
      if (readError?.code === 'ENOENT') {
        details.push(`openclaw.json 不存在（${pathStr}），请先完成配置或使用「一键应用本地模型」`);
      } else {
        details.push(`无法读取 openclaw.json（${readError?.message || '解析失败'}），路径: ${pathStr}`);
      }
    }
    details.push('未配置默认模型，请使用「一键应用本地模型」选择 Ollama 模型并应用');
  } else {
    details.push(`openclaw.json 中已配置默认模型：${defaultModel}`);
    if (defaultModel.startsWith('ollama-local/') || defaultModel.startsWith('ollama/')) {
      const hasOllamaProvider = config && typeof config.models === 'object' && config.models !== null
        && typeof (config.models as Record<string, unknown>).providers === 'object'
        && ((config.models as Record<string, unknown>).providers as Record<string, unknown>)['ollama-local'] != null;
      if (!hasOllamaProvider) {
        details.push('openclaw.json 中缺少 models.providers["ollama-local"]，网关无法解析该模型，请到设置中点击「一键应用本地模型」选择对应模型并应用');
      }
      const modelName = defaultModel.replace(/^ollama-local\/|^ollama\//, '').split(':')[0];
      const ollamaRunning = await isOllamaRunning();
      if (!ollamaRunning) {
        details.push('Ollama 未运行，请先启动 Ollama');
      } else {
        const models = await listOllamaModels();
        const hasModel = models.some((m) => m.name === modelName || m.name.startsWith(modelName + ':'));
        if (!hasModel) {
          details.push(`Ollama 已运行，但未检测到模型「${modelName}」，请执行 ollama pull ${modelName}`);
        } else {
          details.push('Ollama 已运行且已拉取该模型');
          const ctxFromConfig = config && typeof config.models === 'object' && config.models !== null
            ? (() => {
                const prov = (config.models as Record<string, unknown>).providers as Record<string, { models?: Array<{ id?: string; contextWindow?: number }> }> | undefined;
                const ollamaModels = prov?.['ollama-local']?.models;
                if (!Array.isArray(ollamaModels)) return undefined;
                const entry = ollamaModels.find((m) => m.id === defaultModel);
                return entry?.contextWindow;
              })()
            : undefined;
          if (typeof ctxFromConfig === 'number' && ctxFromConfig < 16000) {
            details.push(`openclaw.json 中该模型的 contextWindow 为 ${ctxFromConfig}，小于 16000，网关会拒绝并报 500。请到设置中重新点击「一键应用本地模型」选择当前模型并应用（会写入 ≥16k），然后「停止网关」再「由本应用启动网关」`);
          } else if (typeof ctxFromConfig === 'number' && ctxFromConfig >= 16000) {
            details.push(`openclaw.json 中该模型 contextWindow 已为 ${ctxFromConfig}（≥16k），配置正确。若仍 500：请先「停止网关」再「由本应用启动网关」让当前运行的网关重新加载配置；或终端运行 openclaw gateway --port ${form.gatewayPort ?? 18789} --allow-unconfigured --verbose 查看网关具体报错`);
          } else {
            const looksSmallContext = /[13]b|4b|qwen3-vl/i.test(modelName);
            if (looksSmallContext) {
              details.push(`OpenClaw 网关要求模型上下文至少 16000 token；当前模型（${defaultModel}）可能不足 16k 会报 500。请到设置中「一键应用本地模型」换用上下文 ≥16k 的模型（如 qwen2.5:7b、llama3.2 等）`);
              details.push(`若已换用大上下文模型仍 500：先「停止网关」再「由本应用启动网关」；或终端运行: openclaw gateway --port ${form.gatewayPort ?? 18789} --allow-unconfigured --verbose 查看具体报错`);
            } else {
              details.push('若仍 500：请先「停止网关」再「由本应用启动网关」让网关重新加载配置；或终端运行 openclaw gateway --verbose 查看具体报错');
            }
          }
        }
      }
    }
  }

  const gatewayReachable = await isGatewayReachable();
  const gatewayModelIds = await fetchGatewayModelsList();
  if (gatewayModelIds === null) {
    if (!gatewayReachable) {
      details.push('网关不可达（未启动或端口错误），请点击「由本应用启动网关」');
    } else {
      details.push('网关已启动，但无法获取模型列表（/v1/models 返回非 JSON 或鉴权失败）。若「手动测试 /v1/models」显示响应为 HTML，说明当前端口指向 OpenClaw Control 控制页而非 API 网关，请确认 openclaw.json 中 gateway.port 为网关端口或使用「由本应用启动网关」');
    }
  } else {
    details.push(`网关已加载的模型列表：[${gatewayModelIds.length ? gatewayModelIds.join(', ') : '无'}]`);
    if (defaultModel) {
      const loaded = gatewayModelIds.includes(defaultModel);
      if (loaded) {
        details.push('配置的默认模型已在网关列表中，网关已成功加载配置');
      } else {
        details.push('配置的默认模型不在网关列表中，网关可能未加载最新配置，请先「停止网关」再「由本应用启动网关」');
      }
    }
  }

  details.push('若已修改配置，请先「停止网关」再「由本应用启动网关」以加载新配置');
  if (defaultModel?.startsWith('ollama-local/') || defaultModel?.startsWith('ollama/')) {
    details.push('若网关日志出现 No API key found for provider "ollama-local"：请到设置中重新点击「一键应用本地模型」选择当前模型并应用（会写入 agent 的 auth-profiles.json），然后「停止网关」再「由本应用启动网关」');
  }
  return { summary: details.join('；'), details };
}

/** 调用 OpenClaw 网关 /v1/chat/completions（非流式），返回助手回复内容或错误。options.timeoutMs 未传时默认 95000 */
export async function sendChat(
  messages: ChatMessage[],
  options?: { model?: string; stream?: false; timeoutMs?: number }
): Promise<{ success: boolean; content?: string; error?: string }> {
  const { port, token, chatEnabled } = await getGatewayChatConfig();
  if (!chatEnabled) {
    return { success: false, error: '当前配置未启用 Chat Completions。请在「OpenClaw 配置」中保存一次（会自动启用），然后「停止网关」再「由本应用启动网关」重新加载。' };
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': 'main',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body = {
    model: options?.model ?? 'openclaw',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
    tool_choice: 'none' as const, // 禁用 tools，避免不支持 tools 的模型（如 gemma3:1b）被网关传 tools 导致 Ollama 400
  };
  const timeoutMs = options?.timeoutMs ?? 95_000;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text();
      let err = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (res.status === 404) {
        err += '。请确认：1) 网关已启动（设置中可点击「由本应用启动网关」）；2) 若已启动仍 404，请先「停止网关」再「由本应用启动网关」以加载 Chat Completions 配置。';
      }
      if (res.status === 401) {
        err = '鉴权失败(401)。请先在设置中点击「停止网关」再点击「由本应用启动网关」以加载默认 Token；或确保 OpenClaw 配置里的「网关鉴权 Token」与 openclaw.json 中 gateway.auth.token 一致。';
      }
      if (res.status === 500) {
        let gatewayMsg = '';
        try {
          const j = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } };
          const e = j?.error;
          if (e?.message) gatewayMsg = `网关返回: ${e.message}`;
          if (e?.code) gatewayMsg += ` (code: ${e.code})`;
          if (e?.type) gatewayMsg += ` [${e.type}]`;
          if (gatewayMsg) gatewayMsg += '。';
        } catch {
          // ignore
        }
        const diag = await getOpenClawGateway500Diagnostic();
        err = `OpenClaw 网关处理请求时出错(500)。${gatewayMsg}诊断：${diag.summary}。若仍无法解决，请在终端运行 openclaw gateway --port ${port} --allow-unconfigured --verbose 查看网关详细日志。`;
      }
      return { success: false, error: err };
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content ?? '';
    return { success: true, content: content || '(助手未返回文字)' };
  } catch (e) {
    return { success: false, error: formatFetchError(e, port) };
  }
}

/** 网关结束标记：整段或末尾为此内容则不转发到前端 */
function isGatewayEndMarker(s: string): boolean {
  const t = s.replace(/\uFEFF/g, '').replace(/\r/g, '').trim().toLowerCase();
  return t === 'terminated' || t === '[done]';
}

/** 流式调用：向 webContents 发送 'chat-stream-delta' 与 'chat-stream-done'。不设超时，连接保持到服务端结束流。
 * 网关可能在结束时下发 "terminated"（整段或分片如 "term"+"inated"），此处统一过滤，不转发。 */
export async function sendChatStream(
  webContents: WebContents | null,
  messages: ChatMessage[],
  options?: { model?: string }
): Promise<{ success: boolean; error?: string }> {
  const { port, token, chatEnabled } = await getGatewayChatConfig();
  if (!chatEnabled) {
    return { success: false, error: '当前配置未启用 Chat Completions。请在「OpenClaw 配置」中保存一次，然后「停止网关」再「由本应用启动网关」重新加载。' };
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  const url = `${baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-openclaw-agent-id': 'main',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const body = {
    model: options?.model ?? 'openclaw',
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    tool_choice: 'none' as const, // 禁用 tools，避免不支持 tools 的模型（如 gemma3:1b）被网关传 tools 导致 Ollama 400
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      let err = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      if (res.status === 404) {
        err += '。请确认：1) 网关已启动（设置中可点击「由本应用启动网关」）；2) 若已启动仍 404，请先「停止网关」再「由本应用启动网关」以加载配置。';
      }
      if (res.status === 401) {
        err = '鉴权失败(401)。请先在设置中「停止网关」再「由本应用启动网关」以加载默认 Token；或确保「网关鉴权 Token」与 openclaw.json 中 gateway.auth.token 一致。';
      }
      if (res.status === 500) {
        let gatewayMsg = '';
        try {
          const j = JSON.parse(text) as { error?: { message?: string; code?: string; type?: string } };
          const e = j?.error;
          if (e?.message) gatewayMsg = `网关返回: ${e.message}`;
          if (e?.code) gatewayMsg += ` (code: ${e.code})`;
          if (e?.type) gatewayMsg += ` [${e.type}]`;
          if (gatewayMsg) gatewayMsg += '。';
        } catch {
          // ignore
        }
        const diag = await getOpenClawGateway500Diagnostic();
        err = `OpenClaw 网关处理请求时出错(500)。${gatewayMsg}诊断：${diag.summary}。若仍无法解决，请在终端运行 openclaw gateway --port ${port} --allow-unconfigured --verbose 查看网关详细日志。`;
      }
      return { success: false, error: err };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hadAnyDelta = false;
    /** 缓冲上一段 delta，用于识别网关分片发送的 "term"+"inated" 组合，避免转发 */
    let pendingDelta = '';
    const flushPending = (toSend: string) => {
      if (!toSend || !webContents || webContents.isDestroyed()) return;
      hadAnyDelta = true;
      webContents.send('chat-stream-delta', toSend);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
              error?: { message?: string };
            };
            if (parsed?.error?.message && webContents && !webContents.isDestroyed()) {
              hadAnyDelta = true;
              webContents.send('chat-stream-delta', `[网关错误] ${String(parsed.error.message)}`);
              continue;
            }
            const choice = parsed?.choices?.[0];
            let delta = choice?.delta?.content;
            if (delta != null && typeof delta === 'string') {
              const normalized = delta.replace(/\uFEFF/g, '').replace(/\r/g, '');
              const t = normalized.trim().toLowerCase();
              if (t === 'terminated' || t === '[done]') {
                delta = '';
              } else if (/\n\s*(terminated|\[done\])\s*$/i.test(normalized)) {
                delta = normalized.replace(/\n\s*(terminated|\[done\])\s*$/i, '').trimEnd();
              }
            }
            if (choice?.finish_reason && !delta) delta = '';
            if (delta === '') continue;
            const combined = pendingDelta + delta;
            if (isGatewayEndMarker(combined)) {
              pendingDelta = '';
              continue;
            }
            if (/\n\s*(terminated|\[done\])\s*$/i.test(combined)) {
              const safe = combined.replace(/\n\s*(terminated|\[done\])\s*$/i, '').trimEnd();
              if (safe.length > 0) flushPending(safe);
              pendingDelta = '';
              continue;
            }
            if (pendingDelta) {
              flushPending(pendingDelta);
              pendingDelta = '';
            }
            if (typeof delta !== 'string' || isGatewayEndMarker(delta)) continue;
            pendingDelta = delta;
          } catch {
            // ignore parse
          }
        }
      }
    }
    if (pendingDelta && !isGatewayEndMarker(pendingDelta)) flushPending(pendingDelta);
    if (!hadAnyDelta && webContents && !webContents.isDestroyed()) {
      webContents.send(
        'chat-stream-delta',
        '未收到流式内容。请到设置中确认网关已启动、Ollama 已运行，并「一键应用本地模型」后重启网关；若仍无效，终端运行：openclaw gateway --port 18789 --allow-unconfigured --verbose 查看报错。'
      );
    }
    if (webContents && !webContents.isDestroyed()) webContents.send('chat-stream-done', {});
    return { success: true };
  } catch (e) {
    return { success: false, error: formatFetchError(e, port) };
  }
}

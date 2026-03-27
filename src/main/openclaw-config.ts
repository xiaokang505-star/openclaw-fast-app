import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_DIR = '.openclaw';
const CONFIG_FILE = 'openclaw.json';

/** 由本应用启动网关时使用的默认鉴权 token，与网关配置一致后请求才不会 401 */
export const DEFAULT_GATEWAY_TOKEN = 'openclaw-exe-local';

export function getOpenClawConfigPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
}

/** 应用内使用的 OpenClaw 基础配置项（阶段二表单），与 openclaw.json gateway / models 对齐 */
export interface OpenClawFormConfig {
  modelSource?: 'cloud' | 'local';
  defaultModel?: string;
  gatewayPort?: number;
  /** 网关鉴权 token，用于 /v1/chat/completions 的 Authorization: Bearer */
  gatewayToken?: string;
  /** → models.providers.openai.apiKey */
  openaiApiKey?: string;
  /** → models.providers.anthropic.apiKey */
  anthropicApiKey?: string;
  /** → models.providers.google.apiKey（Gemini 等常用 google 提供方） */
  googleGeminiApiKey?: string;
  /** → channels.discord.enabled */
  discordEnabled?: boolean;
  /** → channels.discord.token；留空并保存表示删除已存 Token */
  discordBotToken?: string;
  /** → channels.discord.allowFrom（单用户）；留空并保存则移除该字段 */
  discordAllowFromUserId?: string;
  /** 与 allowFrom 一起写入 guilds[guildId].users；仅当非空时更新对应 guild 条目 */
  discordGuildId?: string;
  /** → channels.telegram.botToken */
  telegramBotToken?: string;
  /** → channels.slack.botToken */
  slackBotToken?: string;
  /** → channels.slack.appToken */
  slackAppToken?: string;
  /** → channels.feishu.appSecret */
  feishuAppSecret?: string;
  /** → channels.mattermost.botToken */
  mattermostBotToken?: string;
}

function readProviderApiKey(config: Record<string, unknown> | null, providerId: string): string {
  if (!config?.models || typeof config.models !== 'object') return '';
  const providers = (config.models as Record<string, unknown>).providers;
  if (!providers || typeof providers !== 'object') return '';
  const p = (providers as Record<string, unknown>)[providerId];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return '';
  const k = (p as Record<string, unknown>).apiKey;
  return typeof k === 'string' ? k : '';
}

function readChannelToken(config: Record<string, unknown> | null, channelId: string, nestedKey: string): string {
  const ch = config?.channels as Record<string, unknown> | undefined;
  const c = ch?.[channelId];
  if (!c || typeof c !== 'object' || Array.isArray(c)) return '';
  const t = (c as Record<string, unknown>)[nestedKey];
  return typeof t === 'string' ? t : '';
}

/** 合并 models.providers.<id>.apiKey；空字符串则删除该键，若 provider 无其它键则删除 provider */
function mergeProviderApiKey(base: Record<string, unknown>, providerId: string, value: string | undefined): void {
  if (value === undefined) return;
  const models = (base.models && typeof base.models === 'object' ? { ...(base.models as object) } : {}) as Record<string, unknown>;
  const providers = (models.providers && typeof models.providers === 'object' ? { ...(models.providers as object) } : {}) as Record<string, unknown>;
  const prev = providers[providerId];
  const p: Record<string, unknown> =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as object) } : {};
  const t = value.trim();
  if (t) p.apiKey = t;
  else delete p.apiKey;
  if (Object.keys(p).length > 0) providers[providerId] = p;
  else delete providers[providerId];
  models.providers = providers;
  base.models = models;
}

/** 合并 channels.<channelId>.<nestedKey>；空字符串则删除该嵌套键 */
function mergeChannelNestedToken(
  channels: Record<string, unknown>,
  channelId: string,
  nestedKey: string,
  value: string | undefined
): void {
  if (value === undefined) return;
  const t = value.trim();
  const prev = channels[channelId];
  const obj: Record<string, unknown> =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as object) } : {};
  if (t) obj[nestedKey] = t;
  else delete obj[nestedKey];
  if (Object.keys(obj).length > 0) channels[channelId] = obj;
  else delete channels[channelId];
}

function mergeModelProviderKeysFromForm(base: Record<string, unknown>, form: OpenClawFormConfig): void {
  mergeProviderApiKey(base, 'openai', form.openaiApiKey);
  mergeProviderApiKey(base, 'anthropic', form.anthropicApiKey);
  mergeProviderApiKey(base, 'google', form.googleGeminiApiKey);
}

function mergeChatChannelTokensFromForm(channels: Record<string, unknown>, form: OpenClawFormConfig): void {
  mergeChannelNestedToken(channels, 'telegram', 'botToken', form.telegramBotToken);
  mergeChannelNestedToken(channels, 'slack', 'botToken', form.slackBotToken);
  mergeChannelNestedToken(channels, 'slack', 'appToken', form.slackAppToken);
  mergeChannelNestedToken(channels, 'feishu', 'appSecret', form.feishuAppSecret);
  mergeChannelNestedToken(channels, 'mattermost', 'botToken', form.mattermostBotToken);
}

const DISCORD_SNOWFLAKE = /^\d{17,22}$/;

function parseDiscordAllowFromFirstId(allowFrom: unknown): string | undefined {
  if (!Array.isArray(allowFrom)) return undefined;
  for (const x of allowFrom) {
    if (typeof x === 'string' && DISCORD_SNOWFLAKE.test(x.trim())) return x.trim();
  }
  return undefined;
}

/** 合并表单中的 Discord 段到 channels.discord；失败时抛出带文案的 Error */
function mergeDiscordFromForm(
  prevDiscord: Record<string, unknown> | undefined,
  form: OpenClawFormConfig
): Record<string, unknown> | undefined {
  const discord: Record<string, unknown> =
    prevDiscord && typeof prevDiscord === 'object' ? { ...prevDiscord } : {};

  if (form.discordBotToken !== undefined) {
    const t = form.discordBotToken.trim();
    if (t) discord.token = t;
    else delete discord.token;
  }

  const hasToken = typeof discord.token === 'string' && discord.token.trim().length > 0;

  if (form.discordEnabled !== undefined) {
    if (form.discordEnabled && !hasToken) {
      throw new Error('启用 Discord 前请先填写 Bot Token，或取消勾选「启用 Discord」');
    }
    discord.enabled = Boolean(form.discordEnabled) && hasToken;
  } else if (!hasToken) {
    discord.enabled = false;
  }

  if (form.discordAllowFromUserId !== undefined) {
    const u = form.discordAllowFromUserId.trim();
    if (u) {
      if (!DISCORD_SNOWFLAKE.test(u)) {
        throw new Error('Discord 用户 ID 须为 17～22 位数字（Discord 开发者模式中复制）');
      }
      discord.allowFrom = [u];
    } else {
      delete discord.allowFrom;
    }
  }

  if (form.discordGuildId !== undefined) {
    const g = form.discordGuildId.trim();
    const uid =
      typeof form.discordAllowFromUserId === 'string'
        ? form.discordAllowFromUserId.trim()
        : parseDiscordAllowFromFirstId(discord.allowFrom) ?? '';
    if (g) {
      if (!DISCORD_SNOWFLAKE.test(g)) {
        throw new Error('Discord 服务器 ID 须为 17～22 位数字');
      }
      if (!uid || !DISCORD_SNOWFLAKE.test(uid)) {
        throw new Error('填写服务器 ID 时，请先填写「允许的 Discord 用户 ID」');
      }
      const guilds =
        typeof discord.guilds === 'object' && discord.guilds !== null && !Array.isArray(discord.guilds)
          ? { ...(discord.guilds as Record<string, unknown>) }
          : {};
      const prevG = guilds[g];
      const entry: Record<string, unknown> =
        typeof prevG === 'object' && prevG !== null && !Array.isArray(prevG) ? { ...(prevG as object) } : {};
      entry.users = [uid];
      if (entry.requireMention === undefined) entry.requireMention = true;
      guilds[g] = entry;
      discord.guilds = guilds;
      discord.groupPolicy = 'allowlist';
    }
  }

  const hasAllow = Array.isArray(discord.allowFrom) && discord.allowFrom.length > 0;
  const hasGuilds =
    typeof discord.guilds === 'object' && discord.guilds !== null && Object.keys(discord.guilds).length > 0;
  const enabled = discord.enabled === true;
  if (!hasToken && !enabled && !hasAllow && !hasGuilds) {
    return undefined;
  }
  return discord;
}

/**
 * 保证存在 channels.discord，且含显式 enabled，便于 OpenClaw 与本应用配置页识别「未启用 Discord」。
 * 新建为 { enabled: false }；若已有对象但缺 enabled，则：有 token 则 true，否则 false。
 */
export function applyDefaultDiscordChannelStub(base: Record<string, unknown>): void {
  const prev = base.channels;
  const channels: Record<string, unknown> =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as object) } : {};
  const d = channels.discord;
  if (d === undefined || d === null || typeof d !== 'object' || Array.isArray(d)) {
    channels.discord = { enabled: false };
  } else {
    const disc = { ...(d as object) } as Record<string, unknown>;
    if (disc.enabled === undefined) {
      const hasToken = typeof disc.token === 'string' && disc.token.trim().length > 0;
      disc.enabled = Boolean(hasToken);
    }
    channels.discord = disc;
  }
  base.channels = channels;
}

/** 宽松解析 JSON：去 BOM、行首注释、尾部逗号。行首注释才去除，避免误删 URL 里的 // */
export function parseJsonLenient(raw: string): Record<string, unknown> | null {
  let cleaned = raw.trim();
  if (cleaned.charCodeAt(0) === 0xfeff) cleaned = cleaned.slice(1);
  cleaned = stripJsonCommentsSafe(cleaned);
  // 多次移除尾部逗号（嵌套结构可能有多处）
  let noTrailing = cleaned;
  for (let i = 0; i < 10; i++) {
    const next = noTrailing.replace(/,(\s*[}\]])/g, '$1');
    if (next === noTrailing) break;
    noTrailing = next;
  }
  for (const s of [cleaned, noTrailing]) {
    try {
      const data = JSON.parse(s) as Record<string, unknown>;
      if (data && typeof data === 'object') return data;
    } catch {
      // try next
    }
  }
  return null;
}

/** 读取 openclaw.json，返回可编辑的 JSON 对象；不存在或解析失败返回 null。若存在 OpenClaw 不认的 root 键会移除并写回。 */
export async function readOpenClawConfig(): Promise<Record<string, unknown> | null> {
  const configPath = getOpenClawConfigPath();
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    let data = parseJsonLenient(raw);
    if (!data) return null;
    const hasInvalid = 'modelSource' in data || 'defaultModel' in data || 'apiKey' in data;
    if (hasInvalid) {
      delete data.modelSource;
      delete data.defaultModel;
      delete data.apiKey;
      await fs.promises.writeFile(configPath, JSON.stringify(data, null, 2), 'utf8');
    }
    return data;
  } catch {
    return null;
  }
}

/** 从原始配置中提取阶段二表单预填值；defaultModel 从 agents.defaults.model 或 models.providers["ollama-local"] 推断 */
export function getFormConfigFromRaw(config: Record<string, unknown> | null): OpenClawFormConfig {
  if (!config) {
    return { modelSource: 'cloud', gatewayPort: 18789 };
  }
  const gw = config.gateway as { port?: number; auth?: { token?: string } } | undefined;
  const agents = config.agents as { defaults?: { model?: string | { primary?: string } } } | undefined;
  const modelVal = agents?.defaults?.model;
  const primary =
    typeof modelVal === 'string'
      ? modelVal
      : (typeof modelVal === 'object' && modelVal !== null && typeof (modelVal as { primary?: string }).primary === 'string'
          ? (modelVal as { primary: string }).primary
          : undefined);
  let defaultModel = typeof primary === 'string' ? primary : undefined;
  if (!defaultModel && config.models && typeof config.models === 'object') {
    const providers = (config.models as Record<string, unknown>).providers;
    if (providers && typeof providers === 'object' && !Array.isArray(providers)) {
      for (const key of ['ollama-local', 'ollama', ...Object.keys(providers)]) {
        const p = (providers as Record<string, unknown>)[key];
        const models = (p as { models?: Array<{ id?: string }> })?.models;
        if (Array.isArray(models) && models.length > 0 && typeof models[0].id === 'string') {
          const id = models[0].id;
          if (id.startsWith('ollama-local/') || id.startsWith('ollama/')) {
            defaultModel = id;
            break;
          }
        }
      }
    }
  }
  const inferredLocal = (defaultModel?.startsWith('ollama/') || defaultModel?.startsWith('ollama-local/')) ?? false;

  const ch = config.channels as { discord?: Record<string, unknown> } | undefined;
  const disc = ch?.discord;
  let discordBotToken = '';
  let discordEnabled = false;
  let discordAllowFromUserId = '';
  let discordGuildId = '';
  if (disc && typeof disc === 'object') {
    discordBotToken = typeof disc.token === 'string' ? disc.token : '';
    discordEnabled = disc.enabled === true;
    const af = parseDiscordAllowFromFirstId(disc.allowFrom);
    if (af) discordAllowFromUserId = af;
    const guilds = disc.guilds;
    if (guilds && typeof guilds === 'object' && !Array.isArray(guilds)) {
      const keys = Object.keys(guilds);
      if (keys.length > 0) discordGuildId = keys[0];
    }
  }
  return {
    modelSource: inferredLocal ? 'local' : 'cloud',
    defaultModel,
    gatewayPort: typeof gw?.port === 'number' ? gw.port : 18789,
    gatewayToken: typeof gw?.auth?.token === 'string' ? gw.auth.token : undefined,
    openaiApiKey: readProviderApiKey(config, 'openai'),
    anthropicApiKey: readProviderApiKey(config, 'anthropic'),
    googleGeminiApiKey: readProviderApiKey(config, 'google'),
    discordEnabled,
    discordBotToken,
    discordAllowFromUserId,
    discordGuildId,
    telegramBotToken: readChannelToken(config, 'telegram', 'botToken'),
    slackBotToken: readChannelToken(config, 'slack', 'botToken'),
    slackAppToken: readChannelToken(config, 'slack', 'appToken'),
    feishuAppSecret: readChannelToken(config, 'feishu', 'appSecret'),
    mattermostBotToken: readChannelToken(config, 'mattermost', 'botToken'),
  };
}

/** 合并表单配置写回 openclaw.json；不写 root 的 modelSource/defaultModel（OpenClaw 不认），defaultModel 写入 agents.defaults.model.primary */
export async function writeOpenClawConfig(
  existing: Record<string, unknown> | null,
  form: OpenClawFormConfig
): Promise<{ success: boolean; error?: string }> {
  const configPath = getOpenClawConfigPath();
  const dir = path.dirname(configPath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    const base = existing && typeof existing === 'object' ? { ...existing } : {};
    delete base.modelSource;
    delete base.defaultModel;
    delete base.apiKey;

    const gw = (base.gateway && typeof base.gateway === 'object' ? { ...(base.gateway as object) } : {}) as Record<string, unknown>;
    if (form.gatewayPort !== undefined) gw.port = form.gatewayPort;
    gw.mode = 'local';
    gw.http = { ...(gw.http as object || {}), endpoints: { chatCompletions: { enabled: true } } };
    if (form.gatewayToken !== undefined) gw.auth = { ...(gw.auth as object || {}), token: form.gatewayToken || undefined };
    base.gateway = gw;

    if (form.defaultModel !== undefined && form.defaultModel.trim()) {
      const agents = (base.agents && typeof base.agents === 'object' ? { ...(base.agents as object) } : {}) as Record<string, unknown>;
      const defaults = (agents.defaults && typeof agents.defaults === 'object' ? { ...(agents.defaults as object) } : {}) as Record<string, unknown>;
      const prevModel = defaults.model;
      const modelObj = typeof prevModel === 'object' && prevModel !== null && !Array.isArray(prevModel)
        ? { ...(prevModel as Record<string, unknown>) }
        : { primary: typeof prevModel === 'string' ? prevModel : 'openclaw' };
      (modelObj as Record<string, unknown>).primary = form.defaultModel.trim();
      defaults.model = modelObj;
      agents.defaults = defaults;
      base.agents = agents;
    }

    const channels = (base.channels && typeof base.channels === 'object' ? { ...(base.channels as object) } : {}) as Record<string, unknown>;
    const prevD = channels.discord;
    const prevDiscord =
      prevD && typeof prevD === 'object' && !Array.isArray(prevD) ? (prevD as Record<string, unknown>) : undefined;
    const discordTouched =
      form.discordEnabled !== undefined ||
      form.discordBotToken !== undefined ||
      form.discordAllowFromUserId !== undefined ||
      form.discordGuildId !== undefined;
    if (discordTouched) {
      try {
        const nextDiscord = mergeDiscordFromForm(prevDiscord, form);
        if (nextDiscord === undefined) {
          delete channels.discord;
        } else {
          channels.discord = nextDiscord;
        }
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }

    mergeChatChannelTokensFromForm(channels, form);

    if (Object.keys(channels).length === 0) {
      delete base.channels;
    } else {
      base.channels = channels;
    }

    mergeModelProviderKeysFromForm(base, form);

    // 历史版本曾写入 root.gui（OpenClaw 不识别）；保存时强制移除，避免 config invalid。
    delete base.gui;

    applyDefaultDiscordChannelStub(base);

    await fs.promises.writeFile(configPath, JSON.stringify(base, null, 2), 'utf8');
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** 在启动网关前确保 openclaw.json 存在且启用 Chat Completions，避免网关默认关闭该端点导致无响应。仅合并 gateway 段，不覆盖 agents/models 等其它配置。 */
export async function ensureGatewayChatCompletionsEnabled(port = 18789): Promise<void> {
  const configPath = getOpenClawConfigPath();
  const dir = path.dirname(configPath);
  await fs.promises.mkdir(dir, { recursive: true });
  let base: Record<string, unknown> | null = null;
  try {
    const raw = await fs.promises.readFile(configPath, 'utf8');
    const parsed = parseJsonLenient(raw);
    if (raw.trim().length > 0 && parsed === null) {
      // 文件存在但无法解析：不写入、不覆盖，直接返回，照常启动网关（由网关自行读取配置）
      return;
    }
    base = parsed ?? {};
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      base = {};
    } else {
      base = {};
    }
  }
  if (!base || typeof base !== 'object') base = {};
  const gw = (base.gateway && typeof base.gateway === 'object' ? { ...(base.gateway as object) } : {}) as Record<string, unknown>;
  delete gw.timeout;
  delete gw.timeoutMs;
  gw.port = port;
  gw.mode = 'local';
  const prevHttp = (gw.http && typeof gw.http === 'object' ? gw.http : {}) as Record<string, unknown>;
  const prevEndpoints = (prevHttp.endpoints && typeof prevHttp.endpoints === 'object' ? prevHttp.endpoints : {}) as Record<string, unknown>;
  gw.http = { ...prevHttp, endpoints: { ...prevEndpoints, chatCompletions: { enabled: true } } };
  const prevAuth = (gw.auth && typeof gw.auth === 'object' ? gw.auth : {}) as Record<string, unknown>;
  if (prevAuth.token === undefined || prevAuth.token === null || String(prevAuth.token).trim() === '') {
    gw.auth = { ...prevAuth, token: DEFAULT_GATEWAY_TOKEN };
  } else {
    gw.auth = prevAuth;
  }
  base.gateway = gw;
  // 仅当默认模型「不支持 tools」时禁用全部 tools，避免 Ollama 400；其它模型保留 tools 以便网关能执行操作（浏览器、文件等）
  const tools = (base.tools && typeof base.tools === 'object' ? { ...(base.tools as object) } : {}) as Record<string, unknown>;
  const modelVal = (base.agents as { defaults?: { model?: string | { primary?: string } } })?.defaults?.model;
  const primary = typeof modelVal === 'string' ? modelVal : (typeof modelVal === 'object' && modelVal !== null && typeof (modelVal as { primary?: string }).primary === 'string' ? (modelVal as { primary: string }).primary : undefined);
  const modelId = (typeof primary === 'string' ? primary : '').toLowerCase().replace(/^ollama-local\/|^ollama\//, '');
  const MODELS_WITHOUT_TOOLS = ['gemma3:1b', 'gemma3:3b', 'gemma3:1b-instruct', 'gemma3:3b-instruct'];
  const needsNoTools = MODELS_WITHOUT_TOOLS.some((m) => modelId === m || modelId.startsWith(m + ':'));
  if (needsNoTools) {
    tools.deny = ['*'];
  } else {
    delete tools.deny;
  }
  base.tools = tools;
  // 网关单次运行超时：OpenClaw 默认 agents.defaults.timeoutSeconds = 600（10 分钟），超时后网关会断开连接。设为 30 分钟避免长对话/首 token 慢时被断。
  const AGENT_RUN_TIMEOUT_SEC = 30 * 60;
  const agents = (base.agents && typeof base.agents === 'object' ? { ...(base.agents as object) } : {}) as Record<string, unknown>;
  const defaults = (agents.defaults && typeof agents.defaults === 'object' ? { ...(agents.defaults as object) } : {}) as Record<string, unknown>;
  defaults.timeoutSeconds = AGENT_RUN_TIMEOUT_SEC;
  agents.defaults = defaults;
  base.agents = agents;
  const models = base.models as Record<string, unknown> | undefined;
  if (models?.providers && typeof models.providers === 'object') {
    const pl = (models.providers as Record<string, unknown>)['ollama-local'];
    if (pl && typeof pl === 'object') delete (pl as Record<string, unknown>).timeoutMs;
  }
  applyDefaultDiscordChannelStub(base);
  await fs.promises.writeFile(configPath, JSON.stringify(base, null, 2), 'utf8');
  await ensureOllamaLocalAuthProfile();
}

/** agent 的 auth-profiles.json 路径（main agent），网关从此文件解析 provider 的 API key */
export function getAuthProfilesPath(): string {
  return path.join(os.homedir(), CONFIG_DIR, 'agents', 'main', 'agent', 'auth-profiles.json');
}

/** 确保 auth-profiles.json 中存在 ollama-local 的 api_key 条目，避免网关报 No API key found for provider "ollama-local" */
export async function ensureOllamaLocalAuthProfile(): Promise<void> {
  const authPath = getAuthProfilesPath();
  const dir = path.dirname(authPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const profileId = 'ollama-local:default';
  const newProfile = { type: 'api_key', provider: 'ollama-local', key: 'ollama-local' };
  let data: { profiles?: Record<string, unknown>; order?: string[] } = { profiles: {}, order: [] };
  try {
    const raw = await fs.promises.readFile(authPath, 'utf8');
    const parsed = parseJsonLenient(raw) as { profiles?: Record<string, unknown>; order?: string[] } | null;
    if (parsed && typeof parsed.profiles === 'object') {
      data.profiles = { ...parsed.profiles };
      data.order = Array.isArray(parsed.order) ? [...parsed.order] : [];
    }
  } catch {
    // 文件不存在或解析失败，使用空对象
  }
  if (!data.profiles) data.profiles = {};
  data.profiles[profileId] = newProfile;
  if (!data.order!.includes(profileId)) data.order!.unshift(profileId);
  await fs.promises.writeFile(authPath, JSON.stringify(data, null, 2), 'utf8');
}

async function ensureProviderApiKeyProfile(provider: string, key: string): Promise<void> {
  const authPath = getAuthProfilesPath();
  const dir = path.dirname(authPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const profileId = `${provider}:default`;
  const newProfile = { type: 'api_key', provider, key };
  let data: { profiles?: Record<string, unknown>; order?: string[] } = { profiles: {}, order: [] };
  try {
    const raw = await fs.promises.readFile(authPath, 'utf8');
    const parsed = parseJsonLenient(raw) as { profiles?: Record<string, unknown>; order?: string[] } | null;
    if (parsed && typeof parsed.profiles === 'object') {
      data.profiles = { ...parsed.profiles };
      data.order = Array.isArray(parsed.order) ? [...parsed.order] : [];
    }
  } catch {
    // ignore
  }
  if (!data.profiles) data.profiles = {};
  data.profiles[profileId] = newProfile;
  if (!data.order!.includes(profileId)) data.order!.unshift(profileId);
  await fs.promises.writeFile(authPath, JSON.stringify(data, null, 2), 'utf8');
}

/** 一键将 OpenClaw provider 指向 llv-ollama 聚合入口 */
export async function applyLlvProvider(baseUrl: string): Promise<{ success: boolean; error?: string }> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!normalizedBaseUrl) return { success: false, error: 'llv baseUrl 不能为空' };
  const finalBaseUrl = normalizedBaseUrl.endsWith('/v1') ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
  const current = await readOpenClawConfig();
  const base = current && typeof current === 'object' ? { ...current } : {};
  const models = (base.models && typeof base.models === 'object' ? { ...(base.models as object) } : {}) as Record<string, unknown>;
  const providers = (models.providers && typeof models.providers === 'object' ? { ...(models.providers as object) } : {}) as Record<string, unknown>;
  const prev = providers['ollama-lv'];
  const next =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...(prev as Record<string, unknown>) } : {};
  next.baseUrl = finalBaseUrl;
  next.api = 'openai';
  if (!next.apiKey || typeof next.apiKey !== 'string') next.apiKey = 'ollama-lv';
  providers['ollama-lv'] = next;
  models.providers = providers;
  base.models = models;
  applyDefaultDiscordChannelStub(base);
  try {
    const configPath = getOpenClawConfigPath();
    await fs.promises.mkdir(path.dirname(configPath), { recursive: true });
    await fs.promises.writeFile(configPath, JSON.stringify(base, null, 2), 'utf8');
    await ensureProviderApiKeyProfile('ollama-lv', 'ollama-lv');
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

/** 仅去除行首的行注释与块注释，避免误删字符串内的 //（如 URL） */
function stripJsonCommentsSafe(raw: string): string {
  return raw
    .replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
    .replace(/(^|\n)\s*\/\*[\s\S]*?\*\//g, '$1');
}

/** 简单去除行内 // 注释（会误删 URL 中的 //，仅用于兼容旧逻辑） */
function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

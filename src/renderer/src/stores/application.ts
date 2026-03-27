import { defineStore } from 'pinia';
import { useRouter, useRoute } from 'vue-router';
import { ref, computed, watch, nextTick } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { DetectionReport, StepResult } from '../types';
import type { AppSettings, GuiExecutionReceipt, GuiAuditLogEntry, LlvOllamaTarget } from '../env';

export const useApplicationStore = defineStore('application', () => {
type SettingsCategory = 'overview' | 'environment' | 'chat' | 'distributed-compute' | 'openclaw' | 'automation';

const settingsNavItems: { key: SettingsCategory; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'environment', label: '环境与安装' },
  { key: 'chat', label: '对话与网关' },
  { key: 'distributed-compute', label: '分布式算力' },
  { key: 'openclaw', label: 'OpenClaw 与渠道' },
  { key: 'automation', label: '自动化与 GUI' },
];

const MARKDOWN_PLACEHOLDER = '<span class="msg-placeholder">…</span>';
const STREAMING_PLACEHOLDER = '<span class="msg-placeholder">等待首字…（首 token 可能需 1～2 分钟，请勿关闭）</span>';

/** OpenClaw 配置页 · Discord 表单项 suffix 内说明（空值行为见各条文案） */
const DISCORD_TOOLTIP_TOKEN =
  '在 Discord 开发者门户创建 Application → Bot → Reset Token。对应 channels.discord.token。留空并保存将删除已保存的 Token，并自动关闭「启用 Discord」。';
const DISCORD_TOOLTIP_USER =
  '开启 Discord「开发者模式」后，右键自己的头像 → 复制用户 ID。写入 channels.discord.allowFrom（本应用保存为单元素数组）。留空并保存会移除 allowFrom，由 OpenClaw 使用默认私信策略。';
const DISCORD_TOOLTIP_GUILD =
  '右键服务器图标 → 复制服务器 ID。与用户 ID 一并写入 channels.discord.guilds[服务器ID].users，并设置 groupPolicy 为 allowlist。留空则本表单不新增/覆盖 guild 条目；删除条目请打开配置目录手动编辑。';
const DISCORD_TOOLTIP_ENABLED = '关闭后写入 channels.discord.enabled=false；无 Token 时无法开启。';

const MODEL_TOOLTIP_OPENAI =
  '写入 openclaw.json → models.providers.openai.apiKey，供 OpenAI 兼容路由使用。留空并保存将移除该键（保留 provider 内其它字段）。勿将密钥提交到 Git。';
const MODEL_TOOLTIP_ANTHROPIC =
  '对应 models.providers.anthropic.apiKey。用于 Claude 等 Anthropic 提供方。留空并保存则清除已保存的 apiKey。';
const MODEL_TOOLTIP_GOOGLE =
  '对应 models.providers.google.apiKey（常见为 Google AI / Gemini API Key）。具体模型 id 仍由 agents.defaults.model 决定。留空并保存则清除。';
const CHAT_TOOLTIP_TELEGRAM =
  '对应 channels.telegram.botToken（@BotFather 获取）。留空并保存则删除该键。详见 OpenClaw Telegram 文档。';
const CHAT_TOOLTIP_SLACK_BOT =
  '对应 channels.slack.botToken（Bot User OAuth Token 等，以官方文档为准）。留空并保存则删除。';
const CHAT_TOOLTIP_SLACK_APP =
  '对应 channels.slack.appToken（Socket Mode 等场景）。不需要可留空。';
const CHAT_TOOLTIP_FEISHU =
  '对应 channels.feishu.appSecret（飞书开放平台应用凭证）。留空并保存则删除。';
const CHAT_TOOLTIP_MATTERMOST =
  '对应 channels.mattermost.botToken。留空并保存则删除。';
const GUI_TOOLTIP_ENABLED =
  '开启后，检测到“打开/点击/输入”等 GUI 意图会强制走 OpenClaw 网关执行路径；关闭则此类请求会被拦截提示。';
const GUI_TOOLTIP_ALLOW_APPS =
  'GUI 应用白名单，逗号分隔（如 Finder, WeChat, Chrome）。仅用于策略提示与后续策略层，建议按常用应用维护。';
const GUI_TOOLTIP_CONFIRM =
  '高风险 GUI 动作（删除、覆盖、系统设置修改）执行前是否要求二次确认。建议保持开启。';

/** 将 Markdown 转为安全 HTML（用于对话气泡内展示） */
function renderMarkdown(text: string): string {
  if (!text?.trim()) return MARKDOWN_PLACEHOLDER;
  const rawHtml = marked.parse(text.trim(), { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, { ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'span', 'div'] });
}

function renderExecutionReceipt(r?: GuiExecutionReceipt): string {
  if (!r) return '';
  const statusMap: Record<GuiExecutionReceipt['status'], string> = {
    blocked: '已阻断',
    confirmed: '已确认',
    executing: '执行中',
  };
  const app = r.requestedApp ? `「${r.requestedApp}」` : '目标应用';
  const reasonFriendlyMap: Record<string, string> = {
    direct_open_app_ok: `已开始为你打开${app}。`,
    direct_hotkey_ok: '已发送快捷键操作。',
    direct_type_text_ok: '已执行文本输入。',
    gui_disabled: 'GUI 功能当前未开启，请先在配置中打开后再试。',
    app_not_in_allowlist: `${app} 不在允许列表中，已为你拦截。`,
    user_declined_high_risk: '你已取消高风险操作，本次未执行。',
    direct_open_app_failed: `打开${app}失败，请确认应用已安装且名称正确。`,
    direct_hotkey_failed: '快捷键执行失败，请检查辅助功能权限。',
    direct_type_text_failed: '文本输入失败，请检查辅助功能权限。',
    gui_task_ok: '多步 GUI 任务已完成。',
    gui_task_failed: '多步 GUI 任务执行失败。',
  };
  const friendly = reasonFriendlyMap[r.reason] ?? 'GUI 指令已受理。';
  const detailApp = r.requestedApp ? `；目标：${r.requestedApp}` : '';
  const progress = typeof r.stepIndex === 'number' && typeof r.stepTotal === 'number'
    ? `；进度：${r.stepIndex}/${r.stepTotal}`
    : '';
  const fail = r.failedReason ? `；失败原因：${r.failedReason}` : '';
  return `${friendly}\n[GUI回执] 状态：${statusMap[r.status]}；风险：${r.risk}${detailApp}${progress}${fail}`;
}

function sanitizeAssistantOutput(text: string): string {
  if (!text) return '';
  let out = text;
  // 过滤常见“内部计划/自述”开头
  out = out.replace(
    /(^|\n)(since the user asked.*|i (will|need to|should|am going to) .*|let me .*|i'?ll .*|first, .*|as a workaround, .*)/gim,
    '\n'
  );
  // 过滤工具调用 JSON 草稿块
  out = out.replace(/\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"parameters"\s*:\s*\{[\s\S]*?\}\s*\}/gim, '');
  // 过滤 memory/tool 相关计划句
  out = out.replace(/(^|\n).*(memory_search|tool call|search .*memory|mem(or)?y\.md|user\.md).*/gim, '\n');
  // 清理多余空行
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

const platformInfo = ref('正在获取系统信息…');
const router = useRouter();
const route = useRoute();
const settingsCategory = ref<SettingsCategory>('overview');
const settingsNodePath = ref('');
const settingsNpmRegistry = ref('');
const settingsNvmNodeMirror = ref('');
const settingsNvmDefaultVersion = ref('');
const npmRegistryPresets = ref<{ id: string; name: string; url: string }[]>([]);
const nvmMirrorPresets = ref<{ id: string; name: string; url: string }[]>([]);
const nvmInstalledVersions = ref<string[]>([]);
const detectionProgress = ref('正在检测运行环境…');
const nvmInstalled = ref(false);
const nvmSuggestedVersions = ref<string[]>(['24']);
const selectedNodeVersion = ref('24');
const nvmInstallRunning = ref(false);
const nvmInstallProgress = ref('');
const detectionResult = ref<DetectionReport | null>(null);
const guideReport = ref<DetectionReport | null>(null);
const installOpenClawLog = ref('');
const installOpenClawRunning = ref(false);
const startGatewayInProcessRunning = ref(false);
const openclawForm = ref<{
  modelSource: 'cloud' | 'local';
  defaultModel: string;
  gatewayPort: number;
  gatewayToken: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  googleGeminiApiKey: string;
  discordEnabled: boolean;
  discordBotToken: string;
  discordAllowFromUserId: string;
  discordGuildId: string;
  telegramBotToken: string;
  slackBotToken: string;
  slackAppToken: string;
  feishuAppSecret: string;
  mattermostBotToken: string;
  guiEnabled: boolean;
  guiAllowApps: string;
  guiRequireConfirmForDangerous: boolean;
}>({
  modelSource: 'cloud',
  defaultModel: '',
  gatewayPort: 18789,
  gatewayToken: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  googleGeminiApiKey: '',
  discordEnabled: false,
  discordBotToken: '',
  discordAllowFromUserId: '',
  discordGuildId: '',
  telegramBotToken: '',
  slackBotToken: '',
  slackAppToken: '',
  feishuAppSecret: '',
  mattermostBotToken: '',
  guiEnabled: false,
  guiAllowApps: '',
  guiRequireConfirmForDangerous: true,
});

watch(
  () => openclawForm.value.discordBotToken,
  (t) => {
    if (!t.trim()) openclawForm.value.discordEnabled = false;
  }
);

const agentInput = ref('');
const configSaveLoading = ref(false);
const agentMessages = ref<{ role: 'user' | 'assistant'; content: string }[]>([]);
/** 发送给模型的历史消息条数上限（仅取最近 N 条），避免 prompt 过大导致变慢或超上下文；约 10 轮对话 */
const MAX_CHAT_HISTORY_MESSAGES = 12;
const agentLoading = ref(false);
const agentStreaming = ref(false);
let unsubStreamDelta: (() => void) | null = null;
let unsubStreamDone: (() => void) | null = null;
const freeModelChoice = ref<'pending' | 'yes' | 'no'>('pending');
const ollamaModels = ref<{ name: string }[]>([]);
const selectedOllamaModel = ref('');
const ollamaServeRunning = ref(false);
const ollamaServeProgress = ref('');
const ollamaProviderWritten = ref(false);
let unsubOllamaProgress: (() => void) | null = null;
const settingsOpenclawVersion = ref('latest');
const settingsReinstallOpenClawRunning = ref(false);
const settingsReinstallOpenClawLog = ref('');
const settingsGuiAuditLogs = ref<GuiAuditLogEntry[]>([]);
const settingsGuiAuditLoading = ref(false);
const settingsGuiAuditStatusFilter = ref<'all' | 'blocked' | 'executing'>('all');
const settingsGuiAuditRiskFilter = ref<'all' | 'high' | 'medium' | 'low'>('all');
const settingsGuiAuditFiltered = computed(() =>
  settingsGuiAuditLogs.value.filter((x) => {
    if (settingsGuiAuditStatusFilter.value !== 'all' && x.status !== settingsGuiAuditStatusFilter.value) return false;
    if (settingsGuiAuditRiskFilter.value !== 'all' && x.risk !== settingsGuiAuditRiskFilter.value) return false;
    return true;
  })
);
const settingsGuiAuditExportText = computed(() =>
  settingsGuiAuditFiltered.value
    .map((x) => `[${x.ts}] status=${x.status} risk=${x.risk} reason=${x.reason}${x.requestedApp ? ` app=${x.requestedApp}` : ''}\n  message=${x.message}`)
    .join('\n\n')
);
const settingsOllamaModelsForApply = ref<{ name: string }[]>([]);
const settingsSelectedOllamaForApply = ref('');
const settingsApplyLocalModelLoading = ref(false);
const gatewayDiagnosticLoading = ref(false);
const testV1ModelsLoading = ref(false);
const verifyRequestChainLoading = ref(false);
const settingsChatBackend = ref<'ollama' | 'openclaw'>('openclaw');
/** 经 OpenClaw 网关对话的超时时间（秒），30～300，默认 90 */
const settingsGatewayChatTimeoutSec = ref(90);
const llvEnabled = ref(false);
const llvListenHost = ref('127.0.0.1');
const llvListenPort = ref(11435);
const llvStrategy = ref<'round_robin' | 'least_inflight' | 'weighted'>('least_inflight');
const llvStickyByModel = ref(false);
const llvAggregateModels = ref(true);
const llvHealthIntervalSec = ref(15);
const llvHealthTimeoutMs = ref(3000);
const llvHealthFailThreshold = ref(3);
const llvTargets = ref<LlvOllamaTarget[]>([]);
const llvConfigLoading = ref(false);
const llvConfigSaving = ref(false);
const llvProbeLoading = ref(false);
const llvProbeResult = ref('');
const llvProcessLoading = ref(false);
const llvProcessStatus = ref<{ running: boolean; pid?: number; lastError?: string }>({ running: false });
const ollamaStatus = ref<{ running: boolean; loadedModels: string[] }>({ running: false, loadedModels: [] });
const ollamaStatusUpdatedAt = ref(0);
let ollamaStatusTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeProgress: (() => void) | null = null;
const configReturnTo = ref<'guide' | 'agent' | 'settings'>('guide');
const settingsWizardCompleted = ref(false);
const agentMessagesContainer = ref<HTMLElement | null>(null);

async function scrollAgentMessagesToBottom() {
  await nextTick();
  const el = agentMessagesContainer.value ?? (typeof document !== 'undefined' ? document.querySelector('.agent-messages') : null);
  if (!el) return;
  (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
}


const windowIsMaximized = ref(false);

const windowTitle = computed(() => {
  const n = route.name as string | undefined;
  const titles: Record<string, string> = {
    'install-detecting': '环境检测中',
    'install-result': '检测结果',
    'install-software': '安装向导',
    settings: '设置',
    agent: 'OpenClaw 对话',
    home: 'OpenClaw 安装助手',
  };
  return (n && titles[n]) || 'OpenClaw 安装助手';
});

async function syncWindowMaximizedState() {
  if (!window.electronAPI?.windowIsMaximized) return;
  windowIsMaximized.value = await window.electronAPI.windowIsMaximized().catch(() => false);
}

function onWindowMinimize() {
  void window.electronAPI?.windowMinimize?.();
}

async function onWindowMaximizeToggle() {
  if (!window.electronAPI?.windowMaximizeToggle) return;
  const next = await window.electronAPI.windowMaximizeToggle().catch(() => windowIsMaximized.value);
  windowIsMaximized.value = next;
}

function onWindowClose() {
  void window.electronAPI?.windowClose?.();
}

async function fetchOllamaStatus() {
  const r = await window.electronAPI?.ollamaStatus?.().catch(() => null);
  if (r) {
    ollamaStatus.value = r;
    ollamaStatusUpdatedAt.value = Date.now();
  }
}

watch(() => route.name, (n) => {
  if (n === 'settings') {
    fetchOllamaStatus();
    ollamaStatusTimer = setInterval(fetchOllamaStatus, 8000);
  } else {
    if (ollamaStatusTimer) {
      clearInterval(ollamaStatusTimer);
      ollamaStatusTimer = null;
    }
  }
}, { immediate: true });

async function bootstrap() {
  if (typeof window.electronAPI !== 'undefined') {
    try {
      await syncWindowMaximizedState();
      const info = await window.electronAPI.getPlatformInfo();
      const names: Record<string, string> = {
        win32: 'Windows',
        darwin: 'macOS',
        linux: 'Linux',
      };
      const os = names[info.platform] ?? info.platform;
      platformInfo.value = `当前系统: ${os} (${info.arch})`;
      const s = await window.electronAPI.getSettings().catch(() => ({}));
      if (s?.wizardCompleted) {
        await router.replace({ name: 'agent' });
        await loadAgentOllamaSettings();
      }
    } catch {
      platformInfo.value = '无法获取系统信息';
    }
  } else {
    platformInfo.value = '运行环境信息不可用';
  }
}

watch(
  () => agentMessages.value.length,
  () => {
    void scrollAgentMessagesToBottom();
  }
);

async function loadAgentOllamaSettings() {
  const s = await window.electronAPI?.getSettings?.().catch(() => ({}));
}

async function enterGuideFromReport(report: DetectionReport) {
  guideReport.value = report;
  if (window.electronAPI?.nvmIsInstalled) {
    nvmInstalled.value = await window.electronAPI.nvmIsInstalled();
  }
  if (window.electronAPI?.nvmSuggestedVersions) {
    nvmSuggestedVersions.value = await window.electronAPI.nvmSuggestedVersions();
  }
  const s = await window.electronAPI?.getSettings?.().catch(() => ({}));
  if (s?.nvmNodeMirror) settingsNvmNodeMirror.value = s.nvmNodeMirror;
  if (s?.nvmDefaultVersion) selectedNodeVersion.value = s.nvmDefaultVersion;
  if (window.electronAPI?.getNvmNodeMirrorPresets && !nvmMirrorPresets.value.length) {
    nvmMirrorPresets.value = await window.electronAPI.getNvmNodeMirrorPresets();
  }
}

async function onStart() {
  if (typeof window.electronAPI === 'undefined') {
    alert('无法连接主进程');
    return;
  }
  router.push({ name: 'install-detecting' });
  detectionProgress.value = '正在检测运行环境…';
  detectionResult.value = null;

  if (window.electronAPI.onDetectionProgress) {
    unsubscribeProgress = window.electronAPI.onDetectionProgress((data) => {
      detectionProgress.value = data.message;
    });
  }

  try {
    const report = await window.electronAPI.runDetection();
    detectionResult.value = report;
    if (report.canEnterGuide) {
      await enterGuideFromReport(report);
      router.push({ name: 'install-software' });
    } else {
      router.push({ name: 'install-result' });
    }
  } catch (e) {
    detectionResult.value = null;
    router.push({ name: 'install-result' });
    alert('检测失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    if (unsubscribeProgress) {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }
  }
}

function onBack() {
  router.push({ name: 'home' });
  detectionResult.value = null;
  guideReport.value = null;
}

async function onEnterGuide() {
  if (detectionResult.value) {
    await enterGuideFromReport(detectionResult.value);
    router.push({ name: 'install-software' });
  }
}

async function refreshGuide() {
  if (typeof window.electronAPI?.runDetection !== 'function') return;
  try {
    const report = await window.electronAPI.runDetection();
    guideReport.value = report;
  } catch {
    // ignore
  }
}

async function populateSettingsFields() {
  const s = await window.electronAPI!.getSettings();
  settingsNodePath.value = s.nodePath ?? '';
  settingsNpmRegistry.value = s.npmRegistry ?? '';
  settingsNvmNodeMirror.value = s.nvmNodeMirror ?? '';
  settingsNvmDefaultVersion.value = s.nvmDefaultVersion ?? '';
  if (window.electronAPI!.getNpmRegistryPresets) {
    npmRegistryPresets.value = await window.electronAPI.getNpmRegistryPresets();
  }
  if (window.electronAPI!.getNvmNodeMirrorPresets) {
    nvmMirrorPresets.value = await window.electronAPI.getNvmNodeMirrorPresets();
  }
  if (window.electronAPI!.nvmListInstalled) {
    nvmInstalledVersions.value = await window.electronAPI.nvmListInstalled();
  }
  settingsOpenclawVersion.value = s.openclawPackageVersion ?? 'latest';
  settingsWizardCompleted.value = s?.wizardCompleted ?? false;
  settingsChatBackend.value = s.chatBackend === 'ollama' ? 'ollama' : 'openclaw';
  const rawSec = (s as { gatewayChatTimeoutSec?: number }).gatewayChatTimeoutSec;
  settingsGatewayChatTimeoutSec.value = typeof rawSec === 'number' && Number.isFinite(rawSec)
    ? Math.min(300, Math.max(30, Math.round(rawSec)))
    : 90;
  await loadLlvOllamaConfig();
  await loadSettingsOllamaModels();
  await loadGuiAuditLogs();
}

async function loadLlvOllamaConfig() {
  if (!window.electronAPI?.getLlvOllamaConfig) return;
  llvConfigLoading.value = true;
  try {
    const cfg = await window.electronAPI.getLlvOllamaConfig();
    llvEnabled.value = cfg.enabled;
    llvListenHost.value = cfg.listenHost;
    llvListenPort.value = cfg.listenPort;
    llvStrategy.value = cfg.strategy;
    llvStickyByModel.value = cfg.stickyByModel;
    llvAggregateModels.value = cfg.aggregateModels;
    llvHealthIntervalSec.value = cfg.healthIntervalSec;
    llvHealthTimeoutMs.value = cfg.healthTimeoutMs;
    llvHealthFailThreshold.value = cfg.healthFailThreshold;
    llvTargets.value = Array.isArray(cfg.targets) ? cfg.targets : [];
    await refreshLlvProcessStatus();
  } finally {
    llvConfigLoading.value = false;
  }
}

async function refreshLlvProcessStatus() {
  if (!window.electronAPI?.getLlvOllamaProcessStatus) return;
  llvProcessStatus.value = await window.electronAPI.getLlvOllamaProcessStatus();
}

function addLlvTarget() {
  const nextIdx = llvTargets.value.length + 1;
  llvTargets.value.push({
    id: `target-${nextIdx}`,
    baseUrl: '',
    weight: 1,
    enabled: true,
  });
}

function removeLlvTarget(index: number) {
  llvTargets.value = llvTargets.value.filter((_, i) => i !== index);
}

async function probeLlvTarget(index: number) {
  if (!window.electronAPI?.probeLlvOllamaTarget || llvProbeLoading.value) return;
  const target = llvTargets.value[index];
  if (!target || !target.baseUrl.trim()) {
    llvProbeResult.value = '请先填写节点 baseUrl。';
    return;
  }
  llvProbeLoading.value = true;
  llvProbeResult.value = '';
  try {
    const r = await window.electronAPI.probeLlvOllamaTarget(target.baseUrl.trim(), target.apiKey?.trim() || undefined);
    llvProbeResult.value = r.ok ? `${target.id} 连通成功${r.status ? `（HTTP ${r.status}）` : ''}` : `${target.id} 连通失败：${r.error || '未知错误'}`;
  } finally {
    llvProbeLoading.value = false;
  }
}

async function saveLlvOllamaConfig() {
  if (!window.electronAPI?.setLlvOllamaConfig || llvConfigSaving.value) return;
  llvConfigSaving.value = true;
  try {
    const saved = await window.electronAPI.setLlvOllamaConfig({
      enabled: llvEnabled.value,
      listenHost: llvListenHost.value.trim() || '127.0.0.1',
      listenPort: Number(llvListenPort.value) || 11435,
      strategy: llvStrategy.value,
      stickyByModel: llvStickyByModel.value,
      aggregateModels: llvAggregateModels.value,
      healthIntervalSec: Number(llvHealthIntervalSec.value) || 15,
      healthTimeoutMs: Number(llvHealthTimeoutMs.value) || 3000,
      healthFailThreshold: Number(llvHealthFailThreshold.value) || 3,
      targets: llvTargets.value.map((t, i) => ({
        id: t.id?.trim() || `target-${i + 1}`,
        baseUrl: t.baseUrl?.trim() || '',
        weight: Number(t.weight) || 1,
        enabled: t.enabled !== false,
        apiKey: t.apiKey?.trim() || undefined,
      })),
    });
    llvTargets.value = saved.targets;
    alert('分布式算力配置已保存');
  } catch (e) {
    alert('保存分布式算力配置失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    llvConfigSaving.value = false;
  }
}

async function startLlvOllamaProcess() {
  if (!window.electronAPI?.startLlvOllamaProcess || llvProcessLoading.value) return;
  llvProcessLoading.value = true;
  try {
    const r = await window.electronAPI.startLlvOllamaProcess();
    if (!r.success) {
      alert('启动 llv-ollama 失败: ' + (r.error || '未知错误'));
    } else if (r.alreadyRunning) {
      alert('llv-ollama 已在运行');
    }
    await refreshLlvProcessStatus();
  } finally {
    llvProcessLoading.value = false;
  }
}

async function stopLlvOllamaProcess() {
  if (!window.electronAPI?.stopLlvOllamaProcess || llvProcessLoading.value) return;
  llvProcessLoading.value = true;
  try {
    const r = await window.electronAPI.stopLlvOllamaProcess();
    if (!r.success) alert('停止 llv-ollama 失败');
    await refreshLlvProcessStatus();
  } finally {
    llvProcessLoading.value = false;
  }
}

async function applyLlvProviderToOpenClaw() {
  if (!window.electronAPI?.applyLlvProviderToOpenClaw) return;
  const baseUrl = `http://${llvListenHost.value.trim() || '127.0.0.1'}:${Number(llvListenPort.value) || 11435}`;
  const r = await window.electronAPI.applyLlvProviderToOpenClaw(baseUrl);
  if (r.success) {
    alert('已写入 OpenClaw provider：ollama-lv（baseUrl 指向 llv）');
  } else {
    alert('写入 OpenClaw provider 失败: ' + (r.error || '未知错误'));
  }
}

async function onSettings() {
  if (typeof window.electronAPI?.getSettings !== 'function') {
    alert('设置功能不可用');
    return;
  }
  settingsCategory.value = 'overview';
  try {
    await populateSettingsFields();
    router.push({ name: 'settings' });
  } catch {
    router.push({ name: 'settings' });
  }
}

async function loadGuiAuditLogs() {
  if (!window.electronAPI?.getGuiAuditLogs || settingsGuiAuditLoading.value) return;
  settingsGuiAuditLoading.value = true;
  try {
    settingsGuiAuditLogs.value = await window.electronAPI.getGuiAuditLogs(60);
  } catch {
    settingsGuiAuditLogs.value = [];
  } finally {
    settingsGuiAuditLoading.value = false;
  }
}

async function exportGuiAuditLogs() {
  if (!window.electronAPI?.exportGuiAuditLogs) return;
  const payload = settingsGuiAuditExportText.value;
  if (!payload.trim()) {
    alert('当前筛选结果为空，无可导出内容。');
    return;
  }
  const r = await window.electronAPI.exportGuiAuditLogs(payload);
  if (r.success) alert(`已导出 GUI 审计日志：${r.path}`);
  else alert(r.error ?? '导出失败');
}

async function saveSettings() {
  if (typeof window.electronAPI?.setSettings !== 'function') return;
  try {
    const timeoutSec = Math.min(300, Math.max(30, Math.round(Number(settingsGatewayChatTimeoutSec.value) || 90)));
    await window.electronAPI.setSettings({
      nodePath: settingsNodePath.value.trim() || undefined,
      npmRegistry: settingsNpmRegistry.value.trim() || undefined,
      nvmNodeMirror: settingsNvmNodeMirror.value.trim() || undefined,
      nvmDefaultVersion: settingsNvmDefaultVersion.value.trim() || undefined,
      openclawPackageVersion: settingsOpenclawVersion.value.trim() || undefined,
      chatBackend: settingsChatBackend.value,
      gatewayChatTimeoutSec: timeoutSec,
    });
    const s = await window.electronAPI.getSettings().catch(() => ({}));
    router.push({ name: s?.wizardCompleted ? 'agent' : 'home' });
  } catch (e) {
    alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function onBackFromSettings() {
  const s = await window.electronAPI?.getSettings?.().catch(() => ({}));
  router.push({ name: s?.wizardCompleted ? 'agent' : 'home' });
}

function openNodeUrl() {
  window.electronAPI?.getNodeDownloadUrl?.().then((url) => {
    if (url) window.open(url, '_blank');
  });
}

async function doInstallNvm() {
  if (!window.electronAPI?.nvmInstall || nvmInstallRunning.value) return;
  nvmInstallRunning.value = true;
  nvmInstallProgress.value = '正在安装 nvm…';
  const unsub = window.electronAPI.onNvmProgress?.((msg) => { nvmInstallProgress.value = msg; });
  try {
    const r = await window.electronAPI.nvmInstall();
    if (r.success) {
      nvmInstalled.value = true;
      await refreshGuide();
    } else alert(r.error || '安装失败');
  } finally {
    unsub?.();
    nvmInstallRunning.value = false;
    nvmInstallProgress.value = '';
  }
}

async function doInstallNodeViaNvm() {
  if (!window.electronAPI?.nvmInstallVersion || nvmInstallRunning.value) return;
  const version = selectedNodeVersion.value;
  const mirror = settingsNvmNodeMirror.value.trim() || undefined;
  nvmInstallRunning.value = true;
  nvmInstallProgress.value = `正在安装 Node ${version}…`;
  const unsub = window.electronAPI.onNvmProgress?.((msg) => { nvmInstallProgress.value = msg; });
  try {
    const r = await window.electronAPI.nvmInstallVersion(version, mirror);
    if (!r.success) {
      alert(r.error || r.stderr || '安装失败');
      return;
    }
    const aliasR = await window.electronAPI.nvmAliasDefault(version);
    if (!aliasR.success) alert('设为默认失败: ' + aliasR.error);
    await window.electronAPI.setSettings({ nvmDefaultVersion: version });
    await refreshGuide();
  } finally {
    unsub?.();
    nvmInstallRunning.value = false;
    nvmInstallProgress.value = '';
  }
}

async function setNvmDefaultVersion(version: string) {
  if (!window.electronAPI?.nvmAliasDefault || !window.electronAPI?.setSettings) return;
  try {
    const r = await window.electronAPI.nvmAliasDefault(version);
    if (r.success) {
      await window.electronAPI.setSettings({ nvmDefaultVersion: version });
      settingsNvmDefaultVersion.value = version;
    } else alert(r.error);
  } catch (e) {
    alert(String(e));
  }
}

async function openConfigDir() {
  const r = await window.electronAPI?.openConfigDir?.();
  if (r && !r.success && r.error) alert('打开失败: ' + r.error);
}

async function doReinstallOpenClawInSettings() {
  if (!window.electronAPI?.setSettings || !window.electronAPI?.installOpenClaw || settingsReinstallOpenClawRunning.value) return;
  await window.electronAPI.setSettings({ openclawPackageVersion: settingsOpenclawVersion.value.trim() || undefined });
  settingsReinstallOpenClawRunning.value = true;
  settingsReinstallOpenClawLog.value = '正在安装…\n';
  const unsub = window.electronAPI.onInstallOpenClawProgress?.((d) => {
    settingsReinstallOpenClawLog.value += d.data;
  });
  try {
    const r = await window.electronAPI.installOpenClaw();
    settingsReinstallOpenClawLog.value += r.stdout + r.stderr;
    if (r.error) settingsReinstallOpenClawLog.value += '\n错误: ' + r.error;
    if (r.success) alert('OpenClaw 安装完成');
  } finally {
    unsub?.();
    settingsReinstallOpenClawRunning.value = false;
  }
}

/** 一键应用本地模型：在主进程内一次性写入 models.providers["ollama-local"] 与默认模型，避免 models 被覆盖 */
async function onApplyLocalModel() {
  if (!window.electronAPI?.applyLocalModel || !window.electronAPI?.ollamaListModels || settingsApplyLocalModelLoading.value) return;
  settingsApplyLocalModelLoading.value = true;
  try {
    let list = settingsOllamaModelsForApply.value.length ? settingsOllamaModelsForApply.value : (await window.electronAPI.ollamaListModels?.() ?? []);
    if (list.length === 0) {
      const running = await window.electronAPI.ollamaIsRunning?.();
      if (!running && window.electronAPI.ollamaServe) {
        await new Promise<void>((resolve, reject) => {
          window.electronAPI.ollamaServe!().then((r) => (r.success ? resolve() : reject(new Error(r.error)))).catch(reject);
        });
        list = await window.electronAPI.ollamaListModels?.() ?? [];
      }
    }
    if (list.length === 0) {
      alert('未检测到 Ollama 模型。请先启动 Ollama 并拉取模型（如 ollama pull llama3.2）');
      return;
    }
    const modelName = (settingsSelectedOllamaForApply.value?.trim() || list[0].name).trim();
    const r = await window.electronAPI.applyLocalModel(modelName);
    if (!r.success) {
      alert('一键应用失败: ' + (r.error ?? ''));
      return;
    }
    settingsOllamaModelsForApply.value = list;
    if (!settingsSelectedOllamaForApply.value) settingsSelectedOllamaForApply.value = modelName;
    alert('已应用本地模型：' + modelName + '。若网关已运行，请先「停止网关」再「由本应用启动网关」以加载新配置，然后使用对话。');
  } catch (e) {
    alert('一键应用失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    settingsApplyLocalModelLoading.value = false;
  }
}

/** 诊断网关 500 可能原因（默认模型、Ollama、模型是否已拉取） */
async function onGatewayDiagnostic() {
  if (!window.electronAPI?.openclawGateway500Diagnostic || gatewayDiagnosticLoading.value) return;
  gatewayDiagnosticLoading.value = true;
  try {
    const r = await window.electronAPI.openclawGateway500Diagnostic();
    const msg = r.details?.length ? r.details.join('\n• ') : r.summary;
    alert('网关/模型诊断：\n• ' + msg);
  } catch (e) {
    alert('诊断失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    gatewayDiagnosticLoading.value = false;
  }
}

/** 手动调用 GET /v1/models，若为 HTML 则再测 POST /v1/chat/completions 并显示结果 */
async function onTestGatewayV1Models() {
  if (!window.electronAPI?.testGatewayV1Models || testV1ModelsLoading.value) return;
  testV1ModelsLoading.value = true;
  try {
    const r = await window.electronAPI.testGatewayV1Models();
    let msg = `状态: ${r.success ? '成功' : '失败'}`;
    if (r.status != null) msg += `\nHTTP ${r.status} ${r.statusText ?? ''}`;
    if (r.error) msg += `\n\n${r.error}`;
    if (r.chatCompletionsCheck) {
      const c = r.chatCompletionsCheck;
      const label = c.ok ? 'API 可用' : c.status === 500 ? '500，对话会报错' : '未返回 API';
      msg += `\n\nPOST /v1/chat/completions: ${c.status} (${label})`;
      if (c.bodyPreview) msg += `\n响应摘要: ${c.bodyPreview}`;
    }
    if (r.diagnosticDetails?.length) {
      msg += '\n\n500 诊断：';
      r.diagnosticDetails.forEach((d) => { msg += '\n• ' + d; });
    }
    if (r.modelIds?.length) msg += `\n解析到的模型 id: ${r.modelIds.join(', ')}`;
    if (r.rawBody) msg += `\n\nGET /v1/models 响应体(前 800 字):\n${r.rawBody}`;
    alert(msg);
  } catch (e) {
    alert('请求失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    testV1ModelsLoading.value = false;
  }
}

/** 验证请求链：先直连 Ollama 再请求网关，看请求是否到达 Ollama */
async function onVerifyRequestChain() {
  if (!window.electronAPI?.verifyRequestChain || verifyRequestChainLoading.value) return;
  verifyRequestChainLoading.value = true;
  try {
    const r = await window.electronAPI.verifyRequestChain();
    const o = r.ollama;
    const g = r.gateway;
    let msg = `使用模型: ${r.model}\n\n`;
    msg += `1) Ollama 直连 (POST 127.0.0.1:11434/api/chat)\n   ${o.ok ? `成功 ${o.ms}ms` : `失败 ${o.ms}ms${o.error ? ': ' + o.error : ''}`}\n\n`;
    msg += `2) 网关 (POST /v1/chat/completions)\n   ${g.ok ? `成功 ${g.ms}ms` : `失败 ${g.ms}ms${g.error ? ': ' + g.error : ''}`}\n\n`;
    if (o.ok && !g.ok) msg += '结论: 请求未从网关到达 Ollama，或网关未正确转发。请检查 auth-profiles.json、网关日志。';
    else if (!o.ok) msg += '结论: 直连 Ollama 即失败，请确认 Ollama 已启动、模型已拉取。';
    else if (g.ok) msg += '结论: 两端均正常，主界面对话应可用。';
    else msg += '结论: 网关未返回有效响应，请查看上方错误。';
    alert(msg);
  } catch (e) {
    alert('验证失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    verifyRequestChainLoading.value = false;
  }
}

async function loadSettingsOllamaModels() {
  const list = await window.electronAPI?.ollamaListModels?.() ?? [];
  settingsOllamaModelsForApply.value = list;
  if (list.length > 0 && !settingsSelectedOllamaForApply.value) settingsSelectedOllamaForApply.value = list[0].name;
}

async function doInstallOpenClaw() {
  if (!window.electronAPI?.installOpenClaw || installOpenClawRunning.value) return;
  installOpenClawRunning.value = true;
  installOpenClawLog.value = '正在安装 OpenClaw…\n';
  const unsub = window.electronAPI.onInstallOpenClawProgress?.((d) => {
    installOpenClawLog.value += d.data;
  });
  try {
    const r = await window.electronAPI.installOpenClaw();
    installOpenClawLog.value += r.stdout + r.stderr;
    if (r.error) installOpenClawLog.value += '\n错误: ' + r.error;
    if (r.success) await refreshGuide();
  } finally {
    unsub?.();
    installOpenClawRunning.value = false;
  }
}

/** 由本应用直接启动网关（关闭应用后由本应用拉起的网关会停止） */
async function doStartGatewayInProcess() {
  if (!window.electronAPI?.startGatewayInProcess || startGatewayInProcessRunning.value) return;
  startGatewayInProcessRunning.value = true;
  try {
    const r = await window.electronAPI.startGatewayInProcess();
    if (r.success) {
      if (r.alreadyRunning) alert('网关已在运行');
      else alert('网关已由本应用启动');
      await refreshGuide();
    } else {
      alert('启动失败: ' + (r.error || '未知错误'));
    }
  } finally {
    startGatewayInProcessRunning.value = false;
  }
}

async function doStopGatewayInProcess() {
  if (!window.electronAPI?.stopGatewayInProcess) return;
  const r = await window.electronAPI.stopGatewayInProcess();
  if (r.success) {
    alert('已停止由本应用启动的网关');
    await refreshGuide();
  }
}

const stepLabels: Record<string, string> = {
  env: '运行环境',
  node: 'Node.js',
  npm: 'npm',
  openclaw: 'OpenClaw CLI',
  gateway: 'OpenClaw 网关',
  config: '配置文件',
  ollama: 'Ollama（可选）',
};

const guideSteps: { key: string; getStep: (r: DetectionReport) => StepResult }[] = [
  { key: 'env', getStep: (r) => r.env },
  { key: 'node', getStep: (r) => r.node },
  { key: 'npm', getStep: (r) => r.npm },
  { key: 'openclaw', getStep: (r) => r.openclaw },
  { key: 'gateway', getStep: (r) => r.gateway },
  { key: 'config', getStep: (r) => r.config },
];

const resultSteps = computed(() => {
  if (!detectionResult.value) return [];
  const r = detectionResult.value;
  return [
    { k: 'env', s: r.env },
    { k: 'node', s: r.node },
    { k: 'npm', s: r.npm },
    { k: 'openclaw', s: r.openclaw },
    { k: 'gateway', s: r.gateway },
    { k: 'config', s: r.config },
    { k: 'ollama', s: r.ollama },
  ];
});

const guideAllPassed = computed(() => {
  if (!guideReport.value) return false;
  return guideSteps.every((s) => s.getStep(guideReport.value!).ok);
});

async function loadOpenClawFormData() {
  try {
    const [{ form }, settings] = await Promise.all([
      window.electronAPI?.getOpenClawConfig?.() ?? Promise.resolve({ form: null }),
      window.electronAPI?.getSettings?.() ?? Promise.resolve({} as AppSettings),
    ]);
    if (form) {
      openclawForm.value = {
        modelSource: form.modelSource ?? 'cloud',
        defaultModel: form.defaultModel ?? '',
        gatewayPort: form.gatewayPort ?? 18789,
        gatewayToken: form.gatewayToken ?? '',
        openaiApiKey: form.openaiApiKey ?? '',
        anthropicApiKey: form.anthropicApiKey ?? '',
        googleGeminiApiKey: form.googleGeminiApiKey ?? '',
        discordEnabled: form.discordEnabled === true,
        discordBotToken: form.discordBotToken ?? '',
        discordAllowFromUserId: form.discordAllowFromUserId ?? '',
        discordGuildId: form.discordGuildId ?? '',
        telegramBotToken: form.telegramBotToken ?? '',
        slackBotToken: form.slackBotToken ?? '',
        slackAppToken: form.slackAppToken ?? '',
        feishuAppSecret: form.feishuAppSecret ?? '',
        mattermostBotToken: form.mattermostBotToken ?? '',
        guiEnabled: settings.guiEnabled === true,
        guiAllowApps: settings.guiAllowApps ?? '',
        guiRequireConfirmForDangerous: settings.guiRequireConfirmForDangerous !== false,
      };
    }
  } catch {
    // keep defaults
  }
}

async function onEnterConfig(returnTo: 'guide' | 'agent' | 'settings' = 'guide') {
  configReturnTo.value = returnTo;
  if (typeof window.electronAPI?.getSettings !== 'function') {
    alert('设置功能不可用');
    return;
  }
  try {
    await populateSettingsFields();
    settingsCategory.value = 'openclaw';
    await loadOpenClawFormData();
    router.push({ name: 'settings' });
  } catch {
    router.push({ name: 'settings' });
    settingsCategory.value = 'openclaw';
    await loadOpenClawFormData();
  }
}

function onSettingsCategorySelect(key: string) {
  settingsCategory.value = key as SettingsCategory;
  if (key === 'openclaw') {
    configReturnTo.value = 'settings';
    void loadOpenClawFormData();
  }
  if (key === 'automation') void loadGuiAuditLogs();
  if (key === 'distributed-compute') void loadLlvOllamaConfig();
}

async function onCompleteConfig() {
  if (!window.electronAPI?.setOpenClawConfig || !window.electronAPI?.setSettings) return;
  configSaveLoading.value = true;
  try {
    const r = await window.electronAPI.setOpenClawConfig({
      modelSource: openclawForm.value.modelSource,
      defaultModel: openclawForm.value.defaultModel || undefined,
      gatewayPort: openclawForm.value.gatewayPort,
      gatewayToken: openclawForm.value.gatewayToken || undefined,
      openaiApiKey: openclawForm.value.openaiApiKey,
      anthropicApiKey: openclawForm.value.anthropicApiKey,
      googleGeminiApiKey: openclawForm.value.googleGeminiApiKey,
      discordEnabled: openclawForm.value.discordEnabled,
      discordBotToken: openclawForm.value.discordBotToken,
      discordAllowFromUserId: openclawForm.value.discordAllowFromUserId,
      discordGuildId: openclawForm.value.discordGuildId,
      telegramBotToken: openclawForm.value.telegramBotToken,
      slackBotToken: openclawForm.value.slackBotToken,
      slackAppToken: openclawForm.value.slackAppToken,
      feishuAppSecret: openclawForm.value.feishuAppSecret,
      mattermostBotToken: openclawForm.value.mattermostBotToken,
    });
    if (!r.success) {
      alert(r.error ?? '保存配置失败');
      return;
    }
    await window.electronAPI.setSettings({
      wizardCompleted: true,
      guiEnabled: openclawForm.value.guiEnabled,
      guiAllowApps: openclawForm.value.guiAllowApps,
      guiRequireConfirmForDangerous: openclawForm.value.guiRequireConfirmForDangerous,
    });
    settingsWizardCompleted.value = true;
    router.push({ name: 'agent' });
  } finally {
    configSaveLoading.value = false;
  }
}

async function saveOpenClawFormFromSettings() {
  if (!window.electronAPI?.setOpenClawConfig || !window.electronAPI?.setSettings) return;
  configSaveLoading.value = true;
  try {
    const r = await window.electronAPI.setOpenClawConfig({
      modelSource: openclawForm.value.modelSource,
      defaultModel: openclawForm.value.defaultModel || undefined,
      gatewayPort: openclawForm.value.gatewayPort,
      gatewayToken: openclawForm.value.gatewayToken || undefined,
      openaiApiKey: openclawForm.value.openaiApiKey,
      anthropicApiKey: openclawForm.value.anthropicApiKey,
      googleGeminiApiKey: openclawForm.value.googleGeminiApiKey,
      discordEnabled: openclawForm.value.discordEnabled,
      discordBotToken: openclawForm.value.discordBotToken,
      discordAllowFromUserId: openclawForm.value.discordAllowFromUserId,
      discordGuildId: openclawForm.value.discordGuildId,
      telegramBotToken: openclawForm.value.telegramBotToken,
      slackBotToken: openclawForm.value.slackBotToken,
      slackAppToken: openclawForm.value.slackAppToken,
      feishuAppSecret: openclawForm.value.feishuAppSecret,
      mattermostBotToken: openclawForm.value.mattermostBotToken,
    });
    if (!r.success) {
      alert(r.error ?? '保存配置失败');
      return;
    }
    await window.electronAPI.setSettings({
      guiEnabled: openclawForm.value.guiEnabled,
      guiAllowApps: openclawForm.value.guiAllowApps,
      guiRequireConfirmForDangerous: openclawForm.value.guiRequireConfirmForDangerous,
    });
    alert('OpenClaw 配置已保存');
  } finally {
    configSaveLoading.value = false;
  }
}

function onBackFromOpenclawPanel() {
  if (configReturnTo.value === 'agent') {
    router.push({ name: 'agent' });
    loadAgentOllamaSettings();
  } else if (configReturnTo.value === 'settings') {
    settingsCategory.value = 'overview';
  } else {
    router.push({ name: 'install-software' });
  }
}

async function onFreeModelYes() {
  freeModelChoice.value = 'yes';
  const running = await window.electronAPI?.ollamaIsRunning?.();
  if (running) {
    const list = await window.electronAPI?.ollamaListModels?.() ?? [];
    ollamaModels.value = list;
    if (list.length > 0 && !selectedOllamaModel.value) selectedOllamaModel.value = list[0].name;
  }
}

function onFreeModelNo() {
  freeModelChoice.value = 'no';
}

async function onOllamaServe() {
  if (!window.electronAPI?.ollamaServe || ollamaServeRunning.value) return;
  ollamaServeRunning.value = true;
  ollamaServeProgress.value = '正在启动 Ollama…';
  unsubOllamaProgress = window.electronAPI.onOllamaServeProgress?.((msg) => { ollamaServeProgress.value = msg; });
  try {
    const r = await window.electronAPI.ollamaServe();
    if (r.success) {
      const list = await window.electronAPI?.ollamaListModels?.() ?? [];
      ollamaModels.value = list;
      if (list.length > 0) selectedOllamaModel.value = list[0].name;
    } else alert(r.error ?? '启动失败');
  } finally {
    unsubOllamaProgress?.();
    ollamaServeRunning.value = false;
    ollamaServeProgress.value = '';
  }
}

async function onWriteOllamaProvider() {
  const model = selectedOllamaModel.value.trim();
  if (!model || !window.electronAPI?.ollamaWriteProvider) return;
  const r = await window.electronAPI.ollamaWriteProvider(model);
  if (r.success) {
    ollamaProviderWritten.value = true;
    await window.electronAPI?.setSettings?.({ ollamaChatModel: model });
  } else alert(r.error ?? '写入配置失败');
}

async function onAgentSend() {
  const text = agentInput.value.trim();
  if (!text || !window.electronAPI?.chatSend || agentLoading.value || agentStreaming.value) return;

  agentInput.value = '';
  agentMessages.value.push({ role: 'user', content: text });
  const messages = agentMessages.value
    .slice(-MAX_CHAT_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
  agentMessages.value.push({ role: 'assistant', content: '' });
  const assistantIndex = agentMessages.value.length - 1;
  agentLoading.value = true;
  const useStream = true;

  if (useStream && window.electronAPI.onChatStreamDelta && window.electronAPI.onChatStreamDone) {
    agentStreaming.value = true;
    unsubStreamDelta = window.electronAPI.onChatStreamDelta((delta) => {
      agentMessages.value[assistantIndex].content += delta;
      const c = agentMessages.value[assistantIndex].content;
      const lower = c.trim().toLowerCase();
      if (lower === 'terminated' || lower === '[done]') {
        agentMessages.value[assistantIndex].content = '';
      } else if (/\n\s*(terminated|\[done\])\s*$/i.test(c)) {
        agentMessages.value[assistantIndex].content = c.replace(/\n\s*(terminated|\[done\])\s*$/gi, '').trim();
      }
      void scrollAgentMessagesToBottom();
    });
    unsubStreamDone = window.electronAPI.onChatStreamDone(() => {
      agentStreaming.value = false;
      agentLoading.value = false;
      let c = agentMessages.value[assistantIndex].content;
      if (typeof c === 'string') {
        const lower = c.trim().toLowerCase();
        if (lower === 'terminated' || lower === '[done]') {
          agentMessages.value[assistantIndex].content = '';
        } else {
          // 去掉末尾的换行+terminated/[done]（网关结束标记），保留正常句尾的 terminated 用词
          c = c.replace(/\n\s*(terminated|\[done\])\s*$/gi, '').trim();
          agentMessages.value[assistantIndex].content = sanitizeAssistantOutput(c);
        }
      }
      unsubStreamDelta?.();
      unsubStreamDone?.();
      unsubStreamDelta = null;
      unsubStreamDone = null;
    });
    try {
      const r = await window.electronAPI.chatSend(messages, true);
      const receiptText = renderExecutionReceipt(r.executionReceipt);
      if (receiptText) {
        const prev = agentMessages.value[assistantIndex].content || '';
        agentMessages.value[assistantIndex].content = prev ? `${receiptText}\n\n${prev}` : receiptText;
      }
      if (!r.success) {
        const base = r.error ?? '请求失败';
        agentMessages.value[assistantIndex].content = receiptText ? `${receiptText}\n\n${base}` : base;
      }
      void scrollAgentMessagesToBottom();
    } catch (e) {
      agentMessages.value[assistantIndex].content = (e as Error)?.message ?? '请求异常，请重试。';
      void scrollAgentMessagesToBottom();
    } finally {
      agentStreaming.value = false;
      agentLoading.value = false;
      unsubStreamDelta?.();
      unsubStreamDone?.();
      unsubStreamDelta = null;
      unsubStreamDone = null;
    }
  } else {
    const s = await window.electronAPI.getSettings().catch(() => ({}));
    const rawSec = (s as { gatewayChatTimeoutSec?: number }).gatewayChatTimeoutSec;
    const timeoutSec = typeof rawSec === 'number' && Number.isFinite(rawSec)
      ? Math.min(300, Math.max(30, Math.round(rawSec)))
      : 90;
    const CHAT_TIMEOUT_MS = timeoutSec * 1000;
    const startMs = Date.now();
    try {
      const r = await Promise.race([
        window.electronAPI.chatSend(messages, false),
        new Promise<{ success: false; error: string }>((_, reject) =>
          setTimeout(() => {
            const elapsedSec = Math.round((Date.now() - startMs) / 1000);
            reject(new Error(`请求超时（已等待 ${elapsedSec} 秒）`));
          }, CHAT_TIMEOUT_MS)
        ),
      ]);
      if (r.success && r.content !== undefined) {
        agentMessages.value[assistantIndex].content = sanitizeAssistantOutput(r.content);
      } else {
        agentMessages.value[assistantIndex].content = r.error ?? '请求失败';
      }
      const receiptText = renderExecutionReceipt(r.executionReceipt);
      if (receiptText) {
        const prev = agentMessages.value[assistantIndex].content || '';
        agentMessages.value[assistantIndex].content = prev ? `${receiptText}\n\n${prev}` : receiptText;
      }
      if (agentMessages.value[assistantIndex].content === '') {
        agentMessages.value[assistantIndex].content = '未收到回复，请检查网关是否已启动且鉴权 Token 正确。';
      }
      void scrollAgentMessagesToBottom();
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      agentMessages.value[assistantIndex].content = msg.startsWith('请求超时')
        ? `${msg}。若在终端用 openclaw gateway --verbose 看到 "embedded run agent start" 且无报错，说明请求已到网关并已交模型侧，多半是首 token 较慢（如 system prompt 很大）；可改用「流式对话」或稍后再试。否则请检查：1) 网关已启动（设置 → 由本应用启动网关）；2) 鉴权 Token 正确。`
        : msg || '请求异常，请重试。';
      void scrollAgentMessagesToBottom();
    } finally {
      agentLoading.value = false;
    }
  }
}
  return {
    settingsNavItems,
    MARKDOWN_PLACEHOLDER,
    STREAMING_PLACEHOLDER,
    DISCORD_TOOLTIP_TOKEN,
    DISCORD_TOOLTIP_USER,
    DISCORD_TOOLTIP_GUILD,
    DISCORD_TOOLTIP_ENABLED,
    MODEL_TOOLTIP_OPENAI,
    MODEL_TOOLTIP_ANTHROPIC,
    MODEL_TOOLTIP_GOOGLE,
    CHAT_TOOLTIP_TELEGRAM,
    CHAT_TOOLTIP_SLACK_BOT,
    CHAT_TOOLTIP_SLACK_APP,
    CHAT_TOOLTIP_FEISHU,
    CHAT_TOOLTIP_MATTERMOST,
    GUI_TOOLTIP_ENABLED,
    GUI_TOOLTIP_ALLOW_APPS,
    GUI_TOOLTIP_CONFIRM,
    renderMarkdown,
    renderExecutionReceipt,
    sanitizeAssistantOutput,
    platformInfo,
    router,
    route,
    settingsCategory,
    settingsNodePath,
    settingsNpmRegistry,
    settingsNvmNodeMirror,
    settingsNvmDefaultVersion,
    npmRegistryPresets,
    nvmMirrorPresets,
    nvmInstalledVersions,
    detectionProgress,
    nvmInstalled,
    nvmSuggestedVersions,
    selectedNodeVersion,
    nvmInstallRunning,
    nvmInstallProgress,
    detectionResult,
    guideReport,
    installOpenClawLog,
    installOpenClawRunning,
    startGatewayInProcessRunning,
    openclawForm,
    agentInput,
    configSaveLoading,
    agentMessages,
    MAX_CHAT_HISTORY_MESSAGES,
    agentLoading,
    agentStreaming,
    freeModelChoice,
    ollamaModels,
    selectedOllamaModel,
    ollamaServeRunning,
    ollamaServeProgress,
    ollamaProviderWritten,
    settingsOpenclawVersion,
    settingsReinstallOpenClawRunning,
    settingsReinstallOpenClawLog,
    settingsGuiAuditLogs,
    settingsGuiAuditLoading,
    settingsGuiAuditStatusFilter,
    settingsGuiAuditRiskFilter,
    settingsGuiAuditFiltered,
    settingsGuiAuditExportText,
    settingsOllamaModelsForApply,
    settingsSelectedOllamaForApply,
    settingsApplyLocalModelLoading,
    gatewayDiagnosticLoading,
    testV1ModelsLoading,
    verifyRequestChainLoading,
    settingsChatBackend,
    settingsGatewayChatTimeoutSec,
    llvEnabled,
    llvListenHost,
    llvListenPort,
    llvStrategy,
    llvStickyByModel,
    llvAggregateModels,
    llvHealthIntervalSec,
    llvHealthTimeoutMs,
    llvHealthFailThreshold,
    llvTargets,
    llvConfigLoading,
    llvConfigSaving,
    llvProbeLoading,
    llvProbeResult,
    llvProcessLoading,
    llvProcessStatus,
    ollamaStatus,
    ollamaStatusUpdatedAt,
    configReturnTo,
    settingsWizardCompleted,
    agentMessagesContainer,
    scrollAgentMessagesToBottom,
    windowIsMaximized,
    windowTitle,
    syncWindowMaximizedState,
    onWindowMinimize,
    onWindowMaximizeToggle,
    onWindowClose,
    fetchOllamaStatus,
    bootstrap,
    loadAgentOllamaSettings,
    enterGuideFromReport,
    onStart,
    onBack,
    onEnterGuide,
    refreshGuide,
    populateSettingsFields,
    onSettings,
    loadGuiAuditLogs,
    exportGuiAuditLogs,
    saveSettings,
    onBackFromSettings,
    openNodeUrl,
    doInstallNvm,
    doInstallNodeViaNvm,
    setNvmDefaultVersion,
    openConfigDir,
    doReinstallOpenClawInSettings,
    onApplyLocalModel,
    onGatewayDiagnostic,
    onTestGatewayV1Models,
    onVerifyRequestChain,
    loadLlvOllamaConfig,
    saveLlvOllamaConfig,
    addLlvTarget,
    removeLlvTarget,
    probeLlvTarget,
    refreshLlvProcessStatus,
    startLlvOllamaProcess,
    stopLlvOllamaProcess,
    applyLlvProviderToOpenClaw,
    loadSettingsOllamaModels,
    doInstallOpenClaw,
    doStartGatewayInProcess,
    doStopGatewayInProcess,
    stepLabels,
    guideSteps,
    resultSteps,
    guideAllPassed,
    loadOpenClawFormData,
    onEnterConfig,
    onSettingsCategorySelect,
    onCompleteConfig,
    saveOpenClawFormFromSettings,
    onBackFromOpenclawPanel,
    onFreeModelYes,
    onFreeModelNo,
    onOllamaServe,
    onWriteOllamaProvider,
    onAgentSend
  };
});

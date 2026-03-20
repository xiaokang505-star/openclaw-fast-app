<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { DetectionReport, StepResult } from './types';
import type { GuiExecutionReceipt, GuiAuditLogEntry } from './env';

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

const platformInfo = ref('正在获取系统信息…');
const view = ref<'home' | 'detecting' | 'result' | 'guide' | 'settings' | 'config' | 'agent'>('home');
const settingsNodePath = ref('');
const settingsNpmRegistry = ref('');
const settingsNvmNodeMirror = ref('');
const settingsNvmDefaultVersion = ref('');
const npmRegistryPresets = ref<{ id: string; name: string; url: string }[]>([]);
const nvmMirrorPresets = ref<{ id: string; name: string; url: string }[]>([]);
const nvmInstalledVersions = ref<string[]>([]);
const detectionProgress = ref('正在检测运行环境…');
const nvmInstalled = ref(false);
const nvmSuggestedVersions = ref<string[]>(['22', '20', '18']);
const selectedNodeVersion = ref('22');
const nvmInstallRunning = ref(false);
const nvmInstallProgress = ref('');
const detectionResult = ref<DetectionReport | null>(null);
const guideReport = ref<DetectionReport | null>(null);
const installOpenClawLog = ref('');
const installOpenClawRunning = ref(false);
const installDaemonRunning = ref(false);
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
const ollamaStatus = ref<{ running: boolean; loadedModels: string[] }>({ running: false, loadedModels: [] });
const ollamaStatusUpdatedAt = ref(0);
let ollamaStatusTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeProgress: (() => void) | null = null;
const configReturnTo = ref<'guide' | 'agent' | 'settings'>('guide');
const settingsWizardCompleted = ref(false);

async function fetchOllamaStatus() {
  const r = await window.electronAPI?.ollamaStatus?.().catch(() => null);
  if (r) {
    ollamaStatus.value = r;
    ollamaStatusUpdatedAt.value = Date.now();
  }
}

watch(view, (v) => {
  if (v === 'settings') {
    fetchOllamaStatus();
    ollamaStatusTimer = setInterval(fetchOllamaStatus, 8000);
  } else {
    if (ollamaStatusTimer) {
      clearInterval(ollamaStatusTimer);
      ollamaStatusTimer = null;
    }
  }
}, { immediate: true });

onMounted(async () => {
  if (typeof window.electronAPI !== 'undefined') {
    try {
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
        view.value = 'agent';
        await loadAgentOllamaSettings();
      }
    } catch {
      platformInfo.value = '无法获取系统信息';
    }
  } else {
    platformInfo.value = '运行环境信息不可用';
  }
});

async function loadAgentOllamaSettings() {
  const s = await window.electronAPI?.getSettings?.().catch(() => ({}));
}

async function onStart() {
  if (typeof window.electronAPI === 'undefined') {
    alert('无法连接主进程');
    return;
  }
  view.value = 'detecting';
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
    view.value = 'result';
  } catch (e) {
    detectionResult.value = null;
    view.value = 'result';
    alert('检测失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    if (unsubscribeProgress) {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }
  }
}

function onBack() {
  view.value = 'home';
  detectionResult.value = null;
  guideReport.value = null;
}

async function onEnterGuide() {
  if (detectionResult.value) {
    guideReport.value = detectionResult.value;
    view.value = 'guide';
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

async function onSettings() {
  if (typeof window.electronAPI?.getSettings !== 'function') {
    alert('设置功能不可用');
    return;
  }
  try {
    const s = await window.electronAPI.getSettings();
    settingsNodePath.value = s.nodePath ?? '';
    settingsNpmRegistry.value = s.npmRegistry ?? '';
    settingsNvmNodeMirror.value = s.nvmNodeMirror ?? '';
    settingsNvmDefaultVersion.value = s.nvmDefaultVersion ?? '';
    if (window.electronAPI.getNpmRegistryPresets) {
      npmRegistryPresets.value = await window.electronAPI.getNpmRegistryPresets();
    }
    if (window.electronAPI.getNvmNodeMirrorPresets) {
      nvmMirrorPresets.value = await window.electronAPI.getNvmNodeMirrorPresets();
    }
    if (window.electronAPI.nvmListInstalled) {
      nvmInstalledVersions.value = await window.electronAPI.nvmListInstalled();
    }
    settingsOpenclawVersion.value = s.openclawPackageVersion ?? 'latest';
    settingsWizardCompleted.value = s?.wizardCompleted ?? false;
    settingsChatBackend.value = s.chatBackend === 'ollama' ? 'ollama' : 'openclaw';
    const rawSec = (s as { gatewayChatTimeoutSec?: number }).gatewayChatTimeoutSec;
    settingsGatewayChatTimeoutSec.value = typeof rawSec === 'number' && Number.isFinite(rawSec)
      ? Math.min(300, Math.max(30, Math.round(rawSec)))
      : 90;
    await loadSettingsOllamaModels();
    await loadGuiAuditLogs();
    view.value = 'settings';
  } catch {
    view.value = 'settings';
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
    view.value = s?.wizardCompleted ? 'agent' : 'home';
  } catch (e) {
    alert('保存失败: ' + (e instanceof Error ? e.message : String(e)));
  }
}

async function onBackFromSettings() {
  const s = await window.electronAPI?.getSettings?.().catch(() => ({}));
  view.value = s?.wizardCompleted ? 'agent' : 'home';
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

async function doInstallDaemonInSettings() {
  if (!window.electronAPI?.installDaemon || installDaemonRunning.value) return;
  installDaemonRunning.value = true;
  try {
    const r = await window.electronAPI.installDaemon();
    if (r.stdout) alert('输出: ' + r.stdout.slice(0, 300) + (r.stdout.length > 300 ? '…' : ''));
    if (r.stderr) alert('stderr: ' + r.stderr.slice(0, 200));
    if (r.error) alert('错误: ' + r.error);
    if (r.success) alert('Daemon 安装/启动完成');
  } finally {
    installDaemonRunning.value = false;
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

async function doInstallDaemon() {
  if (!window.electronAPI?.installDaemon || installDaemonRunning.value) return;
  installDaemonRunning.value = true;
  try {
    const r = await window.electronAPI.installDaemon();
    if (r.stdout) alert('输出: ' + r.stdout.slice(0, 500) + (r.stdout.length > 500 ? '…' : ''));
    if (r.stderr) alert(' stderr: ' + r.stderr.slice(0, 300));
    if (r.error) alert('错误: ' + r.error);
    if (r.success) await refreshGuide();
  } finally {
    installDaemonRunning.value = false;
  }
}

/** 由本应用直接启动网关（不安装系统 Daemon，兼容性更好；关闭应用后网关会停止） */
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
  daemon: 'OpenClaw Daemon',
  config: '配置文件',
  ollama: 'Ollama（可选）',
};

const guideSteps: { key: string; getStep: (r: DetectionReport) => StepResult }[] = [
  { key: 'env', getStep: (r) => r.env },
  { key: 'node', getStep: (r) => r.node },
  { key: 'npm', getStep: (r) => r.npm },
  { key: 'openclaw', getStep: (r) => r.openclaw },
  { key: 'daemon', getStep: (r) => r.daemon },
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
    { k: 'daemon', s: r.daemon },
    { k: 'config', s: r.config },
    { k: 'ollama', s: r.ollama },
  ];
});

const guideAllPassed = computed(() => {
  if (!guideReport.value) return false;
  return guideSteps.every((s) => s.getStep(guideReport.value!).ok);
});

async function onEnterConfig(returnTo: 'guide' | 'agent' | 'settings' = 'guide') {
  configReturnTo.value = returnTo;
  view.value = 'config';
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
    view.value = 'agent';
  } finally {
    configSaveLoading.value = false;
  }
}

function onBackFromConfig() {
  if (configReturnTo.value === 'agent') {
    view.value = 'agent';
    loadAgentOllamaSettings();
  } else if (configReturnTo.value === 'settings') {
    view.value = 'settings';
  } else {
    view.value = 'guide';
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
          agentMessages.value[assistantIndex].content = c;
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
    } catch (e) {
      agentMessages.value[assistantIndex].content = (e as Error)?.message ?? '请求异常，请重试。';
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
        agentMessages.value[assistantIndex].content = r.content;
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
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      agentMessages.value[assistantIndex].content = msg.startsWith('请求超时')
        ? `${msg}。若在终端用 openclaw gateway --verbose 看到 "embedded run agent start" 且无报错，说明请求已到网关并已交模型侧，多半是首 token 较慢（如 system prompt 很大）；可改用「流式对话」或稍后再试。否则请检查：1) 网关已启动（设置 → 由本应用启动网关）；2) 鉴权 Token 正确。`
        : msg || '请求异常，请重试。';
    } finally {
      agentLoading.value = false;
    }
  }
}

function onOpenConfig(fromAgent = true) {
  onEnterConfig(fromAgent ? 'agent' : 'settings');
}
</script>

<template>
  <div class="app arco-theme-light">
    <header class="header">
      <a-typography-title :heading="5" class="header-title">OpenClaw 安装助手</a-typography-title>
      <a-typography-text type="secondary" class="subtitle">帮助你在本机快速安装与配置 OpenClaw</a-typography-text>
      <a-button
        v-if="view === 'home'"
        type="outline"
        size="small"
        class="btn-settings"
        @click="onSettings"
      >
        设置
      </a-button>
      <a-button
        v-else-if="view === 'result'"
        type="outline"
        size="small"
        class="btn-settings"
        @click="onBack"
      >
        返回
      </a-button>
      <a-button
        v-else-if="view === 'guide'"
        type="outline"
        size="small"
        class="btn-settings"
        @click="view = 'result'"
      >
        返回检测结果
      </a-button>
      <a-button
        v-else-if="view === 'settings'"
        type="outline"
        size="small"
        class="btn-settings"
        @click="onBackFromSettings"
      >
        {{ settingsWizardCompleted ? '返回主界面' : '返回' }}
      </a-button>
      <a-button
        v-else-if="view === 'config'"
        type="outline"
        size="small"
        class="btn-settings"
        @click="onBackFromConfig"
      >
        返回
      </a-button>
      <template v-else-if="view === 'agent'">
        <a-space class="header-actions">
          <a-button type="outline" size="small" @click="onOpenConfig(true)">OpenClaw 配置</a-button>
          <a-button type="outline" size="small" class="btn-settings" @click="onSettings">设置</a-button>
        </a-space>
      </template>
    </header>

    <main class="main">
      <!-- 首页 -->
      <template v-if="view === 'home'">
        <a-card class="hero-card" :bordered="false">
          <template #title>
            <a-typography-title :heading="6">开始安装</a-typography-title>
          </template>
          <a-typography-paragraph>首次使用？点击下方开始，将依次检测环境并引导你完成安装与配置。</a-typography-paragraph>
          <a-button type="primary" size="large" long @click="onStart">
            开始安装
          </a-button>
        </a-card>
        <a-card class="status-card" :bordered="false">
          <template #title>
            <a-typography-title :heading="6">环境概览</a-typography-title>
          </template>
          <a-typography-text>{{ platformInfo }}</a-typography-text>
        </a-card>
      </template>

      <!-- 检测中 -->
      <a-card v-else-if="view === 'detecting'" class="detecting-card" :bordered="false">
        <a-spin size="large" tip="正在检测运行环境…">
          <div class="detecting-content">
            <a-typography-paragraph>{{ detectionProgress }}</a-typography-paragraph>
          </div>
        </a-spin>
      </a-card>

      <!-- 检测结果 -->
      <template v-else-if="view === 'result' && detectionResult">
        <a-card class="result-card" title="检测结果" :bordered="false">
          <a-list :data="resultSteps" class="result-list">
            <template #item="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #avatar>
                    <a-tag :color="item.s.ok ? 'green' : 'red'" size="small">
                      {{ item.s.ok ? '通过' : '未过' }}
                    </a-tag>
                  </template>
                  <template #title>
                    {{ stepLabels[item.k] ?? item.k }}
                  </template>
                  <template #description>
                    {{ item.s.ok ? (item.s.version || item.s.message || '通过') : (item.s.error || item.s.message || '未通过') }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
          <a-alert
            v-if="!detectionResult.canEnterGuide"
            type="warning"
            title="当前系统或架构不在支持列表中，无法进入安装引导。请查看文档或更换环境。"
            class="result-alert"
          />
          <a-space class="result-actions" size="medium">
            <a-button v-if="detectionResult.canEnterGuide" type="primary" @click="onEnterGuide">
              进入安装引导
            </a-button>
            <a-button type="secondary" @click="onBack">返回首页</a-button>
          </a-space>
        </a-card>
      </template>

      <!-- 安装引导 -->
      <a-card v-else-if="view === 'guide' && guideReport" class="guide-card" title="安装引导" :bordered="false">
        <a-typography-paragraph type="secondary">按顺序完成以下步骤，完成一项后可点击「重新检测」更新状态。</a-typography-paragraph>
        <a-button type="secondary" size="small" class="guide-refresh" @click="refreshGuide">重新检测</a-button>
        <a-steps direction="vertical" :current="guideSteps.findIndex((s) => guideReport && !s.getStep(guideReport).ok)" class="guide-steps">
          <a-step
            v-for="(item, index) in guideSteps"
            :key="item.key"
            :title="stepLabels[item.key]"
            :status="guideReport && item.getStep(guideReport).ok ? 'finish' : 'process'"
          >
            <template #description>
              <a-typography-text :type="guideReport && item.getStep(guideReport).ok ? 'secondary' : undefined">
                {{ guideReport && item.getStep(guideReport).ok
                  ? (item.getStep(guideReport).version || item.getStep(guideReport).message || '通过')
                  : (guideReport && (item.getStep(guideReport).error || item.getStep(guideReport).message)) || '未通过' }}
              </a-typography-text>
              <div v-if="guideReport && !item.getStep(guideReport).ok" class="step-actions">
                <template v-if="item.key === 'env'">
                  <a href="https://docs.openclaw.ai/setup" target="_blank" rel="noopener">查看文档</a>
                </template>
                <template v-else-if="item.key === 'node'">
                  <template v-if="!nvmInstalled">
                    <a-space>
                      <a-button type="primary" size="small" :loading="nvmInstallRunning" @click="doInstallNvm">
                        {{ nvmInstallRunning ? '安装中…' : '安装 nvm' }}
                      </a-button>
                      <a-button size="small" @click="openNodeUrl">打开 Node 下载页</a-button>
                    </a-space>
                    <a-typography-text type="secondary" class="step-hint">安装 nvm 后可在下方选择 Node 版本并安装（仅 macOS/Linux）。Windows 请使用「打开 Node 下载页」。</a-typography-text>
                  </template>
                  <template v-else>
                    <a-space direction="vertical" fill size="small">
                      <a-select v-model="selectedNodeVersion" placeholder="Node 版本" style="width: 140px" size="small">
                        <a-option v-for="v in nvmSuggestedVersions" :key="v" :value="v">{{ v }} (LTS)</a-option>
                      </a-select>
                      <a-select v-model="settingsNvmNodeMirror" placeholder="下载镜像（可选）" style="width: 200px" size="small" allow-clear>
                        <a-option value="">默认</a-option>
                        <a-option v-for="p in nvmMirrorPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
                      </a-select>
                      <a-button type="primary" size="small" :loading="nvmInstallRunning" @click="doInstallNodeViaNvm">
                        {{ nvmInstallRunning ? nvmInstallProgress : '安装并设为默认' }}
                      </a-button>
                    </a-space>
                    <a-typography-text v-if="nvmInstallProgress" type="secondary" class="step-hint">{{ nvmInstallProgress }}</a-typography-text>
                  </template>
                </template>
                <template v-else-if="item.key === 'npm'">
                  <a-typography-text type="secondary">请先完成 Node.js 安装。</a-typography-text>
                </template>
                <template v-else-if="item.key === 'openclaw'">
                  <a-space direction="vertical" fill>
                    <a-button type="primary" size="small" :loading="installOpenClawRunning" @click="doInstallOpenClaw">
                      {{ installOpenClawRunning ? '安装中…' : '安装 OpenClaw' }}
                    </a-button>
                    <pre v-if="installOpenClawLog" class="install-log">{{ installOpenClawLog }}</pre>
                  </a-space>
                </template>
                <template v-else-if="item.key === 'daemon'">
                  <a-space direction="vertical" fill>
                    <a-typography-text type="secondary" class="form-hint">
                      若「安装并启动 Daemon」报错，可使用下方「由本应用启动网关」，兼容性更好（关闭应用后网关会停止）。
                    </a-typography-text>
                    <a-space>
                      <a-button type="primary" size="small" :loading="startGatewayInProcessRunning" @click="doStartGatewayInProcess">
                        {{ startGatewayInProcessRunning ? '启动中…' : '由本应用启动网关（推荐）' }}
                      </a-button>
                      <a-button size="small" :loading="installDaemonRunning" @click="doInstallDaemon">
                        {{ installDaemonRunning ? '执行中…' : '安装并启动 Daemon' }}
                      </a-button>
                    </a-space>
                  </a-space>
                </template>
                <template v-else-if="item.key === 'config'">
                  <a-space>
                    <a-button type="primary" size="small" @click="openConfigDir">打开配置目录</a-button>
                    <a-typography-text type="secondary">可在目录中创建或编辑 openclaw.json，或运行 openclaw configure。</a-typography-text>
                  </a-space>
                </template>
              </div>
            </template>
          </a-step>
        </a-steps>
        <div v-if="guideReport?.config?.ok && freeModelChoice === 'pending'" class="guide-phase2">
          <a-divider>免费本地模型（可选）</a-divider>
          <a-typography-paragraph type="secondary">使用 Ollama 本地模型可完全免费运行 OpenClaw。</a-typography-paragraph>
          <a-space>
            <a-button type="primary" size="small" @click="onFreeModelYes">是，启用</a-button>
            <a-button size="small" @click="onFreeModelNo">否，跳过</a-button>
          </a-space>
        </div>
        <div v-else-if="guideReport?.config?.ok && freeModelChoice === 'yes'" class="guide-phase2">
          <a-divider>免费本地模型（Ollama）</a-divider>
          <template v-if="ollamaModels.length === 0 && !ollamaServeRunning">
            <a-typography-paragraph type="secondary">若本机未运行 Ollama，可点击下方通过 electron-ollama 内嵌启动。</a-typography-paragraph>
            <a-button type="primary" size="small" :loading="ollamaServeRunning" @click="onOllamaServe">
              启动 Ollama
            </a-button>
          </template>
          <template v-else-if="ollamaServeRunning">
            <a-typography-text type="secondary">{{ ollamaServeProgress }}</a-typography-text>
          </template>
          <template v-else>
            <a-select v-model="selectedOllamaModel" placeholder="选择模型" style="width: 200px" size="small" allow-clear>
              <a-option v-for="m in ollamaModels" :key="m.name" :value="m.name">{{ m.name }}</a-option>
            </a-select>
            <a-button type="primary" size="small" :disabled="!selectedOllamaModel || ollamaProviderWritten" @click="onWriteOllamaProvider">
              {{ ollamaProviderWritten ? '已写入配置' : '写入 OpenClaw 配置' }}
            </a-button>
          </template>
        </div>
        <div v-if="guideAllPassed" class="guide-phase2">
          <a-divider>阶段二：OpenClaw 配置</a-divider>
          <a-typography-paragraph type="secondary">安装已就绪，请填写基础配置项后进入主界面。</a-typography-paragraph>
          <a-button type="primary" @click="onEnterConfig">进入 OpenClaw 配置</a-button>
        </div>
      </a-card>

      <!-- 阶段二：OpenClaw 配置（可从引导、主界面、设置进入） -->
      <a-card v-else-if="view === 'config'" class="config-card" title="OpenClaw 基础配置" :bordered="false">
        <a-alert
          type="info"
          title="配置将写入 ~/.openclaw/openclaw.json：板块一为默认模型与各云端 API Key（models.providers.*）及网关；板块二为聊天渠道 Token（channels.*）。保存后请按需重启网关。"
          class="config-alert"
        />
        <a-divider orientation="left">说明与排查</a-divider>
        <div class="config-help-section">
          <a-alert type="warning" class="config-alert" title="本地 Ollama 与网关主代理">
            <a-typography-paragraph>
              主代理会向 Ollama 使用 <strong>tools / function calling</strong>。请勿将默认模型设为 <code>llama3:latest</code>（常见报错：<code>does not support tools</code>）。请改用
              <code>llama3.2</code>、<code>llama3.1</code>、<code>qwen2.5:7b</code> 等，并保证上下文 ≥ 16000。可在「设置」中用「一键应用本地模型」写入 provider 与 contextWindow。
            </a-typography-paragraph>
          </a-alert>
          <a-alert type="normal" class="config-alert" title="消息渠道（Discord 等）">
            <a-typography-paragraph>
              若网关日志出现 <code>Unknown target "your_user_id"</code> 等报错，多为示例占位符或未配置渠道。可在下方「Discord / 消息」表单填写 Token 与用户 ID，或在配置目录手动编辑。
            </a-typography-paragraph>
            <a-button type="outline" size="small" class="config-help-btn" @click="openConfigDir">打开 ~/.openclaw 配置目录</a-button>
          </a-alert>
          <a-alert type="success" class="config-alert" title="生效方式">
            <a-typography-paragraph>
              修改 <code>openclaw.json</code> 或渠道相关文件后，请到「设置」中先「停止网关」再「由本应用启动网关」，或终端重启 <code>openclaw gateway</code>，否则可能仍加载旧配置。
            </a-typography-paragraph>
          </a-alert>
        </div>
        <a-divider orientation="left">一、大模型与 API</a-divider>
        <a-form layout="vertical" class="config-form config-form-wide">
          <a-form-item label="模型来源">
            <a-radio-group v-model="openclawForm.modelSource">
              <a-radio value="cloud">云端 API</a-radio>
              <a-radio value="local">本地 Ollama</a-radio>
            </a-radio-group>
          </a-form-item>
          <template v-if="openclawForm.modelSource === 'cloud'">
            <a-typography-text type="secondary" class="form-hint">已选择云端 API：请在下方填写主流模型提供方密钥。</a-typography-text>
            <a-collapse :default-active-key="['openai']" class="config-collapse">
              <a-collapse-item key="openai" header="OpenAI">
                <a-form-item label="OpenAI API Key">
                  <a-input-password v-model="openclawForm.openaiApiKey" placeholder="sk-…；留空并保存可清除已写入的 keys" allow-clear>
                    <template #suffix>
                      <a-tooltip :content="MODEL_TOOLTIP_OPENAI" position="left">
                        <span class="config-suffix-hint">说明</span>
                      </a-tooltip>
                    </template>
                  </a-input-password>
                </a-form-item>
              </a-collapse-item>
              <a-collapse-item key="anthropic" header="Anthropic / Claude">
                <a-form-item label="Anthropic API Key">
                  <a-input-password v-model="openclawForm.anthropicApiKey" placeholder="留空并保存可清除" allow-clear>
                    <template #suffix>
                      <a-tooltip :content="MODEL_TOOLTIP_ANTHROPIC" position="left">
                        <span class="config-suffix-hint">说明</span>
                      </a-tooltip>
                    </template>
                  </a-input-password>
                </a-form-item>
              </a-collapse-item>
              <a-collapse-item key="google" header="Google / Gemini">
                <a-form-item label="Google / Gemini API Key">
                  <a-input-password v-model="openclawForm.googleGeminiApiKey" placeholder="留空并保存可清除" allow-clear>
                    <template #suffix>
                      <a-tooltip :content="MODEL_TOOLTIP_GOOGLE" position="left">
                        <span class="config-suffix-hint">说明</span>
                      </a-tooltip>
                    </template>
                  </a-input-password>
                </a-form-item>
              </a-collapse-item>
            </a-collapse>
          </template>
          <template v-else>
            <a-form-item label="默认模型">
              <a-input
                v-model="openclawForm.defaultModel"
                placeholder="本地 Ollama 建议 ollama-local/llama3.2（勿用 llama3:latest）"
                allow-clear
              />
              <a-typography-text type="secondary" class="form-hint">与 <code>agents.defaults.model.primary</code> 对应；本地模型 id 常与 <code>ollama-local/模型名</code> 一致</a-typography-text>
            </a-form-item>
          </template>
          <a-form-item label="网关端口">
            <a-input-number v-model="openclawForm.gatewayPort" :min="1024" :max="65535" placeholder="18789" style="width: 120px" />
            <a-typography-text type="secondary" class="form-hint">OpenClaw Daemon 监听端口，默认 18789</a-typography-text>
          </a-form-item>
          <a-form-item label="网关鉴权 Token（可选）">
            <a-input-password v-model="openclawForm.gatewayToken" placeholder="与 openclaw.json 中 gateway.auth.token 一致；使用「由本应用启动网关」时会自动写入默认值，一般无需填写" allow-clear />
            <a-typography-text type="secondary" class="form-hint">若在浏览器打开 Control 控制页（http://127.0.0.1:端口），需在 Control 设置中粘贴与此处相同的 Token，否则会报 token_mismatch</a-typography-text>
          </a-form-item>

          <a-divider orientation="left">GUI 操作策略</a-divider>
          <a-form-item label="启用 GUI 操作路径">
            <a-switch v-model="openclawForm.guiEnabled" />
            <a-tooltip :content="GUI_TOOLTIP_ENABLED" position="left">
              <span class="config-suffix-hint config-suffix-hint--inline">?</span>
            </a-tooltip>
          </a-form-item>
          <a-form-item label="允许操作的应用（白名单，逗号分隔）">
            <a-input v-model="openclawForm.guiAllowApps" placeholder="如 Finder, WeChat, Chrome" allow-clear>
              <template #suffix>
                <a-tooltip :content="GUI_TOOLTIP_ALLOW_APPS" position="left">
                  <span class="config-suffix-hint">说明</span>
                </a-tooltip>
              </template>
            </a-input>
          </a-form-item>
          <a-form-item label="高风险动作执行前确认">
            <a-switch v-model="openclawForm.guiRequireConfirmForDangerous" />
            <a-tooltip :content="GUI_TOOLTIP_CONFIRM" position="left">
              <span class="config-suffix-hint config-suffix-hint--inline">?</span>
            </a-tooltip>
          </a-form-item>

          <a-divider orientation="left">二、聊天工具与 Token</a-divider>
          <a-collapse :default-active-key="['discord']" class="config-collapse">
            <a-collapse-item key="discord" header="Discord">
              <a-form-item label="启用 Discord">
                <a-switch v-model="openclawForm.discordEnabled" :disabled="!openclawForm.discordBotToken.trim()" />
                <a-tooltip :content="DISCORD_TOOLTIP_ENABLED">
                  <span class="config-suffix-hint config-suffix-hint--inline">?</span>
                </a-tooltip>
                <a-typography-text type="secondary" class="form-hint">需先填写 Bot Token 才能开启；仅写入 channels.discord.enabled</a-typography-text>
              </a-form-item>
              <a-form-item label="Discord Bot Token">
                <a-input-password v-model="openclawForm.discordBotToken" placeholder="留空并保存可清除已保存的 Token" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="DISCORD_TOOLTIP_TOKEN" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
              <a-form-item label="允许的 Discord 用户 ID（私信白名单）">
                <a-input v-model="openclawForm.discordAllowFromUserId" placeholder="17～22 位数字；留空并保存则移除 allowFrom" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="DISCORD_TOOLTIP_USER" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input>
              </a-form-item>
              <a-form-item label="Discord 服务器 ID（可选，公会白名单）">
                <a-input v-model="openclawForm.discordGuildId" placeholder="与上方用户 ID 同时填写时写入 guilds；单独留空不修改已有 guilds" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="DISCORD_TOOLTIP_GUILD" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input>
              </a-form-item>
            </a-collapse-item>
            <a-collapse-item key="telegram" header="Telegram">
              <a-form-item label="Telegram Bot Token">
                <a-input-password v-model="openclawForm.telegramBotToken" placeholder="留空并保存可清除" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="CHAT_TOOLTIP_TELEGRAM" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
            </a-collapse-item>
            <a-collapse-item key="slack" header="Slack">
              <a-form-item label="Slack Bot Token">
                <a-input-password v-model="openclawForm.slackBotToken" placeholder="留空并保存可清除" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="CHAT_TOOLTIP_SLACK_BOT" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
              <a-form-item label="Slack App Token（可选）">
                <a-input-password v-model="openclawForm.slackAppToken" placeholder="Socket Mode 等；不需要可留空" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="CHAT_TOOLTIP_SLACK_APP" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
            </a-collapse-item>
            <a-collapse-item key="feishu" header="飞书">
              <a-form-item label="飞书 App Secret">
                <a-input-password v-model="openclawForm.feishuAppSecret" placeholder="留空并保存可清除" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="CHAT_TOOLTIP_FEISHU" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
            </a-collapse-item>
            <a-collapse-item key="mattermost" header="Mattermost">
              <a-form-item label="Mattermost Bot Token">
                <a-input-password v-model="openclawForm.mattermostBotToken" placeholder="留空并保存可清除" allow-clear>
                  <template #suffix>
                    <a-tooltip :content="CHAT_TOOLTIP_MATTERMOST" position="left">
                      <span class="config-suffix-hint">说明</span>
                    </a-tooltip>
                  </template>
                </a-input-password>
              </a-form-item>
            </a-collapse-item>
          </a-collapse>

          <a-form-item>
            <a-space>
              <a-button type="primary" :loading="configSaveLoading" @click="onCompleteConfig">完成配置</a-button>
              <a-button @click="onBackFromConfig">
                {{ configReturnTo === 'agent' ? '返回主界面' : configReturnTo === 'settings' ? '返回设置' : '返回引导' }}
              </a-button>
            </a-space>
          </a-form-item>
        </a-form>
      </a-card>

      <!-- 阶段三：主界面（Agent 对话） -->
      <section v-else-if="view === 'agent'" class="agent-view">
        <div class="agent-messages">
          <template v-if="agentMessages.length === 0">
            <a-empty description="输入消息与 OpenClaw 对话（需已启动 Daemon）" class="agent-placeholder" />
          </template>
          <div v-else class="agent-message-list">
            <div
              v-for="(msg, i) in agentMessages"
              :key="i"
              :class="['agent-msg', msg.role === 'user' ? 'agent-msg-user' : 'agent-msg-assistant']"
            >
              <span class="agent-msg-role">{{ msg.role === 'user' ? '你' : 'OpenClaw' }}</span>
              <div
                class="agent-msg-content markdown-body"
                v-html="(msg.content && msg.content.trim()) ? renderMarkdown(msg.content) : (agentStreaming && i === agentMessages.length - 1 ? STREAMING_PLACEHOLDER : MARKDOWN_PLACEHOLDER)"
              />
            </div>
          </div>
        </div>
        <div class="agent-input-row">
          <a-input
            v-model="agentInput"
            placeholder="输入消息…"
            allow-clear
            class="agent-input"
            :disabled="agentLoading || agentStreaming"
            @press-enter="onAgentSend"
          />
          <a-button type="primary" class="agent-send" :loading="agentLoading || agentStreaming" @click="onAgentSend">
            发送
          </a-button>
          <a-button type="outline" class="agent-settings-btn" @click="onSettings">设置</a-button>
        </div>
      </section>

      <!-- 设置 -->
      <a-card v-else-if="view === 'settings'" class="settings-card" title="设置" :bordered="false">
        <a-alert
          v-if="settingsWizardCompleted"
          type="normal"
          title="安装向导仅在首次使用时展示；之后可在此管理全部安装与配置项。"
          class="settings-hint"
        />
        <a-form layout="vertical" class="settings-form">
          <a-divider orientation="left">OpenClaw</a-divider>
          <a-form-item label="Ollama 状态（每 8 秒刷新）">
            <a-typography-text v-if="ollamaStatus.running" type="success">
              {{ ollamaStatus.loadedModels.length ? `运行中，已加载: ${ollamaStatus.loadedModels.join(', ')}` : '运行中，无已加载模型' }}
            </a-typography-text>
            <a-typography-text v-else type="secondary">未运行</a-typography-text>
            <a-button size="small" type="text" @click="fetchOllamaStatus">刷新</a-button>
            <a-typography-text type="secondary" class="form-hint">经网关发请求时若此处一直无「已加载」，可能请求未到达 Ollama；直连快而网关慢时可对比此状态</a-typography-text>
          </a-form-item>
          <a-form-item label="OpenClaw 基础配置">
            <a-button type="outline" @click="onEnterConfig('settings')">打开 OpenClaw 配置页</a-button>
            <a-typography-text type="secondary" class="form-hint">配置模型来源、API Key、网关端口等</a-typography-text>
          </a-form-item>
          <a-form-item label="对话后端">
            <a-radio-group v-model="settingsChatBackend">
              <a-radio value="openclaw">OpenClaw 网关（可操作系统、执行任务）</a-radio>
              <a-radio value="ollama">Ollama 直连（仅纯对话，无法操作电脑）</a-radio>
            </a-radio-group>
            <a-typography-text type="secondary" class="form-hint">「OpenClaw 网关」才能帮用户操作电脑、完成任务，但要求模型上下文 ≥16k（如 llama3.2、qwen2.5:7b）。「Ollama 直连」无 16k 限制、小模型可用，但仅对话、不能操作系统。</a-typography-text>
          </a-form-item>
          <a-form-item label="网关对话超时（秒）">
            <a-input-number
              v-model="settingsGatewayChatTimeoutSec"
              :min="30"
              :max="300"
              placeholder="90"
              style="width: 120px"
            />
            <a-typography-text type="secondary" class="form-hint">经 OpenClaw 网关对话时，若在此时间内未收到首条回复则报超时；仅对「对话后端」为网关时生效。30～300 秒，默认 90。首 token 较慢时可适当调大。</a-typography-text>
          </a-form-item>
          <a-form-item label="一键应用本地模型">
            <a-space wrap>
              <a-select
                v-model="settingsSelectedOllamaForApply"
                placeholder="选择 Ollama 模型"
                allow-search
                style="width: 200px"
                :loading="settingsApplyLocalModelLoading"
              >
                <a-option v-for="m in settingsOllamaModelsForApply" :key="m.name" :value="m.name">{{ m.name }}</a-option>
              </a-select>
              <a-button size="small" @click="loadSettingsOllamaModels">刷新模型列表</a-button>
              <a-button type="primary" :loading="settingsApplyLocalModelLoading" @click="onApplyLocalModel">
                一键应用本地模型
              </a-button>
            </a-space>
            <a-typography-text type="secondary" class="form-hint">将所选 Ollama 模型写入配置并设为 OpenClaw 默认模型，可避免对话 404；需先启动 Ollama 并拉取模型</a-typography-text>
          </a-form-item>
          <a-form-item label="诊断网关/模型状态">
            <a-space wrap>
              <a-button type="outline" :loading="gatewayDiagnosticLoading" @click="onGatewayDiagnostic">
                诊断当前环节（500 时自动显示）
              </a-button>
              <a-button type="outline" :loading="testV1ModelsLoading" @click="onTestGatewayV1Models">
                手动测试 /v1/models
              </a-button>
              <a-button type="outline" :loading="verifyRequestChainLoading" @click="onVerifyRequestChain">
                验证请求链
              </a-button>
            </a-space>
            <a-typography-text type="secondary" class="form-hint">检查默认模型、Ollama、网关；「验证请求链」先直连 Ollama 再请求网关，可判断请求是否到达 Ollama（各约 15s/25s 超时）。若对话超时：在终端运行 openclaw gateway --verbose 后重试，日志出现 "embedded run agent start" 且无报错即表示请求已到网关并已交模型侧，多半是首 token 较慢，可改用流式对话或等待约 90 秒。</a-typography-text>
          </a-form-item>
          <a-form-item label="GUI 审计日志（最近 60 条）">
            <a-space wrap>
              <a-button size="small" type="outline" :loading="settingsGuiAuditLoading" @click="loadGuiAuditLogs">刷新</a-button>
              <a-select v-model="settingsGuiAuditStatusFilter" size="small" style="width: 140px">
                <a-option value="all">状态：全部</a-option>
                <a-option value="blocked">状态：仅阻断</a-option>
                <a-option value="executing">状态：仅执行中</a-option>
              </a-select>
              <a-select v-model="settingsGuiAuditRiskFilter" size="small" style="width: 140px">
                <a-option value="all">风险：全部</a-option>
                <a-option value="high">风险：高</a-option>
                <a-option value="medium">风险：中</a-option>
                <a-option value="low">风险：低</a-option>
              </a-select>
              <a-button size="small" type="primary" @click="exportGuiAuditLogs">导出当前筛选</a-button>
              <a-typography-text type="secondary">来源：~/.openclaw/logs/gui-actions.jsonl</a-typography-text>
            </a-space>
            <div class="gui-audit-table-wrap" v-if="settingsGuiAuditFiltered.length">
              <table class="gui-audit-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>状态</th>
                    <th>风险</th>
                    <th>原因</th>
                    <th>目标应用</th>
                    <th>消息摘要</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in settingsGuiAuditFiltered" :key="`${row.ts}-${idx}`">
                    <td>{{ row.ts }}</td>
                    <td>{{ row.status }}</td>
                    <td>{{ row.risk }}</td>
                    <td>{{ row.reason }}</td>
                    <td>{{ row.requestedApp || '-' }}</td>
                    <td>{{ row.message }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <a-typography-text v-else type="secondary" class="form-hint">暂无 GUI 审计记录。</a-typography-text>
          </a-form-item>
          <a-divider orientation="left">环境</a-divider>
          <a-form-item label="Node 环境地址">
            <a-input
              v-model="settingsNodePath"
              placeholder="留空则使用 nvm 默认或系统 PATH；可填 Node 可执行文件路径或所在目录"
              allow-clear
            />
          </a-form-item>
          <a-form-item v-if="nvmInstalledVersions.length" label="Node 版本（nvm 默认）">
            <a-select
              v-model="settingsNvmDefaultVersion"
              placeholder="选择默认版本"
              allow-clear
              @change="(v: string) => v && setNvmDefaultVersion(v)"
            >
              <a-option v-for="ver in nvmInstalledVersions" :key="ver" :value="ver">{{ ver }}</a-option>
            </a-select>
            <a-typography-text type="secondary" class="form-hint">切换后立即设为 nvm 默认版本</a-typography-text>
          </a-form-item>
          <a-form-item label="npm 源地址">
            <a-select
              v-model="settingsNpmRegistry"
              placeholder="使用系统当前"
              allow-clear
              style="width: 100%"
            >
              <a-option v-for="p in npmRegistryPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
            </a-select>
            <a-input
              v-model="settingsNpmRegistry"
              placeholder="或输入自定义 registry URL"
              allow-clear
              class="settings-custom-input"
            />
          </a-form-item>
          <a-form-item label="nvm Node 下载镜像">
            <a-select
              v-model="settingsNvmNodeMirror"
              placeholder="默认（官方）"
              allow-clear
              style="width: 100%"
            >
              <a-option v-for="p in nvmMirrorPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
            </a-select>
            <a-typography-text type="secondary" class="form-hint">安装 Node 时使用，国内建议选 npmmirror</a-typography-text>
          </a-form-item>
          <a-divider orientation="left">OpenClaw 包</a-divider>
          <a-form-item label="OpenClaw 包版本">
            <a-input
              v-model="settingsOpenclawVersion"
              placeholder="latest 或具体版本号如 1.2.3"
              allow-clear
            />
            <a-typography-text type="secondary" class="form-hint">重新安装时将使用 openclaw@此版本</a-typography-text>
          </a-form-item>
          <a-form-item label="操作">
            <a-space wrap>
              <a-button
                type="primary"
                :loading="settingsReinstallOpenClawRunning"
                @click="doReinstallOpenClawInSettings"
              >
                重新安装全局包
              </a-button>
              <a-button @click="openConfigDir">打开配置目录</a-button>
              <a-button type="primary" :loading="startGatewayInProcessRunning" @click="doStartGatewayInProcess">
                {{ startGatewayInProcessRunning ? '启动中…' : '由本应用启动网关（推荐）' }}
              </a-button>
              <a-button @click="doStopGatewayInProcess">停止网关</a-button>
              <a-button :loading="installDaemonRunning" @click="doInstallDaemonInSettings">
                安装并启动 Daemon
              </a-button>
            </a-space>
            <a-typography-text type="secondary" class="form-hint" style="display:block;margin-top:8px">
              若「安装并启动 Daemon」报错，请使用「由本应用启动网关」，兼容性更好；关闭应用后由本应用启动的网关会停止。
            </a-typography-text>
          </a-form-item>
          <a-form-item v-if="settingsReinstallOpenClawLog" label="安装日志">
            <pre class="install-log">{{ settingsReinstallOpenClawLog }}</pre>
          </a-form-item>
          <a-form-item>
            <a-space>
              <a-button type="primary" @click="saveSettings">保存</a-button>
              <a-button @click="onBackFromSettings">{{ settingsWizardCompleted ? '返回主界面' : '取消' }}</a-button>
            </a-space>
          </a-form-item>
        </a-form>
      </a-card>
    </main>

    <footer class="footer">
      <a href="https://docs.openclaw.ai/setup" target="_blank" rel="noopener noreferrer" class="footer-link">打开 OpenClaw 文档</a>
    </footer>
  </div>
</template>

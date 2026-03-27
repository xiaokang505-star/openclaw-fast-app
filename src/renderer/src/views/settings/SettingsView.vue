<script setup lang="ts">
import { useApplicationStore } from '@/stores/application';
const s = useApplicationStore();
</script>
<template>
      <div class="settings-shell">
        <aside class="settings-nav" aria-label="设置分类">
          <div
            v-for="nav in s.settingsNavItems"
            :key="nav.key"
            class="settings-nav-item"
            :class="{ 'settings-nav-item--active': s.settingsCategory === nav.key }"
            role="button"
            tabindex="0"
            @click="s.onSettingsCategorySelect(nav.key)"
            @keydown.enter.prevent="s.onSettingsCategorySelect(nav.key)"
          >
            {{ nav.label }}
          </div>
        </aside>
        <div class="settings-main">
          <div class="settings-panel-scroll">
            <div v-show="s.settingsCategory === 'overview'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">概览</a-typography-title>
              <a-alert
                v-if="s.settingsWizardCompleted"
                type="normal"
                title="安装向导仅在首次使用时展示；之后可在此管理全部安装与配置项。"
                class="settings-hint"
              />
              <a-typography-paragraph type="secondary">
                从左侧选择分类。对话、网关诊断、OpenClaw 配置与本机环境已分栏整理。
              </a-typography-paragraph>
              <a-form layout="vertical" class="settings-form settings-form--panel">
                <a-form-item label="Ollama 状态（每 8 秒刷新）">
                  <a-typography-text v-if="s.ollamaStatus.running" type="success">
                    {{ s.ollamaStatus.loadedModels.length ? `运行中，已加载: ${s.ollamaStatus.loadedModels.join(', ')}` : '运行中，无已加载模型' }}
                  </a-typography-text>
                  <a-typography-text v-else type="secondary">未运行</a-typography-text>
                  <a-button size="small" type="text" @click="s.fetchOllamaStatus">刷新</a-button>
                  <a-typography-text type="secondary" class="form-hint">经网关发请求时若此处一直无「已加载」，可能请求未到达 Ollama。</a-typography-text>
                </a-form-item>
              </a-form>
            </div>

            <div v-show="s.settingsCategory === 'environment'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">环境与安装</a-typography-title>
              <a-form layout="vertical" class="settings-form settings-form--panel">
                <a-form-item label="Node 环境地址">
                  <a-input
                    v-model="s.settingsNodePath"
                    placeholder="留空则使用 nvm 默认或系统 PATH；可填 Node 可执行文件路径或所在目录"
                    allow-clear
                  />
                </a-form-item>
                <a-form-item v-if="s.nvmInstalledVersions.length" label="Node 版本（nvm 默认）">
                  <a-select
                    v-model="s.settingsNvmDefaultVersion"
                    placeholder="选择默认版本"
                    allow-clear
                    @change="(v: string) => v && s.setNvmDefaultVersion(v)"
                  >
                    <a-option v-for="ver in s.nvmInstalledVersions" :key="ver" :value="ver">{{ ver }}</a-option>
                  </a-select>
                  <a-typography-text type="secondary" class="form-hint">切换后立即设为 nvm 默认版本</a-typography-text>
                </a-form-item>
                <a-form-item label="npm 源地址">
                  <a-select
                    v-model="s.settingsNpmRegistry"
                    placeholder="使用系统当前"
                    allow-clear
                    style="width: 100%"
                  >
                    <a-option v-for="p in s.npmRegistryPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
                  </a-select>
                  <a-input
                    v-model="s.settingsNpmRegistry"
                    placeholder="或输入自定义 registry URL"
                    allow-clear
                    class="settings-custom-input"
                  />
                </a-form-item>
                <a-form-item label="nvm Node 下载镜像">
                  <a-select
                    v-model="s.settingsNvmNodeMirror"
                    placeholder="默认（官方）"
                    allow-clear
                    style="width: 100%"
                  >
                    <a-option v-for="p in s.nvmMirrorPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
                  </a-select>
                  <a-typography-text type="secondary" class="form-hint">安装 Node 时使用，国内建议选 npmmirror</a-typography-text>
                </a-form-item>
                <a-divider orientation="left">OpenClaw 包与网关</a-divider>
                <a-form-item label="OpenClaw 包版本">
                  <a-input
                    v-model="s.settingsOpenclawVersion"
                    placeholder="latest 或具体版本号如 1.2.3"
                    allow-clear
                  />
                  <a-typography-text type="secondary" class="form-hint">重新安装时将使用 openclaw@此版本</a-typography-text>
                </a-form-item>
                <a-form-item label="操作">
                  <a-space wrap>
                    <a-button
                      type="primary"
                      :loading="s.settingsReinstallOpenClawRunning"
                      @click="s.doReinstallOpenClawInSettings"
                    >
                      重新安装全局包
                    </a-button>
                    <a-button @click="s.openConfigDir">打开配置目录</a-button>
                    <a-button type="primary" :loading="s.startGatewayInProcessRunning" @click="s.doStartGatewayInProcess">
                      {{ s.startGatewayInProcessRunning ? '启动中…' : '由本应用启动网关（推荐）' }}
                    </a-button>
                    <a-button @click="s.doStopGatewayInProcess">停止网关</a-button>
                  </a-space>
                  <a-typography-text type="secondary" class="form-hint" style="display:block;margin-top:8px">
                    关闭应用后，由本应用启动的网关进程会停止；若需长期常驻，请在终端自行运行 openclaw gateway。
                  </a-typography-text>
                </a-form-item>
                <a-form-item v-if="s.settingsReinstallOpenClawLog" label="安装日志">
                  <pre class="install-log">{{ s.settingsReinstallOpenClawLog }}</pre>
                </a-form-item>
                <a-form-item>
                  <a-button type="primary" @click="s.saveSettings">保存本页设置</a-button>
                </a-form-item>
              </a-form>
            </div>

            <div v-show="s.settingsCategory === 'chat'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">对话与网关</a-typography-title>
              <a-form layout="vertical" class="settings-form settings-form--panel">
                <a-form-item label="对话后端">
                  <a-radio-group v-model="s.settingsChatBackend">
                    <a-radio value="openclaw">OpenClaw 网关（可操作系统、执行任务）</a-radio>
                    <a-radio value="ollama">Ollama 直连（仅纯对话，无法操作电脑）</a-radio>
                  </a-radio-group>
                  <a-typography-text type="secondary" class="form-hint">「OpenClaw 网关」才能帮用户操作电脑、完成任务，但要求模型上下文 ≥16k（如 llama3.2、qwen2.5:7b）。「Ollama 直连」无 16k 限制、小模型可用，但仅对话、不能操作系统。</a-typography-text>
                </a-form-item>
                <a-form-item label="网关对话超时（秒）">
                  <a-input-number
                    v-model="s.settingsGatewayChatTimeoutSec"
                    :min="30"
                    :max="300"
                    placeholder="90"
                    style="width: 120px"
                  />
                  <a-typography-text type="secondary" class="form-hint">经 OpenClaw 网关对话时，若在此时间内未收到首条回复则报超时；仅对「对话后端」为网关时生效。30～300 秒，默认 90。</a-typography-text>
                </a-form-item>
                <a-form-item label="一键应用本地模型">
                  <a-space wrap>
                    <a-select
                      v-model="s.settingsSelectedOllamaForApply"
                      placeholder="选择 Ollama 模型"
                      allow-search
                      style="width: 200px"
                      :loading="s.settingsApplyLocalModelLoading"
                    >
                      <a-option v-for="m in s.settingsOllamaModelsForApply" :key="m.name" :value="m.name">{{ m.name }}</a-option>
                    </a-select>
                    <a-button size="small" @click="s.loadSettingsOllamaModels">刷新模型列表</a-button>
                    <a-button type="primary" :loading="s.settingsApplyLocalModelLoading" @click="s.onApplyLocalModel">
                      一键应用本地模型
                    </a-button>
                  </a-space>
                  <a-typography-text type="secondary" class="form-hint">将所选 Ollama 模型写入配置并设为 OpenClaw 默认模型；需先启动 Ollama 并拉取模型</a-typography-text>
                </a-form-item>
                <a-form-item label="诊断网关/模型状态">
                  <a-space wrap>
                    <a-button type="outline" :loading="s.gatewayDiagnosticLoading" @click="s.onGatewayDiagnostic">
                      诊断当前环节（500 时自动显示）
                    </a-button>
                    <a-button type="outline" :loading="s.testV1ModelsLoading" @click="s.onTestGatewayV1Models">
                      手动测试 /v1/models
                    </a-button>
                    <a-button type="outline" :loading="s.verifyRequestChainLoading" @click="s.onVerifyRequestChain">
                      验证请求链
                    </a-button>
                  </a-space>
                  <a-typography-text type="secondary" class="form-hint">「验证请求链」先直连 Ollama 再请求网关，可判断请求是否到达 Ollama。</a-typography-text>
                </a-form-item>
                <a-form-item>
                  <a-button type="primary" @click="s.saveSettings">保存本页设置</a-button>
                </a-form-item>
              </a-form>
            </div>

            <div v-show="s.settingsCategory === 'distributed-compute'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">分布式算力</a-typography-title>
              <a-alert
                type="normal"
                title="llv-ollama 调度层：把请求分发到多个 Ollama 实例（多端口/多机）。"
                class="settings-hint"
              />
              <a-form layout="vertical" class="settings-form settings-form--panel">
                <a-form-item label="启用调度层">
                  <a-switch v-model="s.llvEnabled" />
                  <a-typography-text type="secondary" class="form-hint">启用后，建议将 OpenClaw provider 的 baseUrl 指向 llv 监听地址。</a-typography-text>
                </a-form-item>
                <a-form-item label="监听地址">
                  <a-space wrap>
                    <a-input v-model="s.llvListenHost" placeholder="127.0.0.1" style="width: 200px" />
                    <a-input-number v-model="s.llvListenPort" :min="1024" :max="65535" placeholder="11435" style="width: 140px" />
                  </a-space>
                </a-form-item>
                <a-form-item label="调度策略">
                  <a-space wrap>
                    <a-select v-model="s.llvStrategy" style="width: 220px">
                      <a-option value="least_inflight">least_inflight（推荐）</a-option>
                      <a-option value="round_robin">round_robin</a-option>
                      <a-option value="weighted">weighted</a-option>
                    </a-select>
                    <a-checkbox v-model="s.llvStickyByModel">同模型尽量粘性路由</a-checkbox>
                    <a-checkbox v-model="s.llvAggregateModels">聚合 /v1/models</a-checkbox>
                  </a-space>
                </a-form-item>
                <a-form-item label="健康检查">
                  <a-space wrap>
                    <a-input-number v-model="s.llvHealthIntervalSec" :min="5" :max="120" placeholder="15" style="width: 140px" />
                    <a-input-number v-model="s.llvHealthTimeoutMs" :min="500" :max="10000" placeholder="3000" style="width: 160px" />
                    <a-input-number v-model="s.llvHealthFailThreshold" :min="1" :max="10" placeholder="3" style="width: 160px" />
                  </a-space>
                  <a-typography-text type="secondary" class="form-hint">依次为：探测间隔(秒) / 超时(ms) / 失败阈值。</a-typography-text>
                </a-form-item>
                <a-divider orientation="left">下游节点</a-divider>
                <a-form-item>
                  <a-space wrap>
                    <a-button type="outline" @click="s.addLlvTarget">新增节点</a-button>
                    <a-button type="outline" :loading="s.llvConfigLoading" @click="s.loadLlvOllamaConfig">刷新配置</a-button>
                  </a-space>
                </a-form-item>
                <a-form-item label="进程与集成">
                  <a-space wrap>
                    <a-button type="primary" :loading="s.llvProcessLoading" @click="s.startLlvOllamaProcess">启动 llv-ollama</a-button>
                    <a-button :loading="s.llvProcessLoading" @click="s.stopLlvOllamaProcess">停止 llv-ollama</a-button>
                    <a-button type="outline" @click="s.refreshLlvProcessStatus">刷新进程状态</a-button>
                    <a-button type="outline" @click="s.applyLlvProviderToOpenClaw">一键写回 OpenClaw provider</a-button>
                  </a-space>
                  <a-typography-text type="secondary" class="form-hint">
                    状态：{{ s.llvProcessStatus.running ? `运行中（pid ${s.llvProcessStatus.pid || '-'})` : '未运行' }}
                    <template v-if="s.llvProcessStatus.lastError">；最近错误：{{ s.llvProcessStatus.lastError }}</template>
                  </a-typography-text>
                </a-form-item>
                <div v-for="(t, i) in s.llvTargets" :key="`${t.id}-${i}`" class="settings-subcard">
                  <a-space wrap style="width:100%">
                    <a-input v-model="t.id" placeholder="节点 ID" style="width: 140px" />
                    <a-input v-model="t.baseUrl" placeholder="http://127.0.0.1:11434" style="width: 280px" />
                    <a-input-number v-model="t.weight" :min="1" :max="100" placeholder="权重" style="width: 110px" />
                    <a-switch v-model="t.enabled" />
                    <a-input-password v-model="t.apiKey" placeholder="可选 API Key" allow-clear style="width: 180px" />
                    <a-button size="small" :loading="s.llvProbeLoading" @click="s.probeLlvTarget(i)">探测</a-button>
                    <a-button size="small" status="danger" @click="s.removeLlvTarget(i)">删除</a-button>
                  </a-space>
                </div>
                <a-form-item v-if="s.llvProbeResult" label="最近探测结果">
                  <a-typography-text type="secondary">{{ s.llvProbeResult }}</a-typography-text>
                </a-form-item>
                <a-form-item>
                  <a-button type="primary" :loading="s.llvConfigSaving" @click="s.saveLlvOllamaConfig">
                    保存分布式算力配置
                  </a-button>
                </a-form-item>
              </a-form>
            </div>

            <div v-show="s.settingsCategory === 'openclaw'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">OpenClaw 与渠道</a-typography-title>
              <a-alert
                type="info"
                title="配置将写入 ~/.openclaw/openclaw.json：模型与 API Key（models.providers.*）、网关；以及聊天渠道 Token（channels.*）。保存后请按需重启网关。"
                class="config-alert"
              />
              <a-divider orientation="left">说明与排查</a-divider>
              <div class="config-help-section">
                <a-alert type="warning" class="config-alert" title="本地 Ollama 与网关主代理">
                  <a-typography-paragraph>
                    主代理会向 Ollama 使用 <strong>tools / function calling</strong>。请勿将默认模型设为 <code>llama3:latest</code>（常见报错：<code>does not support tools</code>）。请改用
                    <code>llama3.2</code>、<code>llama3.1</code>、<code>qwen2.5:7b</code> 等，并保证上下文 ≥ 16000。可在「对话与网关」中用「一键应用本地模型」写入 provider 与 contextWindow。
                  </a-typography-paragraph>
                </a-alert>
                <a-alert type="normal" class="config-alert" title="消息渠道（Discord 等）">
                  <a-typography-paragraph>
                    若网关日志出现 <code>Unknown target "your_user_id"</code> 等报错，多为示例占位符或未配置渠道。可在下方表单填写 Token 与用户 ID，或在配置目录手动编辑。
                  </a-typography-paragraph>
                  <a-button type="outline" size="small" class="config-help-btn" @click="s.openConfigDir">打开 ~/.openclaw 配置目录</a-button>
                </a-alert>
                <a-alert type="success" class="config-alert" title="生效方式">
                  <a-typography-paragraph>
                    修改 <code>openclaw.json</code> 或渠道相关文件后，请先到「环境与安装」中「停止网关」再「由本应用启动网关」，或终端重启 <code>openclaw gateway</code>。
                  </a-typography-paragraph>
                </a-alert>
              </div>
              <a-divider orientation="left">一、大模型与 API</a-divider>
              <a-form layout="vertical" class="config-form config-form-wide settings-form--panel">
                <a-form-item label="模型来源">
                  <a-radio-group v-model="s.openclawForm.modelSource">
                    <a-radio value="cloud">云端 API</a-radio>
                    <a-radio value="local">本地 Ollama</a-radio>
                  </a-radio-group>
                </a-form-item>
                <template v-if="s.openclawForm.modelSource === 'cloud'">
                  <a-typography-text type="secondary" class="form-hint">已选择云端 API：请在下方填写主流模型提供方密钥。</a-typography-text>
                  <a-collapse :default-active-key="['openai']" class="config-collapse">
                    <a-collapse-item key="openai" header="OpenAI">
                      <a-form-item label="OpenAI API Key">
                        <a-input-password v-model="s.openclawForm.openaiApiKey" placeholder="sk-…；留空并保存可清除已写入的 keys" allow-clear>
                          <template #suffix>
                            <a-tooltip :content="s.MODEL_TOOLTIP_OPENAI" position="left">
                              <span class="config-suffix-hint">说明</span>
                            </a-tooltip>
                          </template>
                        </a-input-password>
                      </a-form-item>
                    </a-collapse-item>
                    <a-collapse-item key="anthropic" header="Anthropic / Claude">
                      <a-form-item label="Anthropic API Key">
                        <a-input-password v-model="s.openclawForm.anthropicApiKey" placeholder="留空并保存可清除" allow-clear>
                          <template #suffix>
                            <a-tooltip :content="s.MODEL_TOOLTIP_ANTHROPIC" position="left">
                              <span class="config-suffix-hint">说明</span>
                            </a-tooltip>
                          </template>
                        </a-input-password>
                      </a-form-item>
                    </a-collapse-item>
                    <a-collapse-item key="google" header="Google / Gemini">
                      <a-form-item label="Google / Gemini API Key">
                        <a-input-password v-model="s.openclawForm.googleGeminiApiKey" placeholder="留空并保存可清除" allow-clear>
                          <template #suffix>
                            <a-tooltip :content="s.MODEL_TOOLTIP_GOOGLE" position="left">
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
                      v-model="s.openclawForm.defaultModel"
                      placeholder="本地 Ollama 建议 ollama-local/llama3.2（勿用 llama3:latest）"
                      allow-clear
                    />
                    <a-typography-text type="secondary" class="form-hint">与 <code>agents.defaults.model.primary</code> 对应；本地模型 id 常与 <code>ollama-local/模型名</code> 一致</a-typography-text>
                  </a-form-item>
                </template>
                <a-form-item label="网关端口">
                  <a-input-number v-model="s.openclawForm.gatewayPort" :min="1024" :max="65535" placeholder="18789" style="width: 120px" />
                  <a-typography-text type="secondary" class="form-hint">OpenClaw 网关监听端口，默认 18789</a-typography-text>
                </a-form-item>
                <a-form-item label="网关鉴权 Token（可选）">
                  <a-input-password v-model="s.openclawForm.gatewayToken" placeholder="与 openclaw.json 中 gateway.auth.token 一致；使用「由本应用启动网关」时会自动写入默认值，一般无需填写" allow-clear />
                  <a-typography-text type="secondary" class="form-hint">若在浏览器打开 Control 控制页，需在 Control 设置中粘贴与此处相同的 Token</a-typography-text>
                </a-form-item>

                <a-divider orientation="left">二、聊天工具与 Token</a-divider>
                <a-collapse :default-active-key="['discord']" class="config-collapse">
                  <a-collapse-item key="discord" header="Discord">
                    <a-form-item label="启用 Discord">
                      <a-switch v-model="s.openclawForm.discordEnabled" :disabled="!s.openclawForm.discordBotToken.trim()" />
                      <a-tooltip :content="s.DISCORD_TOOLTIP_ENABLED">
                        <span class="config-suffix-hint config-suffix-hint--inline">?</span>
                      </a-tooltip>
                      <a-typography-text type="secondary" class="form-hint">需先填写 Bot Token 才能开启</a-typography-text>
                    </a-form-item>
                    <a-form-item label="Discord Bot Token">
                      <a-input-password v-model="s.openclawForm.discordBotToken" placeholder="留空并保存可清除已保存的 Token" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.DISCORD_TOOLTIP_TOKEN" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                    <a-form-item label="允许的 Discord 用户 ID（私信白名单）">
                      <a-input v-model="s.openclawForm.discordAllowFromUserId" placeholder="17～22 位数字；留空并保存则移除 allowFrom" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.DISCORD_TOOLTIP_USER" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input>
                    </a-form-item>
                    <a-form-item label="Discord 服务器 ID（可选，公会白名单）">
                      <a-input v-model="s.openclawForm.discordGuildId" placeholder="与上方用户 ID 同时填写时写入 guilds；单独留空不修改已有 guilds" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.DISCORD_TOOLTIP_GUILD" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input>
                    </a-form-item>
                  </a-collapse-item>
                  <a-collapse-item key="telegram" header="Telegram">
                    <a-form-item label="Telegram Bot Token">
                      <a-input-password v-model="s.openclawForm.telegramBotToken" placeholder="留空并保存可清除" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.CHAT_TOOLTIP_TELEGRAM" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                  </a-collapse-item>
                  <a-collapse-item key="slack" header="Slack">
                    <a-form-item label="Slack Bot Token">
                      <a-input-password v-model="s.openclawForm.slackBotToken" placeholder="留空并保存可清除" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.CHAT_TOOLTIP_SLACK_BOT" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                    <a-form-item label="Slack App Token（可选）">
                      <a-input-password v-model="s.openclawForm.slackAppToken" placeholder="Socket Mode 等；不需要可留空" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.CHAT_TOOLTIP_SLACK_APP" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                  </a-collapse-item>
                  <a-collapse-item key="feishu" header="飞书">
                    <a-form-item label="飞书 App Secret">
                      <a-input-password v-model="s.openclawForm.feishuAppSecret" placeholder="留空并保存可清除" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.CHAT_TOOLTIP_FEISHU" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                  </a-collapse-item>
                  <a-collapse-item key="mattermost" header="Mattermost">
                    <a-form-item label="Mattermost Bot Token">
                      <a-input-password v-model="s.openclawForm.mattermostBotToken" placeholder="留空并保存可清除" allow-clear>
                        <template #suffix>
                          <a-tooltip :content="s.CHAT_TOOLTIP_MATTERMOST" position="left">
                            <span class="config-suffix-hint">说明</span>
                          </a-tooltip>
                        </template>
                      </a-input-password>
                    </a-form-item>
                  </a-collapse-item>
                </a-collapse>

                <a-form-item>
                  <a-space wrap>
                    <a-button type="primary" :loading="s.configSaveLoading" @click="s.saveOpenClawFormFromSettings">保存 OpenClaw 配置</a-button>
                    <a-button
                      v-if="!s.settingsWizardCompleted"
                      type="outline"
                      :loading="s.configSaveLoading"
                      @click="s.onCompleteConfig"
                    >
                      完成配置并进入主界面
                    </a-button>
                    <a-button @click="s.onBackFromOpenclawPanel">
                      {{ s.configReturnTo === 'agent' ? '返回主界面' : s.configReturnTo === 'settings' ? '返回概览' : '返回安装引导' }}
                    </a-button>
                  </a-space>
                </a-form-item>
              </a-form>
            </div>

            <div v-show="s.settingsCategory === 'automation'" class="settings-panel">
              <a-typography-title :heading="6" class="settings-panel-title">自动化与 GUI</a-typography-title>
              <a-form layout="vertical" class="settings-form settings-form--panel">
                <a-form-item label="启用 GUI 操作路径">
                  <a-switch v-model="s.openclawForm.guiEnabled" />
                  <a-tooltip :content="s.GUI_TOOLTIP_ENABLED" position="left">
                    <span class="config-suffix-hint config-suffix-hint--inline">?</span>
                  </a-tooltip>
                </a-form-item>
                <a-form-item label="允许操作的应用（白名单，逗号分隔）">
                  <a-input v-model="s.openclawForm.guiAllowApps" placeholder="如 Finder, WeChat, Chrome" allow-clear>
                    <template #suffix>
                      <a-tooltip :content="s.GUI_TOOLTIP_ALLOW_APPS" position="left">
                        <span class="config-suffix-hint">说明</span>
                      </a-tooltip>
                    </template>
                  </a-input>
                </a-form-item>
                <a-form-item label="高风险动作执行前确认">
                  <a-switch v-model="s.openclawForm.guiRequireConfirmForDangerous" />
                  <a-tooltip :content="s.GUI_TOOLTIP_CONFIRM" position="left">
                    <span class="config-suffix-hint config-suffix-hint--inline">?</span>
                  </a-tooltip>
                </a-form-item>
                <a-divider orientation="left">GUI 审计日志（最近 60 条）</a-divider>
                <a-form-item label="筛选与导出">
                  <a-space wrap>
                    <a-button size="small" type="outline" :loading="s.settingsGuiAuditLoading" @click="s.loadGuiAuditLogs">刷新</a-button>
                    <a-select v-model="s.settingsGuiAuditStatusFilter" size="small" style="width: 140px">
                      <a-option value="all">状态：全部</a-option>
                      <a-option value="blocked">状态：仅阻断</a-option>
                      <a-option value="executing">状态：仅执行中</a-option>
                    </a-select>
                    <a-select v-model="s.settingsGuiAuditRiskFilter" size="small" style="width: 140px">
                      <a-option value="all">风险：全部</a-option>
                      <a-option value="high">风险：高</a-option>
                      <a-option value="medium">风险：中</a-option>
                      <a-option value="low">风险：低</a-option>
                    </a-select>
                    <a-button size="small" type="primary" @click="s.exportGuiAuditLogs">导出当前筛选</a-button>
                    <a-typography-text type="secondary">来源：~/.openclaw/logs/gui-actions.jsonl</a-typography-text>
                  </a-space>
                  <div v-if="s.settingsGuiAuditFiltered.length" class="gui-audit-table-wrap">
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
                        <tr v-for="(row, idx) in s.settingsGuiAuditFiltered" :key="`${row.ts}-${idx}`">
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
                <a-form-item>
                  <a-button type="primary" :loading="s.configSaveLoading" @click="s.saveOpenClawFormFromSettings">保存 GUI 策略</a-button>
                </a-form-item>
              </a-form>
            </div>
          </div>
        </div>
      </div>
</template>

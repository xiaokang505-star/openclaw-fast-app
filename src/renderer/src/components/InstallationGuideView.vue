<script setup lang="ts">
import type { DetectionReport, StepResult } from '../types';

defineProps<{
  guideReport: DetectionReport | null;
  guideSteps: { key: string; getStep: (r: DetectionReport) => StepResult }[];
  stepLabels: Record<string, string>;
  guideAllPassed: boolean;
  freeModelChoice: 'pending' | 'yes' | 'no';
  nvmInstalled: boolean;
  nvmInstallRunning: boolean;
  nvmSuggestedVersions: string[];
  nvmMirrorPresets: { id: string; name: string; url: string }[];
  nvmInstallProgress: string;
  installOpenClawRunning: boolean;
  installOpenClawLog: string;
  startGatewayInProcessRunning: boolean;
  installDaemonRunning: boolean;
  ollamaModels: { name: string }[];
  ollamaServeRunning: boolean;
  ollamaServeProgress: string;
  ollamaProviderWritten: boolean;
}>();

const selectedNodeVersion = defineModel<string>('selectedNodeVersion', { default: '22' });
const settingsNvmNodeMirror = defineModel<string>('settingsNvmNodeMirror', { default: '' });
const selectedOllamaModel = defineModel<string>('selectedOllamaModel', { default: '' });

defineEmits<{
  refresh: [];
  'install-nvm': [];
  'open-node-url': [];
  'install-node-nvm': [];
  'install-openclaw': [];
  'start-gateway': [];
  'install-daemon': [];
  'open-config-dir': [];
  'free-yes': [];
  'free-no': [];
  'ollama-serve': [];
  'write-provider': [];
  'enter-config': [];
}>();
</script>

<template>
  <a-card class="guide-card ollama-guide-card" title="安装引导" :bordered="false">
    <a-typography-paragraph type="secondary">按顺序完成以下步骤，完成一项后可点击「重新检测」更新状态。</a-typography-paragraph>
    <a-button type="secondary" size="small" class="guide-refresh" @click="$emit('refresh')">重新检测</a-button>
    <a-steps
      direction="vertical"
      :current="guideSteps.findIndex((s) => guideReport && !s.getStep(guideReport).ok)"
      class="guide-steps"
    >
      <a-step
        v-for="item in guideSteps"
        :key="item.key"
        :title="stepLabels[item.key]"
        :status="guideReport && item.getStep(guideReport).ok ? 'finish' : 'process'"
      >
        <template #description>
          <a-typography-text :type="guideReport && item.getStep(guideReport).ok ? 'secondary' : undefined">
            {{
              guideReport && item.getStep(guideReport).ok
                ? item.getStep(guideReport).version || item.getStep(guideReport).message || '通过'
                : (guideReport && (item.getStep(guideReport).error || item.getStep(guideReport).message)) || '未通过'
            }}
          </a-typography-text>
          <div v-if="guideReport && !item.getStep(guideReport).ok" class="step-actions">
            <template v-if="item.key === 'env'">
              <a href="https://docs.openclaw.ai/setup" target="_blank" rel="noopener">查看文档</a>
            </template>
            <template v-else-if="item.key === 'node'">
              <template v-if="!nvmInstalled">
                <a-space>
                  <a-button type="primary" size="small" :loading="nvmInstallRunning" @click="$emit('install-nvm')">
                    {{ nvmInstallRunning ? '安装中…' : '安装 nvm' }}
                  </a-button>
                  <a-button size="small" @click="$emit('open-node-url')">打开 Node 下载页</a-button>
                </a-space>
                <a-typography-text type="secondary" class="step-hint">
                  安装 nvm 后可在下方选择 Node 版本并安装（仅 macOS/Linux）。Windows 请使用「打开 Node 下载页」。
                </a-typography-text>
              </template>
              <template v-else>
                <a-space direction="vertical" fill size="small">
                  <a-select v-model="selectedNodeVersion" placeholder="Node 版本" style="width: 140px" size="small">
                    <a-option v-for="v in nvmSuggestedVersions" :key="v" :value="v">{{ v }} (LTS)</a-option>
                  </a-select>
                  <a-select
                    v-model="settingsNvmNodeMirror"
                    placeholder="下载镜像（可选）"
                    style="width: 200px"
                    size="small"
                    allow-clear
                  >
                    <a-option value="">默认</a-option>
                    <a-option v-for="p in nvmMirrorPresets" :key="p.id" :value="p.url">{{ p.name }}</a-option>
                  </a-select>
                  <a-button type="primary" size="small" :loading="nvmInstallRunning" @click="$emit('install-node-nvm')">
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
                <a-button type="primary" size="small" :loading="installOpenClawRunning" @click="$emit('install-openclaw')">
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
                  <a-button type="primary" size="small" :loading="startGatewayInProcessRunning" @click="$emit('start-gateway')">
                    {{ startGatewayInProcessRunning ? '启动中…' : '由本应用启动网关（推荐）' }}
                  </a-button>
                  <a-button size="small" :loading="installDaemonRunning" @click="$emit('install-daemon')">
                    {{ installDaemonRunning ? '执行中…' : '安装并启动 Daemon' }}
                  </a-button>
                </a-space>
              </a-space>
            </template>
            <template v-else-if="item.key === 'config'">
              <a-space>
                <a-button type="primary" size="small" @click="$emit('open-config-dir')">打开配置目录</a-button>
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
        <a-button type="primary" size="small" @click="$emit('free-yes')">是，启用</a-button>
        <a-button size="small" @click="$emit('free-no')">否，跳过</a-button>
      </a-space>
    </div>
    <div v-else-if="guideReport?.config?.ok && freeModelChoice === 'yes'" class="guide-phase2">
      <a-divider>免费本地模型（Ollama）</a-divider>
      <template v-if="ollamaModels.length === 0 && !ollamaServeRunning">
        <a-typography-paragraph type="secondary">若本机未运行 Ollama，可点击下方通过 electron-ollama 内嵌启动。</a-typography-paragraph>
        <a-button type="primary" size="small" :loading="ollamaServeRunning" @click="$emit('ollama-serve')">启动 Ollama</a-button>
      </template>
      <template v-else-if="ollamaServeRunning">
        <a-typography-text type="secondary">{{ ollamaServeProgress }}</a-typography-text>
      </template>
      <template v-else>
        <a-select v-model="selectedOllamaModel" placeholder="选择模型" style="width: 200px" size="small" allow-clear>
          <a-option v-for="m in ollamaModels" :key="m.name" :value="m.name">{{ m.name }}</a-option>
        </a-select>
        <a-button type="primary" size="small" :disabled="!selectedOllamaModel || ollamaProviderWritten" @click="$emit('write-provider')">
          {{ ollamaProviderWritten ? '已写入配置' : '写入 OpenClaw 配置' }}
        </a-button>
      </template>
    </div>
    <div v-if="guideAllPassed" class="guide-phase2">
      <a-divider>阶段二：OpenClaw 配置</a-divider>
      <a-typography-paragraph type="secondary">安装已就绪，请填写基础配置项后进入主界面。</a-typography-paragraph>
      <a-button type="primary" @click="$emit('enter-config')">进入 OpenClaw 配置</a-button>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import InstallationGuideView from '@/components/InstallationGuideView.vue';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const {
  guideReport,
  guideAllPassed,
  freeModelChoice,
  nvmInstalled,
  nvmInstallRunning,
  nvmSuggestedVersions,
  nvmMirrorPresets,
  nvmInstallProgress,
  installOpenClawRunning,
  installOpenClawLog,
  startGatewayInProcessRunning,
  ollamaModels,
  ollamaServeRunning,
  ollamaServeProgress,
  ollamaProviderWritten,
  selectedNodeVersion,
  settingsNvmNodeMirror,
  selectedOllamaModel,
} = storeToRefs(store);
</script>

<template>
  <InstallationGuideView
    v-if="guideReport"
    v-model:selected-node-version="selectedNodeVersion"
    v-model:settings-nvm-node-mirror="settingsNvmNodeMirror"
    v-model:selected-ollama-model="selectedOllamaModel"
    :guide-report="guideReport"
    :guide-steps="store.guideSteps"
    :step-labels="store.stepLabels"
    :guide-all-passed="guideAllPassed"
    :free-model-choice="freeModelChoice"
    :nvm-installed="nvmInstalled"
    :nvm-install-running="nvmInstallRunning"
    :nvm-suggested-versions="nvmSuggestedVersions"
    :nvm-mirror-presets="nvmMirrorPresets"
    :nvm-install-progress="nvmInstallProgress"
    :install-openclaw-running="installOpenClawRunning"
    :install-openclaw-log="installOpenClawLog"
    :start-gateway-in-process-running="startGatewayInProcessRunning"
    :ollama-models="ollamaModels"
    :ollama-serve-running="ollamaServeRunning"
    :ollama-serve-progress="ollamaServeProgress"
    :ollama-provider-written="ollamaProviderWritten"
    @refresh="store.refreshGuide"
    @install-nvm="store.doInstallNvm"
    @open-node-url="store.openNodeUrl"
    @install-node-nvm="store.doInstallNodeViaNvm"
    @install-openclaw="store.doInstallOpenClaw"
    @start-gateway="store.doStartGatewayInProcess"
    @open-config-dir="store.openConfigDir"
    @free-yes="store.onFreeModelYes"
    @free-no="store.onFreeModelNo"
    @ollama-serve="store.onOllamaServe"
    @write-provider="store.onWriteOllamaProvider"
    @enter-config="store.onEnterConfig()"
  />
</template>

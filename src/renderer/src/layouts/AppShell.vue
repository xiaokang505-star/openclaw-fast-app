<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { IconSettings } from '@arco-design/web-vue/es/icon';
import WindowTitleBar from '@/components/WindowTitleBar.vue';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const { windowTitle, windowIsMaximized } = storeToRefs(store);
const route = useRoute();

const subtitle = computed(() =>
  route.name === 'home' ? '检测环境并跟随步骤完成安装' : '帮助你在本机快速安装与配置 OpenClaw'
);

const showSubtitle = computed(() => route.name !== 'install-detecting');

const showAppWide = computed(() => ['settings', 'agent'].includes(String(route.name)));

onMounted(() => {
  void store.bootstrap();
});
</script>

<template>
  <div :class="['app', 'arco-theme-light', showAppWide && 'app--wide']">
    <WindowTitleBar
      :title="windowTitle"
      :is-maximized="windowIsMaximized"
      :show-maximize="false"
      @minimize="store.onWindowMinimize"
      @maximize="store.onWindowMaximizeToggle"
      @close="store.onWindowClose"
    />

    <header class="header header--ollama">
      <div class="header-brand">
        <a-typography-title :heading="5" class="header-title">OpenClaw 安装助手</a-typography-title>
        <a-typography-text v-if="showSubtitle" type="secondary" class="subtitle">
          {{ subtitle }}
        </a-typography-text>
      </div>
      <div class="header-toolbar">
        <a-button v-if="route.name === 'install-result'" type="text" size="small" @click="store.onBack">返回</a-button>
        <a-button v-else-if="route.name === 'install-software'" type="text" size="small" @click="store.onBack">返回首页</a-button>
        <a-button v-else-if="route.name === 'settings'" type="text" size="small" @click="store.onBackFromSettings">
          {{ store.settingsWizardCompleted ? '返回主界面' : '返回' }}
        </a-button>
        <a-button
          v-if="route.name !== 'settings' && route.name !== 'install-detecting'"
          type="text"
          class="header-settings-btn"
          title="设置"
          @click="store.onSettings"
        >
          <template #icon>
            <IconSettings :size="22" />
          </template>
        </a-button>
      </div>
    </header>

    <main class="main">
      <router-view />
    </main>

    <footer v-if="String(route.name) !== 'agent'" class="footer">
      <a href="https://docs.openclaw.ai/setup" target="_blank" rel="noopener noreferrer" class="footer-link">打开 OpenClaw 文档</a>
    </footer>
  </div>
</template>

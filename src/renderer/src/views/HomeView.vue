<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const { platformInfo } = storeToRefs(store);
</script>

<template>
  <a-card class="hero-card hero-card--compact" :bordered="false">
    <div class="home-hero">
      <a-typography-title :heading="5" class="home-hero-title">欢迎使用</a-typography-title>
      <a-typography-text type="secondary" class="home-hero-lead">
        一键检测本机环境，按步骤安装 Node、OpenClaw 与网关，随后进入配置与对话。
      </a-typography-text>
      <a-button type="primary" size="large" long class="home-hero-cta" @click="store.onStart">
        开始
      </a-button>
      <a-typography-text type="secondary" class="home-hero-meta">{{ platformInfo }}</a-typography-text>
    </div>
  </a-card>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const { detectionResult, resultSteps, stepLabels } = storeToRefs(store);
</script>

<template>
  <a-card v-if="detectionResult" class="result-card" title="检测结果" :bordered="false">
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
      <a-button v-if="detectionResult.canEnterGuide" type="primary" @click="store.onEnterGuide">
        进入安装引导
      </a-button>
      <a-button type="secondary" @click="store.onBack">返回首页</a-button>
    </a-space>
  </a-card>
</template>

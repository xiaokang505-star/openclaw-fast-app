<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const { detectionProgress } = storeToRefs(store);
</script>

<template>
  <a-card class="detecting-card" :bordered="false">
    <a-spin size="large" tip="正在检测运行环境…">
      <div class="detecting-content">
        <a-typography-paragraph>{{ detectionProgress }}</a-typography-paragraph>
      </div>
    </a-spin>
  </a-card>
</template>

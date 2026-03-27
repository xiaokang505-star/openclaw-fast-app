<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    isMaximized: boolean;
    /** 固定窗口大小时可隐藏最大化按钮 */
    showMaximize?: boolean;
  }>(),
  { showMaximize: true }
);

defineEmits<{
  minimize: [];
  maximize: [];
  close: [];
}>();
</script>

<template>
  <div class="window-titlebar" aria-label="自定义窗口标题栏">
    <div class="window-titlebar__drag-region">
      <span class="window-titlebar__title">{{ title }}</span>
    </div>
    <div class="window-titlebar__actions no-drag">
      <button type="button" class="window-titlebar__btn" title="最小化" aria-label="最小化" @click="$emit('minimize')">
        <span class="window-titlebar__symbol">-</span>
      </button>
      <button
        v-if="showMaximize"
        type="button"
        class="window-titlebar__btn"
        :title="isMaximized ? '还原' : '最大化'"
        :aria-label="isMaximized ? '还原' : '最大化'"
        @click="$emit('maximize')"
      >
        <span class="window-titlebar__symbol">{{ isMaximized ? '❐' : '□' }}</span>
      </button>
      <button type="button" class="window-titlebar__btn window-titlebar__btn--danger" title="关闭" aria-label="关闭" @click="$emit('close')">
        <span class="window-titlebar__symbol">×</span>
      </button>
    </div>
  </div>
</template>

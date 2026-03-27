<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useApplicationStore } from '@/stores/application';

const store = useApplicationStore();
const {
  agentInput,
  agentMessages,
  agentLoading,
  agentStreaming,
  MARKDOWN_PLACEHOLDER,
  STREAMING_PLACEHOLDER,
} = storeToRefs(store);
const { renderMarkdown } = store;
</script>

<template>
  <section class="agent-view">
    <div class="agent-messages">
      <template v-if="agentMessages.length === 0">
        <a-empty description="输入消息与 OpenClaw 对话（需已启动网关）" class="agent-placeholder" />
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
        @press-enter="store.onAgentSend"
      />
      <a-button type="primary" class="agent-send" :loading="agentLoading || agentStreaming" @click="store.onAgentSend">
        发送
      </a-button>
    </div>
  </section>
</template>

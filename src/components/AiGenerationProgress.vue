<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { buildAiStory, formatWorkDuration, type AiActivity, type AiActivityKind } from '../lib/aiActivity';
import { language, t } from '../lib/i18n';
import AiProgressBar from './AiProgressBar.vue';

const props = defineProps<{ busy?: boolean; progress?: string; completed?: number; total?: number; activity?: AiActivity[] }>();
const emit = defineEmits<{ cancel: [] }>();
const timeline = ref<HTMLElement | null>(null);
const story = computed(() => buildAiStory(props.activity ?? [], language.value === 'zh-CN'));
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 1_000); });
onUnmounted(() => { if (clock) clearInterval(clock); });
const latestKind = computed<AiActivityKind>(() => props.activity?.at(-1)?.kind ?? 'phase');
const duration = computed(() => {
  const first = props.activity?.[0]?.at ?? now.value;
  const end = props.busy ? now.value : props.activity?.at(-1)?.at ?? now.value;
  return formatWorkDuration(end - first, language.value === 'zh-CN');
});
function icon(kind: AiActivityKind | 'tools') {
  return ({ phase: 'bi-diagram-3', request: 'bi-chat-dots', tool: 'bi-terminal', tools: 'bi-terminal', finding: 'bi-lightbulb', validation: 'bi-check2-circle', retry: 'bi-arrow-repeat', done: 'bi-check-circle', error: 'bi-exclamation-triangle', canceled: 'bi-x-circle' })[kind];
}
watch(() => props.activity?.length, async () => {
  const element = timeline.value;
  const follow = element && element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  if (!follow) return;
  await nextTick();
  if (timeline.value) timeline.value.scrollTop = timeline.value.scrollHeight;
});
function heading() {
  if (props.busy) return language.value === 'zh-CN' ? '正在整理改动主题' : 'Organizing change topics';
  const kind = props.activity?.at(-1)?.kind;
  if (kind === 'done') return language.value === 'zh-CN' ? '主题整理完成' : 'Change topics are ready';
  if (kind === 'canceled') return language.value === 'zh-CN' ? '主题整理已取消' : 'Topic organization canceled';
  return language.value === 'zh-CN' ? '主题整理未完成' : 'Topic organization did not finish';
}
function toolCount(count: number) { return language.value === 'zh-CN' ? `查看 ${count} 次工具调用` : `Show ${count} tool ${count === 1 ? 'call' : 'calls'}`; }
</script>

<template>
  <div class="topic-generation-progress" :class="{ 'is-finished': !busy }">
    <div class="topic-generation-heading"><i class="bi" :class="[icon(latestKind), { 'icon-spin': busy && latestKind === 'retry' }]" aria-hidden="true"></i><strong>{{ heading() }}</strong><span class="ai-worked-time">{{ language === 'zh-CN' ? busy ? '已工作' : '用时' : busy ? 'Working for' : 'Worked for' }} {{ duration }}</span><button v-if="busy" type="button" class="button-outline" @click="emit('cancel')">{{ t('Cancel') }}</button></div>
    <p v-if="busy" class="ai-current-status" role="status"><i class="bi" :class="icon(latestKind)" aria-hidden="true"></i><span>{{ progress }}</span></p>
    <AiProgressBar v-if="busy" :completed="completed" :total="total" />
    <details class="ai-activity">
      <summary>{{ language === 'zh-CN' ? busy ? '展开工作过程' : '工作记录' : busy ? 'Show work log' : 'Work log' }}</summary>
      <div ref="timeline" class="ai-story" :aria-label="language === 'zh-CN' ? '工作记录' : 'Work log'">
        <div v-for="entry in story" :key="entry.id" class="ai-story-step" :class="`ai-story-${entry.kind}`">
          <i class="bi ai-story-icon" :class="icon(entry.kind)" aria-hidden="true"></i>
          <div class="ai-story-content">
            <p>{{ entry.title }}</p>
            <small v-if="entry.detail">{{ entry.detail }}</small>
            <details v-if="entry.tools?.length" class="ai-tool-details">
              <summary>{{ toolCount(entry.tools.length) }}</summary>
              <ul><li v-for="tool in entry.tools" :key="tool.id"><strong>{{ tool.title }}</strong><span v-if="tool.detail">{{ tool.detail }}</span></li></ul>
            </details>
          </div>
        </div>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { buildAiStory, formatWorkDuration } from '../lib/aiActivity';
import { aiTasks, cancelAiTask, dismissAiTask, type AiTask, type AiTaskKind } from '../lib/aiTasks';
import { language, t } from '../lib/i18n';
import AiProgressBar from './AiProgressBar.vue';

const open = ref(false);
const selectedId = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
const tasks = computed(() => [...aiTasks.values()].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.startedAt - a.startedAt));
const runningCount = computed(() => tasks.value.filter(task => task.status === 'running').length);
const selected = computed(() => tasks.value.find(task => task.id === selectedId.value) ?? tasks.value[0] ?? null);
const lead = computed(() => tasks.value[0] ?? null);
const story = computed(() => selected.value ? buildAiStory(selected.value.activity, language.value === 'zh-CN', selected.value.kind === 'request-review') : []);
watch(tasks, value => { if (selectedId.value && !value.some(task => task.id === selectedId.value)) selectedId.value = value[0]?.id ?? null; });
function title(kind: AiTaskKind) { return t(({ 'topic-review': 'Generate AI topics', 'request-review': 'Request Review', 'review-title': 'Generating review title' })[kind]); }
function status(task: AiTask) { return t(({ running: 'Running', done: 'Completed', error: 'Failed', canceled: 'Canceled' })[task.status]); }
function duration(task: AiTask) { return formatWorkDuration((task.finishedAt ?? now.value) - task.startedAt, language.value === 'zh-CN'); }
function outside(event: PointerEvent) { if (root.value && event.target instanceof Node && !root.value.contains(event.target)) open.value = false; }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false; }
onMounted(() => { clock = setInterval(() => { now.value = Date.now(); }, 1_000); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keydown); });
onUnmounted(() => { if (clock) clearInterval(clock); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown); });
</script>

<template>
  <div ref="root" class="ai-task-dock">
    <section v-if="open" id="ai-task-panel" class="ai-task-panel" :aria-label="t('Copilot Tasks')">
      <header class="ai-task-panel-heading"><div><strong>{{ t('Copilot Tasks') }}</strong><span>{{ runningCount }} {{ t('running') }} · {{ tasks.length }} {{ t('total') }}</span></div><button type="button" :aria-label="t('Close Copilot Tasks')" @click="open = false"><i class="bi bi-x-lg" aria-hidden="true"></i></button></header>
      <p v-if="!tasks.length" class="ai-task-empty">{{ t('No Copilot tasks yet.') }}</p>
      <div v-else class="ai-task-list">
        <div v-for="task in tasks" :key="task.id" class="ai-task-item" :class="{ selected: selected?.id === task.id }">
          <button type="button" class="ai-task-item-main" :aria-expanded="selected?.id === task.id" @click="selectedId = task.id"><i class="bi" :class="[task.status === 'running' ? 'bi-stars ai-task-active-icon' : task.status === 'done' ? 'bi-check-circle' : task.status === 'error' ? 'bi-exclamation-triangle' : 'bi-x-circle']" aria-hidden="true"></i><span><strong>{{ title(task.kind) }}</strong><small>{{ task.projectName }} · {{ status(task) }}<span v-if="task.finishedAt"> · {{ duration(task) }}</span></small></span></button>
          <button v-if="task.status === 'running'" type="button" class="ai-task-row-cancel" :aria-label="`${t('Cancel')} ${title(task.kind)}`" :title="t('Cancel')" @click="cancelAiTask(task.id)"><i class="bi bi-stop-circle" aria-hidden="true"></i></button>
          <button v-else type="button" class="ai-task-dismiss" :aria-label="t('Dismiss task')" @click="dismissAiTask(task.id)"><i class="bi bi-x" aria-hidden="true"></i></button>
        </div>
      </div>
      <div v-if="selected" class="ai-task-detail"><div class="ai-task-detail-heading"><strong>{{ title(selected.kind) }}</strong><span>{{ duration(selected) }}</span></div><p>{{ selected.detail }}</p><AiProgressBar v-if="selected.status === 'running'" :completed="selected.completed" :total="selected.total" /><small v-if="selected.total">{{ selected.completed }} / {{ selected.total }} {{ selected.kind === 'topic-review' ? t('groups') : selected.kind === 'request-review' ? t('topics') : t('tasks') }}</small><div v-if="story.length" class="ai-task-story"><div v-for="entry in story" :key="entry.id"><i class="bi" :class="entry.kind === 'done' ? 'bi-check-circle' : entry.kind === 'error' ? 'bi-exclamation-triangle' : entry.kind === 'tools' ? 'bi-terminal' : 'bi-dot'" aria-hidden="true"></i><span>{{ entry.title }}<small v-if="entry.detail">{{ entry.detail }}</small><details v-if="entry.tools?.length"><summary>{{ entry.tools.length }} {{ t('tool calls') }}</summary><ul><li v-for="tool in entry.tools" :key="tool.id">{{ tool.title }}<small v-if="tool.detail">{{ tool.detail }}</small></li></ul></details></span></div></div></div>
    </section>
    <button type="button" class="ai-task-trigger" :class="{ 'is-running': runningCount }" :aria-expanded="open" aria-controls="ai-task-panel" @click="open = !open"><i class="bi" :class="'bi-stars'" aria-hidden="true"></i><span><strong>{{ lead ? title(lead.kind) : t('Copilot Tasks') }}</strong><small>{{ lead ? `${status(lead)} · ${duration(lead)}${lead.total ? ` · ${lead.completed}/${lead.total}` : ''}` : t('No active tasks') }}</small><small v-if="lead?.detail" class="ai-task-trigger-detail" :title="lead.detail">{{ lead.detail }}</small></span><b v-if="runningCount">{{ runningCount }}</b><i class="bi bi-chevron-up ai-task-trigger-chevron" :class="{ open }" aria-hidden="true"></i></button>
  </div>
</template>

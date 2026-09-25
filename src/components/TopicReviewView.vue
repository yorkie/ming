<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Project, ReviewRecord } from '../lib/projectStore';
import type { GlobalSettings } from '../lib/globalSettings';
import type { Review } from '../lib/reviewTypes';
import type { Topic } from '../lib/aiReviewTypes';
import { renderMarkdownInline } from '../lib/markdownDocument';
import DiffFile from './DiffFile.vue';

const props = defineProps<{ project: Project; record: ReviewRecord; data: Review; settings: GlobalSettings }>();
const emit = defineEmits<{ markTopic: [id: string, status: 'reviewed' | 'needs-work' | null] }>();
const topics = computed(() => props.record.aiReview?.artifact.topics ?? []);
const reviewRoot = ref<HTMLElement | null>(null);
const activeId = ref(topics.value[0]?.id ?? '');
watch(topics, value => { if (!value.some(topic => topic.id === activeId.value)) activeId.value = value[0]?.id ?? ''; });
const activeTopic = computed(() => topics.value.find(topic => topic.id === activeId.value) ?? null);
const originalActions = ref<HTMLElement | null>(null);
const showFloatingActions = ref(false);
function updateFloatingActions() {
  const threshold = document.querySelector<HTMLElement>('.review-tabs')?.getBoundingClientRect().bottom ?? 0;
  showFloatingActions.value = (originalActions.value?.getBoundingClientRect().bottom ?? Infinity) <= threshold;
}
watch(activeId, async () => { showFloatingActions.value = false; await nextTick(); updateFloatingActions(); });
onMounted(() => { window.addEventListener('scroll', updateFloatingActions, { passive: true }); window.addEventListener('resize', updateFloatingActions); updateFloatingActions(); });
onUnmounted(() => { window.removeEventListener('scroll', updateFloatingActions); window.removeEventListener('resize', updateFloatingActions); });
const completed = computed(() => topics.value.filter(topic => props.record.aiReview?.reviewed[topic.id] === 'reviewed').length);
const files = computed(() => {
  const groups = new Map<number, number[]>();
  for (const id of activeTopic.value?.unitIds ?? []) {
    const match = /^f(\d+)(?:h(\d+))?$/.exec(id);
    if (!match) continue;
    const fileIndex = Number(match[1]);
    if (!props.data.files[fileIndex]) continue;
    const indexes = groups.get(fileIndex) ?? [];
    if (match[2] !== undefined) indexes.push(Number(match[2]));
    groups.set(fileIndex, indexes);
  }
  return [...groups].map(([index, hunkIndices]) => ({ index, file: props.data.files[index], hunkIndices }));
});
function status(topic: Topic) { return props.record.aiReview?.reviewed[topic.id] ?? null; }
function markTopic(topic: Topic, next: 'reviewed' | 'needs-work') { emit('markTopic', topic.id, status(topic) === next ? null : next); }
async function selectTopic(id: string) {
  activeId.value = id;
  await nextTick();
  const tabs = document.querySelector<HTMLElement>('.review-tabs');
  const root = reviewRoot.value;
  if (!tabs || !root) return;
  const tabsTop = Number.parseFloat(window.getComputedStyle(tabs).top) || 0;
  const target = window.scrollY + root.getBoundingClientRect().top - (tabsTop + tabs.offsetHeight - 2);
  window.scrollTo({ top: Math.max(0, target), behavior: 'instant' });
}
</script>

<template>
  <div ref="reviewRoot" class="topic-review"><aside class="topic-list" aria-label="Review topics"><div class="topic-list-heading"><strong>Review topics</strong><span>{{ completed }} / {{ topics.length }} reviewed</span></div><button v-for="(topic, index) in topics" :key="topic.id" type="button" class="topic-list-item" :class="{ active: activeId === topic.id }" @click="selectTopic(topic.id)"><span class="topic-number">{{ String(index + 1).padStart(2, '0') }}</span><span><strong>{{ topic.title }}</strong><small>{{ topic.unitIds.length }} change {{ topic.unitIds.length === 1 ? 'range' : 'ranges' }} · {{ status(topic) === 'reviewed' ? 'Reviewed' : status(topic) === 'needs-work' ? 'Needs another look' : 'To review' }}</small></span></button></aside>
    <section v-if="activeTopic" class="topic-detail">
      <div class="topic-detail-heading"><span class="minor-heading">{{ activeTopic.id === 'uncategorized' ? 'UNASSIGNED CHANGE RANGES' : 'AI-ORGANIZED TOPIC · CHECK THE DIFF' }}</span><h3>{{ activeTopic.title }}</h3><p v-html="renderMarkdownInline(activeTopic.summary)"></p></div>
      <div class="topic-checks">
        <div ref="originalActions" class="topic-checks-heading">
          <strong>{{ activeTopic.checks.length ? 'What to check' : 'Review status' }}</strong>
          <div class="topic-actions"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look' }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed' }}</button></div>
        </div>
        <ul v-if="activeTopic.checks.length"><li v-for="(check, index) in activeTopic.checks" :key="index" v-html="renderMarkdownInline(check)"></li></ul>
      </div>
      <div class="topic-diffs"><DiffFile v-for="entry in files" :key="`${record.id}:${activeTopic.id}:${entry.index}`" :file="entry.file" :index="entry.index" :hunk-indices="entry.hunkIndices" :project="project" :record="record" :data="data" :settings="settings" :selected="false" /></div>
    </section>
    <div v-if="activeTopic && showFloatingActions" class="topic-floating-actions" :aria-label="`Review actions for ${activeTopic.title}`"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look' }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed' }}</button></div>
  </div>
</template>

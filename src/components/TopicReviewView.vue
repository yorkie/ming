<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { topicsAreStale, type Project, type ReviewRecord } from '../lib/projectStore';
import type { GlobalSettings } from '../lib/globalSettings';
import type { Review } from '../lib/reviewTypes';
import type { Topic } from '../lib/aiReviewTypes';
import { renderMarkdownInline } from '../lib/markdownDocument';
import DiffFile from './DiffFile.vue';
import { language, t } from '../lib/i18n';

const props = defineProps<{ project: Project; record: ReviewRecord; data: Review; settings: GlobalSettings; aiBusy?: boolean; aiProgress?: string; aiCompleted?: number; aiTotal?: number }>();
const emit = defineEmits<{ markTopic: [id: string, status: 'reviewed' | 'needs-work' | null]; generateAiReview: []; cancelAiReview: [] }>();
const topics = computed(() => props.record.aiReview?.artifact.topics ?? []);
const stale = computed(() => topicsAreStale(props.record));
const topicData = computed<Review | null>(() => {
  if (!stale.value) return props.data;
  try { return props.record.aiReview?.sourceData ? JSON.parse(props.record.aiReview.sourceData) as Review : null; }
  catch { return null; }
});
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
const completed = computed(() => stale.value ? 0 : topics.value.filter(topic => props.record.aiReview?.reviewed[topic.id] === 'reviewed').length);
const files = computed(() => {
  const groups = new Map<number, number[]>();
  for (const id of activeTopic.value?.unitIds ?? []) {
    const match = /^f(\d+)(?:h(\d+))?$/.exec(id);
    if (!match) continue;
    const fileIndex = Number(match[1]);
    if (!topicData.value?.files[fileIndex]) continue;
    const indexes = groups.get(fileIndex) ?? [];
    if (match[2] !== undefined) indexes.push(Number(match[2]));
    groups.set(fileIndex, indexes);
  }
  return [...groups].map(([index, hunkIndices]) => ({ index, file: topicData.value!.files[index], hunkIndices }));
});
function status(topic: Topic) { return stale.value ? null : props.record.aiReview?.reviewed[topic.id] ?? null; }
function markTopic(topic: Topic, next: 'reviewed' | 'needs-work') {
  const nextStatus = status(topic) === next ? null : next;
  emit('markTopic', topic.id, nextStatus);
  if (nextStatus !== 'reviewed') return;
  const index = topics.value.findIndex(item => item.id === topic.id);
  const nextTopic = topics.value.slice(index + 1).find(item => status(item) !== 'reviewed');
  if (nextTopic) void selectTopic(nextTopic.id);
}
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
  <div ref="reviewRoot" class="topic-review" :class="{ 'is-stale': stale }"><div v-if="aiBusy" class="topic-stale-notice topic-generation-progress" role="status"><div class="topic-generation-heading"><i class="bi bi-arrow-repeat icon-spin" aria-hidden="true"></i><strong>{{ t('Generating AI topics') }}</strong><button type="button" class="button-outline" @click="emit('cancelAiReview')">{{ t('Cancel') }}</button></div><p>{{ aiProgress }}</p><progress :value="aiTotal ? aiCompleted : undefined" :max="aiTotal || undefined" :aria-label="t('Generating AI topics')"></progress></div><button v-else-if="stale" type="button" class="topic-stale-notice topic-stale-action" @click="emit('generateAiReview')"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span><strong>{{ t('Topics are out of date') }}</strong><span>{{ t('The diff changed after these topics were generated. Regenerate topics, then review them again. The topics below refer to the previous diff.') }}</span></span><span class="topic-stale-link">{{ t('Regenerate topics') }} <i class="bi bi-arrow-right" aria-hidden="true"></i></span></button><aside class="topic-list" :aria-label="t('Review topics')"><div class="topic-list-heading"><strong>{{ t('Review topics') }}</strong><span>{{ stale ? t('Out of date') : language === 'zh-CN' ? `${completed} / ${topics.length} 已评审` : `${completed} / ${topics.length} reviewed` }}</span></div><button v-for="(topic, index) in topics" :key="topic.id" type="button" class="topic-list-item" :class="{ active: activeId === topic.id, reviewed: status(topic) === 'reviewed' }" @click="selectTopic(topic.id)"><span class="topic-number">{{ String(index + 1).padStart(2, '0') }}</span><span><strong>{{ topic.title }}</strong><small>{{ language === 'zh-CN' ? `${topic.unitIds.length} 处改动` : `${topic.unitIds.length} change ${topic.unitIds.length === 1 ? 'range' : 'ranges'}` }} · <span class="topic-status">{{ t(stale ? 'Out of date' : status(topic) === 'reviewed' ? 'Reviewed' : status(topic) === 'needs-work' ? 'Needs another look' : 'To review') }}</span></small></span></button></aside>
    <section v-if="activeTopic" class="topic-detail">
      <div class="topic-detail-heading"><span class="minor-heading">{{ t(activeTopic.id === 'uncategorized' ? 'UNASSIGNED CHANGE RANGES' : 'AI-ORGANIZED TOPIC · CHECK THE DIFF') }}</span><h3>{{ activeTopic.title }}</h3><p v-html="renderMarkdownInline(activeTopic.summary)"></p></div>
      <div class="topic-checks">
        <div ref="originalActions" class="topic-checks-heading">
          <strong>{{ t(activeTopic.checks.length ? 'What to check' : 'Review status') }}</strong>
          <div v-if="!stale && !aiBusy" class="topic-actions"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ t(status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look') }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ t(status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed') }}</button></div>
        </div>
        <ul v-if="activeTopic.checks.length"><li v-for="(check, index) in activeTopic.checks" :key="index" v-html="renderMarkdownInline(check)"></li></ul>
      </div>
      <div v-if="topicData" class="topic-diffs"><DiffFile v-for="entry in files" :key="`${record.id}:${activeTopic.id}:${entry.index}`" :file="entry.file" :index="entry.index" :hunk-indices="entry.hunkIndices" :project="project" :record="record" :data="topicData" :settings="settings" :selected="false" :read-only="stale" /></div>
      <p v-else class="topic-old-diff-unavailable">{{ t('The previous diff is unavailable. Regenerate topics to review the latest changes.') }}</p>
    </section>
    <div v-if="activeTopic && showFloatingActions && !stale && !aiBusy" class="topic-floating-actions" :aria-label="`Review actions for ${activeTopic.title}`"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ t(status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look') }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ t(status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed') }}</button></div>
  </div>
</template>

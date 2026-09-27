<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { topicsAreStale, type Project, type ReviewRecord } from '../lib/projectStore';
import type { GlobalSettings } from '../lib/globalSettings';
import type { Review } from '../lib/reviewTypes';
import type { ReviewComment, Topic } from '../lib/aiReviewTypes';
import { renderMarkdownInline, renderTopicSummary } from '../lib/markdownDocument';
import { commentResolved, historicalComments, topicFilePaths, unresolvedTopicComments, visibleTopics } from '../lib/reviewContinuity';
import { placeEarlierComments } from '../lib/reviewCommentPlacement';
import { topicConversationRuns } from '../lib/topicConversation';
import { changeEventsForReview, type ChangeEvent } from '../lib/reviewTimeline';
import DiffFile from './DiffFile.vue';
import ReviewCommentCard from './ReviewCommentCard.vue';
import type { AiActivity } from '../lib/aiActivity';
import { language, t } from '../lib/i18n';
import { topicFileTypeColor, topicFileTypes } from '../lib/topicFileTypes';
import { reviewCommentsText } from '../lib/reviewCommentsText';

const props = defineProps<{ demo?: boolean; project: Project; record: ReviewRecord; data: Review; settings: GlobalSettings; aiBusy?: boolean; reviewActionsBusy?: boolean; requestReviewBusy?: boolean; aiProgress?: string; aiCompleted?: number; aiTotal?: number; aiActivity?: AiActivity[] }>();
const emit = defineEmits<{ markTopic: [id: string, status: 'reviewed' | 'needs-work' | null]; markComment: [id: string, status: 'resolved' | 'open']; generateAiReview: []; cancelAiReview: []; requestReview: []; deleteReview: [] }>();
const visible = computed<ReturnType<typeof visibleTopics>>(() => props.record.aiReview
  ? visibleTopics(props.record.aiReview) : { topics: [], outdatedSources: {}, aliases: {} });
const topics = computed(() => visible.value.topics);
const stale = computed(() => topicsAreStale(props.record));
const activeId = ref(topics.value[0]?.id ?? '');
function isOutdated(id: string) { return id in visible.value.outdatedSources; }
function sourceForTopic(id: string): Review | null {
  const source = visible.value.outdatedSources[id];
  try { return source ? JSON.parse(source) as Review : null; }
  catch { return null; }
}
function currentTopicSource(): Review | null {
  if (!stale.value) return props.data;
  try { return props.record.aiReview?.sourceData ? JSON.parse(props.record.aiReview.sourceData) as Review : null; }
  catch { return null; }
}
const topicData = computed<Review | null>(() => {
  if (isOutdated(activeId.value)) return sourceForTopic(activeId.value);
  return currentTopicSource();
});
const fileTypes = computed(() => Object.fromEntries(topics.value.map(topic => [topic.id, topicFileTypes(topic,
  isOutdated(topic.id) ? sourceForTopic(topic.id) : currentTopicSource())])));
const reviewRoot = ref<HTMLElement | null>(null);
watch(topics, value => { if (!value.some(topic => topic.id === activeId.value)) activeId.value = value[0]?.id ?? ''; });
const activeTopic = computed(() => topics.value.find(topic => topic.id === activeId.value) ?? null);
const activeTab = ref<'conversation' | 'files'>('conversation');
const focusedCommentId = ref('');
const conversationRuns = computed(() => props.record.aiReview ? topicConversationRuns(props.record.aiReview, activeId.value) : []);
const carriedOpenCount = computed(() => props.record.aiReview ? unresolvedTopicComments(props.record.aiReview, activeId.value).historical.length : 0);
const conversationComments = computed(() => historicalComments(props.record.aiReview!).filter(comment => comment.topicId === activeId.value));
const changeEvents = computed(() => changeEventsForReview(props.record));
const timelineNodes = computed(() => {
  const paths = new Set(activeTopic.value && topicData.value ? topicFilePaths(activeTopic.value, topicData.value) : []);
  for (const revision of props.record.aiReview?.revisions ?? []) {
    if (!revision.sourceData) continue;
    try {
      const source = JSON.parse(revision.sourceData) as Review;
      for (const topic of revision.artifact.topics) {
        if ((visible.value.aliases[topic.id] ?? topic.id) !== activeId.value) continue;
        topicFilePaths(topic, source).forEach(path => paths.add(path));
      }
    } catch { /* Older revisions may not contain a readable diff. */ }
  }
  for (const comment of conversationComments.value) { const path = conversationPath(comment); if (path) paths.add(path); }
  const reviews = conversationRuns.value.map(run => ({ kind: 'review' as const, id: run.id, at: run.createdAt ?? 0, run }));
  const changes = changeEvents.value.filter(event => event.paths.some(path => paths.has(path)))
    .map(event => ({ kind: 'change' as const, id: event.id, at: event.updatedAt, event, paths: event.paths.filter(path => paths.has(path)) }));
  return [...reviews, ...changes].sort((a, b) => a.at - b.at || (a.kind === 'change' ? -1 : 1));
});
function isLatestPendingChange(event: ChangeEvent): boolean {
  return props.data.files.length > 0 && changeEvents.value.at(-1)?.id === event.id && !event.reviewedAt && event.snapshotHash === props.record.snapshotHash;
}
function showChangeReviewAction(event: ChangeEvent): boolean {
  return isLatestPendingChange(event) || !!props.requestReviewBusy && props.data.files.length > 0
    && changeEvents.value.at(-1)?.id === event.id && event.snapshotHash === props.record.snapshotHash;
}
function resolvedRunCount(comments: ReviewComment[]): number { return comments.filter(comment => !!props.record.aiReview && commentResolved(props.record.aiReview, comment.id)).length; }
function conversationPath(comment: ReviewComment): string {
  const placed = earlierPlacement.value.outdated.find(item => item.comment.id === comment.id);
  if (placed) return placed.path;
  const inline = earlierPlacement.value.inline.find(item => item.id === comment.id);
  return topicData.value?.files[inline?.fileIndex ?? comment.fileIndex]?.path ?? '';
}
function conversationLineText(comment: ReviewComment): string {
  const outdated = earlierPlacement.value.outdated.find(item => item.comment.id === comment.id);
  if (outdated) return outdated.lineText;
  const inline = earlierPlacement.value.inline.find(item => item.id === comment.id) ?? comment;
  return topicData.value?.files[inline.fileIndex]?.hunks[inline.hunkIndex]?.lines.find(line => inline.side === 'LEFT'
    ? line.kind === 'delete' && line.oldNumber === inline.lineNumber
    : line.kind !== 'delete' && line.newNumber === inline.lineNumber)?.text ?? '';
}
async function showCommentInFiles(id: string) {
  if (!topicData.value) return;
  activeTab.value = 'files';
  focusedCommentId.value = '';
  await nextTick();
  focusedCommentId.value = id;
  await nextTick();
  requestAnimationFrame(() => {
    const cards = reviewRoot.value?.querySelectorAll<HTMLElement>('.topic-diffs [data-comment-id]') ?? [];
    const target = [...cards].find(card => card.dataset.commentId === id);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}
const summaryExpanded = ref(false);
watch(activeId, () => { summaryExpanded.value = false; focusedCommentId.value = ''; });
const originalActions = ref<HTMLElement | null>(null);
const showFloatingActions = ref(false);
const now = ref(Date.now());
let relativeTimeTimer: ReturnType<typeof setInterval> | undefined;
function relativeDate(value: number) {
  const seconds = Math.max(0, Math.floor((now.value - value) / 1000));
  if (seconds < 60) return language.value === 'zh-CN' ? '刚刚' : 'just now';
  if (seconds < 3600) { const minutes = Math.floor(seconds / 60); return language.value === 'zh-CN' ? `${minutes} 分钟前` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`; }
  if (seconds < 86_400) { const hours = Math.floor(seconds / 3600); return language.value === 'zh-CN' ? `${hours} 小时前` : `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  const days = Math.floor(seconds / 86_400);
  if (days < 30) return language.value === 'zh-CN' ? `${days} 天前` : `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return language.value === 'zh-CN' ? `${months} 个月前` : `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return language.value === 'zh-CN' ? `${years} 年前` : `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
function updateFloatingActions() {
  const threshold = document.querySelector<HTMLElement>('.review-tabs')?.getBoundingClientRect().bottom ?? 0;
  showFloatingActions.value = (originalActions.value?.getBoundingClientRect().bottom ?? Infinity) <= threshold;
}
watch(activeId, async () => { showFloatingActions.value = false; await nextTick(); updateFloatingActions(); });
onMounted(() => { window.addEventListener('scroll', updateFloatingActions, { passive: true }); window.addEventListener('resize', updateFloatingActions); updateFloatingActions(); relativeTimeTimer = window.setInterval(() => { now.value = Date.now(); }, 60_000); });
onUnmounted(() => { window.removeEventListener('scroll', updateFloatingActions); window.removeEventListener('resize', updateFloatingActions); if (relativeTimeTimer) window.clearInterval(relativeTimeTimer); });
const activeTopics = computed(() => topics.value.filter(topic => !isOutdated(topic.id)));
const completed = computed(() => stale.value ? 0 : activeTopics.value.filter(topic => props.record.aiReview?.reviewed[topic.id] === 'reviewed').length);
function unresolvedComments(id: string) { const review = props.record.aiReview; return review ? historicalComments(review).filter(comment => comment.topicId === id && !commentResolved(review, comment.id)) : []; }
function topicIssueCount(id: string) { return unresolvedComments(id).length; }
function currentTopicCommentCount(id: string) { return props.record.aiReview?.comments?.filter(comment => comment.topicId === id).length ?? 0; }
const previousForActive = computed(() => {
  const review = props.record.aiReview;
  if (!review) return [];
  const currentIds = new Set((review.comments ?? []).map(comment => comment.id));
  return historicalComments(review).filter(comment => comment.topicId === activeId.value && !currentIds.has(comment.id));
});
const earlierPlacement = computed(() => props.record.aiReview && topicData.value
  ? placeEarlierComments(props.record.aiReview, previousForActive.value, topicData.value, isOutdated(activeId.value))
  : { inline: [], outdated: [] });
const outdatedByPath = computed(() => {
  const groups = new Map<string, typeof earlierPlacement.value.outdated>();
  for (const conversation of earlierPlacement.value.outdated) {
    const entries = groups.get(conversation.path) ?? [];
    entries.push(conversation);
    groups.set(conversation.path, entries);
  }
  return groups;
});
const absentFileConversations = computed(() => earlierPlacement.value.outdated.filter(item => !topicData.value?.files.some(file => file.path === item.path)));
const activeOpenCount = computed(() => topicIssueCount(activeId.value));
const currentComments = computed(() => props.record.aiReview?.comments?.filter(comment => comment.topicId === activeId.value) ?? []);
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
watch(activeId, () => { copyState.value = 'idle'; });
async function copyCurrentComments() {
  if (!topicData.value || !currentComments.value.length) return;
  try {
    await navigator.clipboard.writeText(reviewCommentsText(currentComments.value, topicData.value, language.value === 'zh-CN'));
    copyState.value = 'copied';
  } catch { copyState.value = 'failed'; }
}
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
  for (const comment of earlierPlacement.value.inline) {
    const indexes = groups.get(comment.fileIndex) ?? [];
    if (!indexes.includes(comment.hunkIndex)) indexes.push(comment.hunkIndex);
    groups.set(comment.fileIndex, indexes);
  }
  for (const comment of props.record.aiReview?.comments?.filter(item => item.topicId === activeId.value) ?? []) {
    if (!topicData.value?.files[comment.fileIndex]) continue;
    const indexes = groups.get(comment.fileIndex) ?? [];
    if (!indexes.includes(comment.hunkIndex)) indexes.push(comment.hunkIndex);
    groups.set(comment.fileIndex, indexes);
  }
  for (const [index, file] of topicData.value?.files.entries() ?? []) {
    if (outdatedByPath.value.has(file.path) && !groups.has(index)) groups.set(index, file.hunks.map((_, hunkIndex) => hunkIndex));
  }
  return [...groups].map(([index, hunkIndices]) => ({ index, file: topicData.value!.files[index], hunkIndices }));
});
function status(topic: Topic) { return stale.value || isOutdated(topic.id) ? null : props.record.aiReview?.reviewed[topic.id] ?? null; }
function markTopic(topic: Topic, next: 'reviewed' | 'needs-work') {
  const nextStatus = status(topic) === next ? null : next;
  emit('markTopic', topic.id, nextStatus);
  if (nextStatus !== 'reviewed') return;
  const index = topics.value.findIndex(item => item.id === topic.id);
  const nextTopic = topics.value.slice(index + 1).find(item => !isOutdated(item.id) && status(item) !== 'reviewed');
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
  <div ref="reviewRoot" class="topic-review" :class="{ 'is-stale': stale }"><button v-if="!aiBusy && stale && data.files.length" type="button" class="topic-stale-notice topic-stale-action" @click="emit('generateAiReview')"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span><strong>{{ t('Topics are out of date') }}</strong><span>{{ t('The diff changed. Update topics using the previous review as context, then check earlier comments against the new code.') }}</span></span><span class="topic-stale-link">{{ language === 'zh-CN' ? '增量更新主题' : 'Update topics' }} <i class="bi bi-arrow-right" aria-hidden="true"></i></span></button><div v-else-if="!aiBusy && stale" class="topic-stale-notice topic-stale-empty"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><span>{{ language === 'zh-CN' ? '当前与基准分支没有差异。若不再需要保留旧评审结果，可以关闭并删除此 Review。' : 'There is no current diff against the base branch. Close and delete this review if you no longer need its saved results.' }}</span><button v-if="!demo" type="button" class="button-outline review-delete" :disabled="reviewActionsBusy" @click="emit('deleteReview')"><i class="bi bi-trash" aria-hidden="true"></i> {{ language === 'zh-CN' ? '关闭并删除' : 'Close and delete' }}</button></div><aside class="topic-list" :aria-label="t('Review topics')"><div class="topic-list-heading"><strong>{{ t('Review topics') }}</strong><span>{{ stale ? t('Out of date') : language === 'zh-CN' ? `${completed} / ${activeTopics.length} 已评审` : `${completed} / ${activeTopics.length} reviewed` }}</span></div><button v-for="(topic, index) in topics" :key="topic.id" type="button" class="topic-list-item" :class="{ active: activeId === topic.id, reviewed: status(topic) === 'reviewed', outdated: isOutdated(topic.id) }" @click="selectTopic(topic.id)"><span class="topic-number">{{ String(index + 1).padStart(2, '0') }}</span><span><strong>{{ topic.title }}</strong><span v-if="fileTypes[topic.id]?.length" class="topic-file-types"><span v-for="type in fileTypes[topic.id]" :key="type" class="topic-file-type" :data-type="type" :style="{ '--language-color': topicFileTypeColor(type) }">{{ type }}</span></span><small class="topic-meta"><span class="topic-change-count" :title="language === 'zh-CN' ? `${topic.unitIds.length} 处改动` : `${topic.unitIds.length} change ${topic.unitIds.length === 1 ? 'range' : 'ranges'}`"><i class="bi bi-file-diff" aria-hidden="true"></i> {{ topic.unitIds.length }}</span><span class="topic-status">{{ t(stale || isOutdated(topic.id) ? 'Out of date' : status(topic) === 'reviewed' ? 'Reviewed' : status(topic) === 'needs-work' ? 'Needs another look' : 'To review') }}</span><span v-if="currentTopicCommentCount(topic.id) > 0" class="topic-comment-count" :title="`${currentTopicCommentCount(topic.id)} ${t('comments')}`"><i class="bi bi-chat-left-text" aria-hidden="true"></i> {{ currentTopicCommentCount(topic.id) }}</span></small></span></button></aside>
    <section v-if="activeTopic" class="topic-detail">
      <div class="topic-detail-heading">
        <span class="minor-heading">{{ t(activeTopic.id === 'uncategorized' ? 'UNASSIGNED CHANGE RANGES' : 'AI-ORGANIZED TOPIC · CHECK THE DIFF') }}</span>
        <h3>{{ activeTopic.title }}</h3>
        <div v-if="fileTypes[activeTopic.id]?.length" class="topic-detail-languages"><span>{{ language === 'zh-CN' ? '涉及语言' : 'Languages' }}</span><span class="topic-file-types"><span v-for="type in fileTypes[activeTopic.id]" :key="type" class="topic-file-type" :data-type="type" :style="{ '--language-color': topicFileTypeColor(type) }">{{ type }}</span></span></div>
        <div ref="originalActions" class="topic-detail-statusbar">
          <div class="topic-detail-status"><span class="topic-status-pill" :class="{ outdated: stale || isOutdated(activeId), reviewed: status(activeTopic) === 'reviewed' }">{{ t(stale || isOutdated(activeId) ? 'Out of date' : status(activeTopic) === 'reviewed' ? 'Reviewed' : status(activeTopic) === 'needs-work' ? 'Needs another look' : 'To review') }}</span><span v-if="activeOpenCount">{{ activeOpenCount }} {{ language === 'zh-CN' ? '条未解决评论' : 'open comments' }}</span></div>
          <div v-if="!stale && !isOutdated(activeTopic.id) && !aiBusy" class="topic-actions"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ t(status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look') }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ t(status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed') }}</button></div>
        </div>
      </div>
      <div class="topic-detail-tabs" role="tablist" :aria-label="language === 'zh-CN' ? '主题内容' : 'Topic content'">
        <button id="topic-conversation-tab" type="button" role="tab" :aria-selected="activeTab === 'conversation'" aria-controls="topic-conversation-panel" :class="{ active: activeTab === 'conversation' }" @click="activeTab = 'conversation'"><i class="bi bi-chat-square-text" aria-hidden="true"></i>{{ language === 'zh-CN' ? '对话' : 'Conversation' }}<span v-if="activeOpenCount" class="topic-tab-count">{{ activeOpenCount }}</span></button>
        <button id="topic-files-tab" type="button" role="tab" :aria-selected="activeTab === 'files'" aria-controls="topic-files-panel" :class="{ active: activeTab === 'files' }" @click="activeTab = 'files'"><i class="bi bi-file-diff" aria-hidden="true"></i>{{ language === 'zh-CN' ? '文件改动' : 'Files changed' }}<span class="topic-tab-count">{{ files.length }}</span></button>
      </div>
      <section v-show="activeTab === 'conversation'" id="topic-conversation-panel" class="topic-conversation" role="tabpanel" aria-labelledby="topic-conversation-tab">
        <section class="topic-overview">
          <h4>{{ language === 'zh-CN' ? '改动概要' : 'Summary' }}</h4>
          <div class="topic-summary" :class="{ 'is-collapsed': activeTopic.summary.length > 320 && !summaryExpanded }" v-html="renderTopicSummary(activeTopic.summary)"></div>
          <button v-if="activeTopic.summary.length > 320" type="button" class="topic-summary-toggle" :aria-expanded="summaryExpanded" @click="summaryExpanded = !summaryExpanded">{{ language === 'zh-CN' ? summaryExpanded ? '收起详细说明' : '展开详细说明' : summaryExpanded ? 'Show less' : 'Show full summary' }}</button>
          <div v-if="activeTopic.checks.length" class="topic-checks"><h4>{{ t('What to check') }}</h4><ul><li v-for="(check, index) in activeTopic.checks" :key="index" v-html="renderMarkdownInline(check)"></li></ul></div>
        </section>
        <div class="topic-conversation-heading"><div><h4>{{ language === 'zh-CN' ? '评审对话' : 'Review conversation' }}</h4><span>{{ conversationRuns.length }} {{ language === 'zh-CN' ? '轮 Ming AI 回复' : 'Ming AI responses' }} · {{ conversationComments.length }} {{ t('comments') }}</span></div><button v-if="currentComments.length > 0 && !stale && !isOutdated(activeId) && !demo && !conversationRuns.some(run => run.latest && run.recommendations.length)" type="button" class="button-outline topic-fix-copy" :title="t('Copy current comments')" @click="copyCurrentComments"><i :class="copyState === 'copied' ? 'bi bi-check2' : 'bi bi-clipboard'" aria-hidden="true"></i> {{ t(copyState === 'copied' ? 'Copied' : 'Copy') }}</button></div>
        <p v-if="copyState === 'failed'" class="topic-fix-copy-error" role="status">{{ t('Could not copy to clipboard') }}</p>
        <p v-if="!timelineNodes.length" class="topic-conversation-empty">{{ language === 'zh-CN' ? '还没有评审或文件改动记录。' : 'No review or file change history yet.' }}</p>
        <div v-else class="topic-timeline">
          <div v-for="node in timelineNodes" :key="activeId + ':' + node.id" class="topic-timeline-item" :class="'is-' + node.kind">
            <span class="topic-timeline-marker"><i :class="node.kind === 'change' ? 'bi bi-file-diff' : 'bi bi-robot'" aria-hidden="true"></i></span>
            <div class="topic-timeline-content">
              <section v-if="node.kind === 'change'" class="topic-change-event">
                <div><strong>{{ language === 'zh-CN' ? '检测到文件改动' : 'Files changed' }}</strong><time :datetime="new Date(node.event.updatedAt).toISOString()" :title="new Date(node.event.updatedAt).toLocaleString(language)">{{ relativeDate(node.event.updatedAt) }}</time><small>{{ node.paths.length }} {{ language === 'zh-CN' ? '个相关文件' : node.paths.length === 1 ? 'related file' : 'related files' }}<template v-if="node.event.changeCount > 1"> · {{ node.event.changeCount }} {{ language === 'zh-CN' ? '次改动已合并' : 'updates combined' }}</template></small></div>
                <button v-if="showChangeReviewAction(node.event) && !demo" type="button" class="button-outline" :disabled="reviewActionsBusy || requestReviewBusy" :aria-busy="requestReviewBusy" @click="emit('requestReview')"><i class="bi" :class="requestReviewBusy ? 'bi-arrow-repeat icon-spin' : 'bi-chat-left-text'" aria-hidden="true"></i> {{ requestReviewBusy ? language === 'zh-CN' ? '评审中…' : 'Reviewing…' : t('Request Review') }}</button>
              </section>
              <details v-else :key="activeId + ':' + node.run.id" class="topic-conversation-run" :open="node.run.latest || (!conversationRuns.some(item => item.latest) && node.run.id === conversationRuns.at(-1)?.id)">
          <summary><span class="diff-review-avatar"><i class="bi bi-robot" aria-hidden="true"></i></span><span class="topic-conversation-run-title"><strong v-if="node.run.createdAt"><template v-if="language === 'zh-CN'">Ming AI 于 <time :datetime="new Date(node.run.createdAt).toISOString()" :title="new Date(node.run.createdAt).toLocaleString(language)">{{ relativeDate(node.run.createdAt) }}</time> 完成评审</template><template v-else>Ming AI reviewed at <time :datetime="new Date(node.run.createdAt).toISOString()" :title="new Date(node.run.createdAt).toLocaleString(language)">{{ relativeDate(node.run.createdAt) }}</time></template></strong><strong v-else>{{ language === 'zh-CN' ? 'Ming AI 完成评审' : 'Ming AI reviewed' }}</strong></span><span v-if="node.run.latest" class="topic-run-current">{{ language === 'zh-CN' ? '当前' : 'Current' }}</span><span class="topic-run-count">{{ node.run.comments.length }} {{ language === 'zh-CN' ? '条新评论' : 'new' }} · {{ node.run.comments.length - resolvedRunCount(node.run.comments) }} {{ language === 'zh-CN' ? '未解决' : 'open' }} · {{ resolvedRunCount(node.run.comments) }} {{ language === 'zh-CN' ? '已解决' : 'resolved' }}<template v-if="node.run.latest && carriedOpenCount"> · {{ carriedOpenCount }} {{ language === 'zh-CN' ? '条历史问题仍未解决' : 'carried over' }}</template></span><i class="bi bi-chevron-down topic-run-chevron" aria-hidden="true"></i></summary>
          <div class="topic-conversation-run-body">
            <section v-if="node.run.recommendations.length" class="topic-recommendations" :class="{ 'is-passing': node.run.latest && activeOpenCount === 0 }"><div class="topic-recommendations-heading"><h4><i v-if="node.run.latest && activeOpenCount === 0" class="bi bi-check-circle-fill" aria-hidden="true"></i>{{ t('Review conclusion') }}<span v-if="node.run.latest && activeOpenCount === 0" class="topic-review-passed">{{ t('Passed') }}</span></h4><button v-if="node.run.latest && currentComments.length > 0 && !stale && !isOutdated(activeId) && !demo" type="button" class="button-outline topic-fix-copy" :title="t('Copy current comments')" @click="copyCurrentComments"><i :class="copyState === 'copied' ? 'bi bi-check2' : 'bi bi-clipboard'" aria-hidden="true"></i> {{ t(copyState === 'copied' ? 'Copied' : 'Copy') }}</button></div><ul><li v-for="(recommendation, recommendationIndex) in node.run.recommendations" :key="recommendationIndex"><span v-if="node.run.severities[recommendationIndex]" class="review-severity" :class="'is-' + node.run.severities[recommendationIndex]">{{ t(({ high: 'High', medium: 'Medium', low: 'Low' })[node.run.severities[recommendationIndex]!]) }}</span><span v-html="renderMarkdownInline(recommendation)"></span></li></ul></section>
            <div v-if="node.run.comments.length" class="topic-conversation-comments"><div v-for="comment in node.run.comments" :key="comment.id" class="topic-conversation-comment"><div v-if="!(record.aiReview && commentResolved(record.aiReview, comment.id))" class="topic-conversation-comment-location"><span><i class="bi bi-file-code" aria-hidden="true"></i>{{ conversationPath(comment) || (language === 'zh-CN' ? '原文件未知' : 'Original file unavailable') }}</span><button v-if="topicData" type="button" @click="showCommentInFiles(comment.id)">{{ language === 'zh-CN' ? '在文件中查看' : 'View in files' }} <i class="bi bi-arrow-right" aria-hidden="true"></i></button></div><ReviewCommentCard :comment="comment" :created-at="node.run.createdAt" :line-text="conversationLineText(comment)" :context-path="record.aiReview && commentResolved(record.aiReview, comment.id) ? (conversationPath(comment) || (language === 'zh-CN' ? '原文件未知' : 'Original file unavailable')) : undefined" :can-navigate="!!topicData && !!record.aiReview && commentResolved(record.aiReview, comment.id)" show-anchor :outdated="isOutdated(activeId) || earlierPlacement.outdated.some(item => item.comment.id === comment.id)" :resolved="record.aiReview && commentResolved(record.aiReview, comment.id)" :can-resolve="!demo" @navigate="showCommentInFiles(comment.id)" @mark-comment="(id, next) => emit('markComment', id, next)" /></div></div>
            <p v-else-if="!node.run.recommendations.length" class="topic-conversation-empty">{{ language === 'zh-CN' ? '这一轮没有文件评论。' : 'No file comments in this review.' }}</p>
          </div>
              </details>
            </div>
          </div>
        </div>
      </section>
      <section v-show="activeTab === 'files'" id="topic-files-panel" class="topic-files-panel" role="tabpanel" aria-labelledby="topic-files-tab">
        <div v-if="topicData" class="topic-diffs">
          <DiffFile v-for="entry in files" :key="record.id + ':' + activeTopic.id + ':' + entry.index" :comment-actions="!demo" :file="entry.file" :index="entry.index" :hunk-indices="entry.hunkIndices" :project="project" :record="record" :data="topicData" :settings="settings" :selected="false" :read-only="stale || isOutdated(activeId) || demo" :focused-comment-id="focusedCommentId" :comments="[...(record.aiReview?.comments?.filter(comment => comment.topicId === activeId && comment.fileIndex === entry.index) ?? []), ...earlierPlacement.inline.filter(comment => comment.fileIndex === entry.index)]" :outdated-comments="outdatedByPath.get(entry.file.path) ?? []" @mark-comment="(id, next) => emit('markComment', id, next)" />
          <section v-if="absentFileConversations.length" class="missing-file-conversations"><h4>{{ language === 'zh-CN' ? '旧文件中的过期对话' : 'Outdated conversations on earlier files' }}</h4><div v-for="conversation in absentFileConversations" :key="conversation.comment.id" class="missing-file-conversation"><strong>{{ conversation.path || (language === 'zh-CN' ? '原文件未知' : 'Original file unavailable') }}</strong><ReviewCommentCard :comment="conversation.comment" :created-at="conversation.createdAt" :line-text="conversation.lineText" show-anchor outdated :focused="focusedCommentId === conversation.comment.id" :resolved="record.aiReview && commentResolved(record.aiReview, conversation.comment.id)" :can-resolve="!demo" @mark-comment="(id, next) => emit('markComment', id, next)" /></div></section>
        </div>
        <p v-else class="topic-old-diff-unavailable">{{ t('The previous diff is unavailable. Regenerate topics to review the latest changes.') }}</p>
      </section>
    </section>
    <div v-if="activeTopic && showFloatingActions && !stale && !isOutdated(activeId) && !aiBusy" class="topic-floating-actions" :aria-label="`Review actions for ${activeTopic.title}`"><button type="button" class="button-outline" :aria-pressed="status(activeTopic) === 'needs-work'" @click="markTopic(activeTopic, 'needs-work')">{{ t(status(activeTopic) === 'needs-work' ? 'Clear flag' : 'Needs another look') }}</button><button type="button" class="button-primary" :aria-pressed="status(activeTopic) === 'reviewed'" @click="markTopic(activeTopic, 'reviewed')">{{ t(status(activeTopic) === 'reviewed' ? 'Mark as unread' : 'Mark reviewed') }}</button></div>
  </div>
</template>

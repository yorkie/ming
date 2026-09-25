<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue';
import type { Project, ReviewRecord } from '../lib/projectStore';
import type { CommitHistory, CommitSummary } from '../lib/localRepository';
import type { GlobalSettings } from '../lib/globalSettings';
import { buildFileTree, filterFileTree } from '../lib/reviewTree';
import type { Review } from '../lib/reviewTypes';
import DiffFile from './DiffFile.vue';
import ReviewTreeNode from './ReviewTreeNode.vue';
import TopicReviewView from './TopicReviewView.vue';
import { language, t } from '../lib/i18n';
import { liveReviewStatuses } from '../lib/liveReviews';

const props = defineProps<{
  project: Project;
  reviews: ReviewRecord[];
  record: ReviewRecord | null;
  data: Review | null;
  reviewView: 'topics' | 'changes' | 'commits';
  settings: GlobalSettings;
  scanBusy: boolean;
  scanProgress: string;
  aiBusy: boolean;
  aiProgress: string;
  aiCompleted: number;
  aiTotal: number;
  aiConfigured: boolean;
  commitHistory: CommitHistory | null;
  commitsBusy: boolean;
  commitsError: string;
  message?: string;
  messageError?: boolean;
}>();
const emit = defineEmits<{ selectReview: [id: string]; selectTab: [tab: 'topics' | 'changes' | 'commits']; scan: []; cancelScan: []; deleteReview: []; generateAiReview: []; cancelAiReview: []; markTopic: [id: string, status: 'reviewed' | 'needs-work' | null]; retryCommits: []; dismissMessage: [] }>();
const query = ref('');
const collapsed = ref(new Set<string>());
const selectedFileIndex = ref<number | null>(null);
const tree = ref<HTMLElement | null>(null);
const now = ref(Date.now());
const clock = typeof window !== 'undefined' ? setInterval(() => { now.value = Date.now(); }, 60_000) : null;
onUnmounted(() => { if (clock) clearInterval(clock); });
const nodes = computed(() => props.data ? filterFileTree(buildFileTree(props.data.files.map(file => file.path)), query.value) : []);
const treeCount = computed(() => query.value.trim() ? `${nodes.value.reduce((count, node) => count + node.count, 0)} of ${fileCountLabel(props.data?.files.length ?? 0)}` : fileCountLabel(props.data?.files.length ?? 0));
function fileCountLabel(count: number) { return language.value === 'zh-CN' ? `${count} 个文件` : `${count} ${count === 1 ? 'file' : 'files'}`; }
function date(value: number) { return new Intl.DateTimeFormat(language.value, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value); }
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
function longDate(value: number) { return new Intl.DateTimeFormat(language.value, { dateStyle: 'medium', timeStyle: 'short' }).format(value * 1000); }
function recordFileCount(record: ReviewRecord) { if (record.fileCount !== undefined) return record.fileCount; try { return (JSON.parse(record.data) as Review).files.length; } catch { return 0; } }
function toggleDirectory(path: string) { if (collapsed.value.has(path)) collapsed.value.delete(path); else collapsed.value.add(path); }
async function selectFile(index: number) {
  selectedFileIndex.value = index;
  await nextTick();
  document.querySelector<HTMLElement>(`[data-file-section="${index}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function changeQuery(value: string) { query.value = value; collapsed.value.clear(); if (tree.value) tree.value.scrollTop = 0; }
function commitList(commits: CommitSummary[]) { return commits; }
</script>

<template>
  <div class="reviews-layout" :class="{ 'review-view-commits': reviewView !== 'changes' }"><aside class="review-history"><div class="review-history-title"><span class="section-index">01 / REVIEWS</span><h2>{{ t('Reviews') }}</h2></div><div class="minor-heading">{{ t('Review pairs') }} <span>{{ reviews.length }}</span></div><button v-for="item in reviews" :key="item.id" type="button" class="history-row" :class="{ active: item.id === record?.id }" @click="emit('selectReview', item.id)"><span :title="date(item.createdAt)">{{ relativeDate(item.createdAt) }}</span><strong>{{ fileCountLabel(recordFileCount(item)) }}</strong><small>{{ item.branch ?? 'detached' }} <i class="bi bi-arrow-right" aria-hidden="true"></i> {{ item.baseRef }}</small></button></aside>
    <div class="review-main"><div v-if="project.settings.liveReview && liveReviewStatuses.get(project.id)" class="inline-message review-notice" role="status"><strong>{{ t('Live review status') }}</strong><span>{{ t(liveReviewStatuses.get(project.id)!) }}</span></div><div v-if="message" class="inline-message review-notice" :class="{ error: messageError }" role="status"><strong>{{ t(messageError ? 'Error' : 'Status') }}</strong><span>{{ message }}</span><button aria-label="Dismiss message" @click="emit('dismissMessage')"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div><div v-if="!record || !data || scanBusy" class="review-main-toolbar"><p>{{ t('Scan the working tree to create or update a branch review.') }}</p><button class="button-primary" :disabled="aiBusy" @click="scanBusy ? emit('cancelScan') : emit('scan')"><i :class="scanBusy ? 'bi bi-x-lg' : 'bi bi-arrow-clockwise'" aria-hidden="true"></i> {{ t(scanBusy ? 'Cancel scan' : 'Scan changes') }}</button></div>

      <div v-if="aiBusy" class="scan-progress ai-review-progress" role="status"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i><div><strong>{{ t('Generating AI topics') }}</strong><p>{{ aiProgress }}</p><progress v-if="aiTotal" :value="aiCompleted" :max="aiTotal" :aria-label="`AI topic groups: ${aiCompleted} of ${aiTotal} complete`"></progress></div><button type="button" class="button-outline" @click="emit('cancelAiReview')">{{ t('Cancel') }}</button></div>
      <div v-else-if="scanBusy" class="scan-progress" role="status"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i><div><strong>{{ t('Scanning working tree') }}</strong><p>{{ scanProgress || 'Preparing…' }}</p></div></div>
      <div v-else-if="reviews.length" class="review-body"><template v-if="record && data"><div class="review-summary"><div><span class="minor-heading" :title="date(record.createdAt)">{{ relativeDate(record.createdAt) }} · {{ record.branch ?? 'detached' }}</span><h3>{{ t('Working tree changes') }}</h3></div><div class="review-summary-actions"><div class="counts"><span>{{ fileCountLabel(data.files.length) }}</span><b class="add">+{{ data.additions }}</b><b class="remove">−{{ data.deletions }}</b></div><div class="review-toolbar-actions"><button v-if="record.aiReview" type="button" class="button-outline" :disabled="!aiConfigured || aiBusy || scanBusy" :title="t('Replace topics and reset their review status')" @click="emit('generateAiReview')"><i class="bi bi-stars" aria-hidden="true"></i> {{ t('Regenerate topics') }}</button><button type="button" class="button-outline review-delete" :disabled="scanBusy || aiBusy" @click="emit('deleteReview')"><i class="bi bi-trash" aria-hidden="true"></i> {{ t('Delete review') }}</button><button class="button-primary" :disabled="aiBusy" @click="scanBusy ? emit('cancelScan') : emit('scan')"><i :class="scanBusy ? 'bi bi-x-lg' : 'bi bi-arrow-clockwise'" aria-hidden="true"></i> {{ t(scanBusy ? 'Cancel scan' : 'Scan changes') }}</button></div></div></div>
          <nav class="review-tabs" :aria-label="t('Review content')"><button type="button" :class="{ active: reviewView === 'topics' }" @click="emit('selectTab', 'topics')">{{ t('Topics') }} <span v-if="record.aiReview">{{ record.aiReview.artifact.topics.length }}</span></button><button type="button" :class="{ active: reviewView === 'changes' }" @click="emit('selectTab', 'changes')">{{ t('Changes') }} <span>{{ data.files.length }}</span></button><button type="button" :class="{ active: reviewView === 'commits' }" @click="emit('selectTab', 'commits')">{{ t('Commits') }}</button></nav>
          <div v-if="reviewView === 'topics'"><TopicReviewView v-if="record.aiReview" :project="project" :record="record" :data="data" :settings="settings" @mark-topic="(id, status) => emit('markTopic', id, status)" /><div v-else class="topic-empty"><h3>{{ t('Review changes by topic') }}</h3><p>{{ t(project.settings.liveReview && project.settings.liveTopics ? 'Live updates generate topics in the background when the diff changes. You can also start generation here.' : 'AI will organize this saved diff into reviewable topics. The changed code is sent to DeepSeek only when you start this task.') }}</p><p v-if="!aiConfigured">{{ t('Add a DeepSeek API key in Copilot settings to generate topics.') }}</p><button type="button" class="button-primary" :disabled="!aiConfigured || aiBusy" @click="emit('generateAiReview')">{{ t('Generate AI topics') }}</button></div></div>
          <div v-show="reviewView === 'changes'"><div v-if="data.files.length" class="review-content-layout"><div class="review-files"><DiffFile v-for="(file, index) in data.files" :key="`${record.id}:${index}`" :file="file" :index="index" :project="project" :record="record" :data="data" :settings="settings" :selected="selectedFileIndex === index" /></div><aside class="review-sidebar"><section class="directory-panel" aria-label="Changed files"><div class="directory-heading"><strong>{{ t('Changed files') }}</strong><span class="directory-filter-count">{{ treeCount }}</span></div><label class="directory-search"><i class="bi bi-search" aria-hidden="true"></i><input type="search" :aria-label="t('Search changed files')" :placeholder="t('Filter files…')" :value="query" autocomplete="off" @input="changeQuery(($event.target as HTMLInputElement).value)"></label><div ref="tree" class="directory-tree" role="tree"><ReviewTreeNode v-for="node in nodes" :key="node.path" :node="node" :files="data.files" :depth="0" :collapsed="collapsed" :selected-index="selectedFileIndex" @toggle="toggleDirectory" @select="selectFile" /><div v-if="!nodes.length" class="directory-no-results">{{ t('No matching files') }}</div></div></section></aside></div><div v-else class="empty-state compact"><h3>{{ t('No changed files') }}</h3></div></div>
          <div v-if="reviewView === 'commits'"><div v-if="commitsBusy" class="scan-progress"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i><div><strong>{{ t('Loading commit history') }}</strong></div></div><div v-else-if="commitsError" class="inline-message error" role="status"><strong>{{ t('Could not load commits') }}</strong><span>{{ commitsError }}</span><button class="button-outline" @click="emit('retryCommits')">{{ t('Retry') }}</button></div><section v-else-if="commitHistory" class="commit-panel review-commit-list"><div class="commit-panel-heading"><div><h3>{{ t('Commits compared with remote') }}</h3><p>{{ record.branch ?? 'HEAD' }} ↔ {{ commitHistory.remoteRef ?? t('No remote tracking branch') }} · {{ t('Using local remote refs') }}</p></div></div><template v-if="commitHistory.remoteRef"><div class="commit-group-heading">{{ t('Ahead locally') }} · {{ commitHistory.localOnly.length }}</div><div v-if="commitHistory.localOnly.length" class="commit-list"><div v-for="commit in commitList(commitHistory.localOnly)" :key="commit.oid" class="commit-row"><div class="commit-main"><strong>{{ commit.title }}</strong><span>{{ commit.author }} · {{ longDate(commit.timestamp) }}</span></div><code :title="commit.oid">{{ commit.oid.slice(0, 7) }}</code></div></div><p v-else class="commit-empty">{{ t('No local commits ahead.') }}</p><div class="commit-group-heading">{{ t('Ahead remotely') }} · {{ commitHistory.remoteOnly.length }}</div><div v-if="commitHistory.remoteOnly.length" class="commit-list"><div v-for="commit in commitList(commitHistory.remoteOnly)" :key="commit.oid" class="commit-row"><div class="commit-main"><strong>{{ commit.title }}</strong><span>{{ commit.author }} · {{ longDate(commit.timestamp) }}</span></div><code :title="commit.oid">{{ commit.oid.slice(0, 7) }}</code></div></div><p v-else class="commit-empty">{{ t('No remote commits ahead.') }}</p></template><p v-else class="commit-empty">{{ t('No remote tracking ref is available for this branch. Configure an upstream and update your remote refs with Git.') }}</p></section></div>
        </template><div v-else class="list-empty">{{ t('Select a review to see its changes and commits.') }}</div></div>
      <div v-else class="empty-state"><span class="empty-num">01</span><h3>{{ t('No reviews yet') }}</h3><p>{{ t('Compare the working tree with the configured Git ref to create a review.') }}</p><button class="button-outline" @click="emit('scan')"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> {{ t('Scan working tree') }}</button></div>
    </div>
  </div>
</template>

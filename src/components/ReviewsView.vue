<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { Project, ReviewRecord } from '../lib/projectStore';
import type { CommitHistory, CommitSummary } from '../lib/localRepository';
import type { GlobalSettings } from '../lib/globalSettings';
import { buildFileTree, filterFileTree } from '../lib/reviewTree';
import type { Review } from '../lib/reviewTypes';
import DiffFile from './DiffFile.vue';
import ReviewTreeNode from './ReviewTreeNode.vue';

const props = defineProps<{
  project: Project;
  reviews: ReviewRecord[];
  record: ReviewRecord | null;
  data: Review | null;
  reviewView: 'changes' | 'commits';
  settings: GlobalSettings;
  scanBusy: boolean;
  scanProgress: string;
  commitHistory: CommitHistory | null;
  commitsBusy: boolean;
  commitsError: string;
}>();
const emit = defineEmits<{ selectReview: [id: string]; selectTab: [tab: 'changes' | 'commits']; scan: []; cancelScan: []; retryCommits: [] }>();
const query = ref('');
const collapsed = ref(new Set<string>());
const selectedFileIndex = ref<number | null>(null);
const tree = ref<HTMLElement | null>(null);
const nodes = computed(() => props.data ? filterFileTree(buildFileTree(props.data.files.map(file => file.path)), query.value) : []);
const treeCount = computed(() => query.value.trim() ? `${nodes.value.reduce((count, node) => count + node.count, 0)} of ${fileCountLabel(props.data?.files.length ?? 0)}` : fileCountLabel(props.data?.files.length ?? 0));
function fileCountLabel(count: number) { return `${count} ${count === 1 ? 'file' : 'files'}`; }
function date(value: number) { return new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value); }
function longDate(value: number) { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value * 1000); }
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
  <div class="reviews-layout" :class="{ 'review-view-commits': reviewView === 'commits' }"><aside class="review-history"><div class="review-history-title"><span class="section-index">01 / REVIEWS</span><h2>Reviews</h2></div><div class="minor-heading">Records <span>{{ reviews.length }}</span></div><button v-for="item in reviews" :key="item.id" type="button" class="history-row" :class="{ active: item.id === record?.id }" @click="emit('selectReview', item.id)"><span>{{ date(item.createdAt) }}</span><strong>{{ fileCountLabel(recordFileCount(item)) }}</strong><small>{{ item.branch ?? 'detached' }} <i class="bi bi-arrow-right" aria-hidden="true"></i> {{ item.baseRef }}</small></button></aside>
    <div class="review-main"><div class="review-main-toolbar"><p>{{ reviewView === 'changes' ? 'Browse every file diff. Use the file tree to jump to a file.' : 'View commits ahead of or behind the remote tracking branch.' }}</p><button class="button-primary" @click="scanBusy ? emit('cancelScan') : emit('scan')"><i :class="scanBusy ? 'bi bi-x-lg' : 'bi bi-arrow-clockwise'" aria-hidden="true"></i> {{ scanBusy ? 'Cancel scan' : 'Scan changes' }}</button></div>
      <div v-if="scanBusy" class="scan-progress" role="status"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i><div><strong>Scanning working tree</strong><p>{{ scanProgress || 'Preparing…' }}</p></div></div>
      <div v-else-if="reviews.length" class="review-body"><template v-if="record && data"><div class="review-summary"><div><span class="minor-heading">{{ date(record.createdAt) }} · {{ record.branch ?? 'detached' }}</span><h3>Working tree changes</h3></div><div class="counts"><span>{{ fileCountLabel(data.files.length) }}</span><b class="add">+{{ data.additions }}</b><b class="remove">−{{ data.deletions }}</b></div></div>
          <nav class="review-tabs" aria-label="Review content"><button type="button" :class="{ active: reviewView === 'changes' }" @click="emit('selectTab', 'changes')">Changes <span>{{ data.files.length }}</span></button><button type="button" :class="{ active: reviewView === 'commits' }" @click="emit('selectTab', 'commits')">Commits</button></nav>
          <div v-show="reviewView === 'changes'"><div v-if="data.files.length" class="review-content-layout"><div class="review-files"><DiffFile v-for="(file, index) in data.files" :key="`${record.id}:${index}`" :file="file" :index="index" :project="project" :record="record" :data="data" :settings="settings" :selected="selectedFileIndex === index" /></div><aside class="review-sidebar"><section class="directory-panel" aria-label="Changed files"><div class="directory-heading"><strong>Changed files</strong><span class="directory-filter-count">{{ treeCount }}</span></div><label class="directory-search"><i class="bi bi-search" aria-hidden="true"></i><input type="search" aria-label="Search changed files" placeholder="Filter files…" :value="query" autocomplete="off" @input="changeQuery(($event.target as HTMLInputElement).value)"></label><div ref="tree" class="directory-tree" role="tree"><ReviewTreeNode v-for="node in nodes" :key="node.path" :node="node" :files="data.files" :depth="0" :collapsed="collapsed" :selected-index="selectedFileIndex" @toggle="toggleDirectory" @select="selectFile" /><div v-if="!nodes.length" class="directory-no-results">No matching files</div></div></section></aside></div><div v-else class="empty-state compact"><h3>No changed files</h3></div></div>
          <div v-if="reviewView === 'commits'"><div v-if="commitsBusy" class="scan-progress"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i><div><strong>Loading commit history</strong></div></div><div v-else-if="commitsError" class="inline-message error" role="status"><strong>Could not load commits</strong><span>{{ commitsError }}</span><button class="button-outline" @click="emit('retryCommits')">Retry</button></div><section v-else-if="commitHistory" class="commit-panel review-commit-list"><div class="commit-panel-heading"><div><h3>Commits compared with remote</h3><p>{{ record.branch ?? 'HEAD' }} ↔ {{ commitHistory.remoteRef ?? 'No remote tracking branch' }} · Using local remote refs</p></div></div><template v-if="commitHistory.remoteRef"><div class="commit-group-heading">Ahead locally · {{ commitHistory.localOnly.length }}</div><div v-if="commitHistory.localOnly.length" class="commit-list"><div v-for="commit in commitList(commitHistory.localOnly)" :key="commit.oid" class="commit-row"><div class="commit-main"><strong>{{ commit.title }}</strong><span>{{ commit.author }} · {{ longDate(commit.timestamp) }}</span></div><code :title="commit.oid">{{ commit.oid.slice(0, 7) }}</code></div></div><p v-else class="commit-empty">No local commits ahead.</p><div class="commit-group-heading">Ahead remotely · {{ commitHistory.remoteOnly.length }}</div><div v-if="commitHistory.remoteOnly.length" class="commit-list"><div v-for="commit in commitList(commitHistory.remoteOnly)" :key="commit.oid" class="commit-row"><div class="commit-main"><strong>{{ commit.title }}</strong><span>{{ commit.author }} · {{ longDate(commit.timestamp) }}</span></div><code :title="commit.oid">{{ commit.oid.slice(0, 7) }}</code></div></div><p v-else class="commit-empty">No remote commits ahead.</p></template><p v-else class="commit-empty">No remote tracking ref is available for this branch. Configure an upstream and update your remote refs with Git.</p></section></div>
        </template><div v-else class="list-empty">Select a review to see its changes and commits.</div></div>
      <div v-else class="empty-state"><span class="empty-num">01</span><h3>No reviews yet</h3><p>Compare the working tree with the configured Git ref to create a review.</p><button class="button-outline" @click="emit('scan')"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Scan working tree</button></div>
    </div>
  </div>
</template>

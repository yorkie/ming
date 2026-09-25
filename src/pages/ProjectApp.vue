<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { inspectRepository, type CommitHistory, type RepositoryInfo } from '../lib/localRepository';
import { deleteProject, deleteReview, listProjects, listReviews, recordAiUsage, rememberProject, saveAiReviewIfCurrent, saveReviewSnapshot, topicsAreStale, type Project, type ReviewRecord } from '../lib/projectStore';
import { generateReviewTitleInBackground } from '../lib/reviewTitles';
import { parseRoute, resolveId, routeUrl, shortId, type Route } from '../lib/routes';
import { readProjectPath, type ProjectPath } from '../lib/projectFiles';
import { loadGlobalSettings } from '../lib/globalSettings';
import AppShell from '../components/AppShell.vue';
import { addLocalProject } from '../lib/addProject';
import type { Review } from '../lib/reviewTypes';
import type { AiRequestUsage, TopicArtifact } from '../lib/aiReviewTypes';
import { language, t } from '../lib/i18n';
import { localizeAiProgress } from '../lib/aiProgress';
import { pauseLiveReview } from '../lib/liveReviews';

type View = 'files' | 'reviews' | 'branches' | 'settings';
type ReviewView = 'topics' | 'changes' | 'commits';
const FilesView = defineAsyncComponent(() => import('../components/FilesView.vue'));
const ReviewsView = defineAsyncComponent(() => import('../components/ReviewsView.vue'));
const BranchesView = defineAsyncComponent(() => import('../components/BranchesView.vue'));
const ProjectSettingsView = defineAsyncComponent(() => import('../components/ProjectSettingsView.vue'));
const router = useRouter();
const currentRoute = useRoute();
const projects = shallowRef<Project[]>([]);
const activeId = ref<string | null>(null);
const project = computed(() => projects.value.find(item => item.id === activeId.value) ?? null);
const reviews = shallowRef<ReviewRecord[]>([]);
const activeReviewId = ref<string | null>(null);
const record = computed(() => reviews.value.find(item => item.id === activeReviewId.value) ?? null);
const reviewData = shallowRef<Review | null>(null);
const view = ref<View>('files');
const reviewView = ref<ReviewView>('changes');
const settings = loadGlobalSettings();
const gitInfo = shallowRef<RepositoryInfo | null>(null);
const fileView = shallowRef<{ projectId: string; path: string; data: ProjectPath } | null>(null);
const filePath = ref('');
const filesBusy = ref(false);
const filesError = ref('');
const permissionRequired = ref(false);
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
const scanBusy = ref(false);
const scanProgress = ref('');
const aiBusy = ref(false);
const aiProgress = ref('');
const displayedAiProgress = computed(() => localizeAiProgress(aiProgress.value, language.value));
const aiCompleted = ref(0);
const aiTotal = ref(0);
const commitHistory = shallowRef<CommitHistory | null>(null);
const commitsBusy = ref(false);
const commitsError = ref('');
let routeGeneration = 0;
let requestAccessOnNextRoute = false;
let cancelCommitLoad: (() => void) | null = null;
let cancelActiveScan: (() => void) | null = null;
let cancelAiReview: (() => void) | null = null;

function note(value: string, error = false) { message.value = t(value); messageError.value = error; }
function compactRoute(route: Route): Route {
  if (route.kind === 'home' || route.kind === 'global-settings') return route;
  const projectId = shortId(route.projectId, projects.value.map(item => item.id));
  if (route.kind === 'project') return { ...route, projectId };
  return { ...route, projectId, reviewId: shortId(route.reviewId, reviews.value.filter(item => item.projectId === route.projectId).map(item => item.id)) };
}
function navigate(route: Route) {
  const url = routeUrl(compactRoute(route));
  if (route.kind === 'home' || route.kind === 'global-settings') { void router.push(url); return; }
  if (currentRoute.fullPath === url) { void applyRoute(true); return; }
  requestAccessOnNextRoute = true;
  void router.push(url);
}
async function ensurePermission(directory: FileSystemDirectoryHandle) {
  const options = { mode: 'read' as const };
  if (await directory.queryPermission(options) === 'granted') return true;
  return await directory.requestPermission(options) === 'granted';
}
async function applyRoute(requestAccess = false) {
  const generation = ++routeGeneration;
  cancelActiveScan?.();
  cancelAiReview?.();
  cancelCommitLoad?.();
  commitsBusy.value = false;
  const route = parseRoute(currentRoute.fullPath);
  if (route?.kind === 'home' || route?.kind === 'global-settings') { void router.replace(routeUrl(route)); return; }
  if (!route) { note('Unrecognized page URL.', true); ready.value = true; return; }
  const id = resolveId(route.projectId, projects.value.map(item => item.id));
  const selected = projects.value.find(item => item.id === id);
  if (!selected) {
    activeId.value = null; activeReviewId.value = null; reviewData.value = null; gitInfo.value = null; reviews.value = [];
    note('Project not found. Select it again from the projects page.', true); ready.value = true;
    return;
  }
  const projectChanged = activeId.value !== selected.id;
  activeId.value = selected.id;
  view.value = route.kind === 'review' ? 'reviews' : route.page;
  message.value = ''; messageError.value = false;
  if (projectChanged) {
    gitInfo.value = null; reviews.value = []; commitHistory.value = null; commitsError.value = ''; fileView.value = null;
  }
  try {
    const permission = await selected.directory.queryPermission({ mode: 'read' });
    if (generation !== routeGeneration) return;
    if (permission !== 'granted' && (!requestAccess || !await ensurePermission(selected.directory))) { permissionRequired.value = true; ready.value = true; return; }
    if (generation !== routeGeneration) return;
    permissionRequired.value = false;
    if (projectChanged || !gitInfo.value) {
      const [info, savedReviews] = await Promise.all([inspectRepository(selected.directory), listReviews(selected.id)]);
      if (generation !== routeGeneration) return;
      gitInfo.value = info; reviews.value = savedReviews;
    }
    filePath.value = route.kind === 'project' && route.page === 'files' ? route.path ?? '' : '';
    const nextReviewId = route.kind === 'review' ? resolveId(route.reviewId, reviews.value.map(item => item.id)) : null;
    if (route.kind === 'review' && !nextReviewId) {
      activeReviewId.value = null; reviewData.value = null; view.value = 'reviews';
      void router.replace(routeUrl(compactRoute({ kind: 'project', projectId: selected.id, page: 'reviews' })));
      return;
    } else {
      activeReviewId.value = nextReviewId;
      const nextRecord = reviews.value.find(item => item.id === nextReviewId);
      if (nextRecord) {
        try { reviewData.value = JSON.parse(nextRecord.data) as Review; }
        catch { reviewData.value = null; }
      } else reviewData.value = null;
    }
    reviewView.value = route.kind === 'review' ? route.page : 'topics';
    if (route.kind !== 'review' || nextReviewId) {
      const canonical = route.kind === 'review' ? compactRoute({ ...route, projectId: selected.id, reviewId: nextReviewId! }) : compactRoute({ ...route, projectId: selected.id });
      if (currentRoute.fullPath !== routeUrl(canonical)) {
        void router.replace(routeUrl(canonical));
        return;
      }
    }
    if (route.kind !== 'review' || route.page !== 'commits') { commitHistory.value = null; commitsError.value = ''; }
    const loadFiles = view.value === 'files' && (fileView.value?.projectId !== selected.id || fileView.value.path !== filePath.value);
    if (loadFiles) { filesBusy.value = true; filesError.value = ''; }
    ready.value = true;
    if (route.kind === 'review' && route.page === 'commits' && !commitHistory.value) loadCommits();
    if (loadFiles) {
      try {
        const data = await readProjectPath(selected.directory, filePath.value, settings.filePreviewLimitKb * 1000);
        if (generation !== routeGeneration) return;
        fileView.value = { projectId: selected.id, path: filePath.value, data };
      } catch (error) {
        if (generation !== routeGeneration) return;
        filesError.value = error instanceof Error ? error.message : String(error);
      } finally { if (generation === routeGeneration) filesBusy.value = false; }
    }
  } catch (error) { if (generation === routeGeneration) { note(error instanceof Error ? error.message : String(error), true); ready.value = true; } }
}
function loadCommits() {
  const selected = project.value;
  const selectedRecord = record.value;
  if (!selected || !selectedRecord) return;
  cancelCommitLoad?.();
  const worker = new Worker(new URL('../workers/commitsWorker.ts', import.meta.url), { type: 'module' });
  cancelCommitLoad = () => { worker.terminate(); cancelCommitLoad = null; };
  commitsBusy.value = true; commitsError.value = '';
  const finish = () => { worker.terminate(); cancelCommitLoad = null; commitsBusy.value = false; };
  worker.onmessage = (event: MessageEvent<{ type: 'done'; history: CommitHistory } | { type: 'error'; message: string }>) => {
    if (activeId.value !== selected.id || activeReviewId.value !== selectedRecord.id) return;
    finish();
    if (event.data.type === 'done') commitHistory.value = event.data.history;
    else commitsError.value = event.data.message;
  };
  worker.onerror = event => { if (activeId.value !== selected.id || activeReviewId.value !== selectedRecord.id) return; finish(); commitsError.value = event.message || 'Could not read commit history'; };
  worker.postMessage({ directory: selected.directory, localRef: selectedRecord.headOid || 'HEAD', branch: selectedRecord.branch });
}
type WorkerMessage = { type: 'progress'; message: string } | { type: 'done'; data: string | null; snapshotHash?: string; gitInfo: RepositoryInfo; baseRef: string } | { type: 'error'; message: string };
function scanInWorker(directory: FileSystemDirectoryHandle, baseRef: string): Promise<Extract<WorkerMessage, { type: 'done' }>> {
  const worker = new Worker(new URL('../workers/scanWorker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => { if (finished) return false; finished = true; worker.terminate(); cancelActiveScan = null; return true; };
    cancelActiveScan = () => { if (finish()) reject(new DOMException('Scan canceled', 'AbortError')); };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const response = event.data;
      if (response.type === 'progress') scanProgress.value = response.message;
      else if (response.type === 'done') { if (finish()) resolve(response); }
      else if (finish()) reject(new Error(response.message));
    };
    worker.onerror = event => { if (finish()) reject(new Error(event.message || 'Scan worker stopped unexpectedly')); };
    worker.postMessage({ directory, baseRef, uiLanguage: language.value });
  });
}
async function scanProject() {
  const selected = project.value;
  if (!selected || scanBusy.value || aiBusy.value) return;
  const resumeLiveReview = await pauseLiveReview(selected.id);
  cancelCommitLoad?.(); commitsBusy.value = false;
  scanBusy.value = true; scanProgress.value = t('Preparing scan…'); message.value = ''; messageError.value = false;
  try {
    const result = await scanInWorker(selected.directory, selected.settings.baseRef);
    gitInfo.value = result.gitInfo;
    if (!result.data) {
      await clearComparedReview(selected.id, result.gitInfo.currentBranch, result.baseRef);
      return note('No changes between the working tree and comparison ref.');
    }
    const data = JSON.parse(result.data) as Review;
    if (!data.files.length) {
      await clearComparedReview(selected.id, result.gitInfo.currentBranch, result.baseRef);
      return note('No reviewable changes between the working tree and comparison ref.');
    }
    const saved = await saveReviewSnapshot({ id: crypto.randomUUID(), projectId: selected.id, createdAt: Date.now(), branch: result.gitInfo.currentBranch, baseRef: result.baseRef, headOid: result.gitInfo.headOid, fileCount: data.files.length, data: result.data, snapshotHash: result.snapshotHash });
    reviews.value = await listReviews(selected.id);
    generateReviewTitleInBackground(selected, saved);
    reviewData.value = data;
    activeReviewId.value = saved.id;
    commitHistory.value = null; commitsError.value = '';
    navigate({ kind: 'review', projectId: selected.id, reviewId: saved.id, page: settings.defaultReviewTab });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') note('Scan canceled.');
    else note(`Scan failed: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally { scanBusy.value = false; resumeLiveReview(); }
}
async function clearComparedReview(projectId: string, branch: string | null, baseRef: string) {
  const matching = reviews.value.find(item => item.branch === branch && item.baseRef === baseRef);
  if (!matching) return;
  await deleteReview(matching.id);
  reviews.value = reviews.value.filter(item => item.id !== matching.id);
  if (activeReviewId.value !== matching.id) return;
  activeReviewId.value = null;
  reviewData.value = null;
  commitHistory.value = null;
  commitsError.value = '';
  await router.push(routeUrl(compactRoute({ kind: 'project', projectId, page: 'reviews' })));
}
async function deleteSelectedReview() {
  const selected = record.value;
  const currentProject = project.value;
  if (!selected || !currentProject || scanBusy.value || aiBusy.value) return;
  if (!window.confirm(t('Delete this branch review and its topic status from this browser?'))) return;
  try {
    await deleteReview(selected.id);
    reviews.value = reviews.value.filter(item => item.id !== selected.id);
    navigate({ kind: 'project', projectId: currentProject.id, page: 'reviews' });
  } catch (error) { note(`Could not delete review: ${error instanceof Error ? error.message : String(error)}`, true); }
}
async function addProject() {
  try { const selected = await addLocalProject(projects.value); if (!projects.value.some(item => item.id === selected.id)) projects.value = [...projects.value, selected]; navigate({ kind: 'project', projectId: selected.id, page: 'files' }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; note(error instanceof Error ? error.message : String(error), true); }
}
async function saveProjectSettings(name: string, baseRef: string, liveReview: boolean) {
  const selected = project.value;
  if (!selected) return;
  if (!name) return note('Project name cannot be empty.', true);
  selected.name = name; selected.settings = { baseRef, liveReview };
  try { await rememberProject(selected); projects.value = [...projects.value]; window.dispatchEvent(new Event('ming:settings-changed')); note('Project settings saved in this browser.'); }
  catch (error) { note(error instanceof Error ? error.message : String(error), true); }
}
async function removeProject() {
  const selected = project.value;
  if (!selected) return;
  try { await deleteProject(selected.id); window.dispatchEvent(new Event('ming:settings-changed')); void router.push(routeUrl({ kind: 'home' })); }
  catch (error) { note(error instanceof Error ? error.message : String(error), true); }
}
function selectProject(id: string | null) { navigate(id ? { kind: 'project', projectId: id, page: 'files' } : { kind: 'home' }); }
function selectPage(page: View) { if (activeId.value) navigate({ kind: 'project', projectId: activeId.value, page }); }
function selectFilePath(path: string) { if (activeId.value) { navigate({ kind: 'project', projectId: activeId.value, page: 'files', ...(path ? { path } : {}) }); window.scrollTo(0, 0); } }
function refreshFiles() { fileView.value = null; gitInfo.value = null; selectFilePath(filePath.value); }
function selectReview(id: string) { if (activeId.value) navigate({ kind: 'review', projectId: activeId.value, reviewId: id, page: 'topics' }); }
function selectReviewTab(tab: ReviewView) { if (activeId.value && activeReviewId.value) navigate({ kind: 'review', projectId: activeId.value, reviewId: activeReviewId.value, page: tab }); }
function cancelScan() { cancelActiveScan?.(); }
function cancelAi() { cancelAiReview?.(); }
async function generateAiReview() {
  const selected = record.value;
  if (!selected || aiBusy.value || scanBusy.value) return;
  const copilot = loadGlobalSettings();
  const key = copilot.copilotDeepSeekApiKey.trim();
  const model = copilot.copilotModel;
  if (!key) { note('Add a DeepSeek API key in Copilot settings first.', true); return; }
  reviewView.value = 'topics';
  aiBusy.value = true; aiProgress.value = t('Preparing topic review…'); aiCompleted.value = 0; aiTotal.value = 0; message.value = '';
  const resumeLiveReview = await pauseLiveReview(selected.projectId);
  const worker = new Worker(new URL('../workers/aiTaskWorker.ts', import.meta.url), { type: 'module' });
  const usageWrites: Promise<void>[] = [];
  let usageSaveFailed = false;
  try {
    const artifact = await new Promise<TopicArtifact>((resolve, reject) => {
      cancelAiReview = () => { worker.terminate(); cancelAiReview = null; reject(new DOMException('AI review canceled', 'AbortError')); };
      worker.onmessage = (event: MessageEvent<{ type: 'progress'; message: string; completed: number; total: number } | { type: 'usage'; usage: AiRequestUsage } | { type: 'done'; artifact: TopicArtifact } | { type: 'error'; message: string }>) => {
        if (event.data.type === 'progress') { aiProgress.value = event.data.message; aiCompleted.value = event.data.completed; aiTotal.value = event.data.total; }
        else if (event.data.type === 'usage') {
          usageWrites.push(recordAiUsage({ ...event.data.usage, id: crypto.randomUUID(), projectId: selected.projectId,
            projectName: project.value?.name ?? 'Unknown project', reviewId: selected.id, createdAt: Date.now(),
            task: 'topic-review', provider: 'deepseek' }).catch(() => { usageSaveFailed = true; }));
        } else if (event.data.type === 'done') {
          const artifact = event.data.artifact;
          void Promise.all(usageWrites).then(() => resolve(artifact));
        } else {
          const errorMessage = event.data.message;
          void Promise.all(usageWrites).then(() => reject(new Error(errorMessage)));
        }
      };
      worker.onerror = event => reject(new Error(event.message || 'AI review worker stopped unexpectedly'));
      worker.postMessage({ reviewJson: selected.data, model, apiKey: key, summaryLanguage: copilot.copilotSummaryLanguage, reviewLanguage: copilot.copilotReviewLanguage, uiLanguage: language.value });
    });
    if (record.value?.id !== selected.id) return;
    const updated = { ...selected, aiReview: { artifact, reviewed: {}, createdAt: Date.now(), sourceData: selected.data } };
    if (!await saveAiReviewIfCurrent(selected.id, selected.snapshotHash, updated.aiReview, selected.data)) return;
    reviews.value = reviews.value.map(item => item.id === selected.id ? updated : item);
    reviewView.value = 'topics';
    note(usageSaveFailed ? 'AI topics are ready, but usage details could not be saved.' : 'AI topics are ready. Review each topic against the diff.', usageSaveFailed);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') note('AI review canceled.');
    else note(`AI review failed: ${error instanceof Error ? error.message : String(error)}${usageSaveFailed ? ' Usage details could not be saved.' : ''}`, true);
  } finally { worker.terminate(); cancelAiReview = null; aiBusy.value = false; resumeLiveReview(); }
}
async function markTopic(id: string, status: 'reviewed' | 'needs-work' | null) {
  const selected = record.value;
  if (!selected?.aiReview || topicsAreStale(selected)) return;
  const reviewed = { ...selected.aiReview.reviewed };
  if (status) reviewed[id] = status;
  else delete reviewed[id];
  const updated = { ...selected, aiReview: { ...selected.aiReview, reviewed } };
  try {
    if (!await saveAiReviewIfCurrent(selected.id, selected.snapshotHash, updated.aiReview, selected.data)) return;
    reviews.value = reviews.value.map(item => item.id === selected.id ? updated : item);
  }
  catch (error) { note(`Could not save topic status: ${error instanceof Error ? error.message : String(error)}`, true); }
}
watch(() => currentRoute.fullPath, () => {
  const requestAccess = requestAccessOnNextRoute;
  requestAccessOnNextRoute = false;
  void applyRoute(requestAccess);
});
async function onLiveReviewsChanged(event: Event) {
  const projectId = (event as CustomEvent<{ projectId: string }>).detail.projectId;
  if (activeId.value !== projectId) return;
  const fresh = await listReviews(projectId);
  if (activeId.value !== projectId) return;
  const previous = record.value;
  reviews.value = fresh;
  const current = fresh.find(item => item.id === activeReviewId.value);
  reviewData.value = current ? JSON.parse(current.data) as Review : null;
  if (current && previous?.snapshotHash !== current.snapshotHash) {
    cancelCommitLoad?.(); commitHistory.value = null; commitsError.value = '';
    if (reviewView.value === 'commits') loadCommits();
  }
  if (activeReviewId.value && !current) navigate({ kind: 'project', projectId, page: 'reviews' });
}
onMounted(async () => {
  window.addEventListener('ming:reviews-changed', onLiveReviewsChanged);
  try { projects.value = await listProjects(); await applyRoute(); }
  catch (error) { note(`Initialization failed: ${error}`, true); ready.value = true; }
});
onUnmounted(() => { window.removeEventListener('ming:reviews-changed', onLiveReviewsChanged); cancelCommitLoad?.(); cancelActiveScan?.(); cancelAiReview?.(); });
</script>

<template>
  <AppShell v-if="ready" :projects="projects" :active-project="project" mode="project" :page="view" :review-count="reviews.length" :branch-count="gitInfo?.branches.length" :review-layout="view === 'reviews' && !permissionRequired && !!project" :hide-line-numbers="!settings.showLineNumbers" :code-font-size="settings.codeFontSize" :code-line-height="settings.codeLineHeight" @home="navigate({ kind: 'home' })" @add-project="addProject" @select-project="selectProject" @select-page="selectPage" @global-settings="navigate({ kind: 'global-settings' })">
    <div v-if="project && message && view !== 'reviews'" class="inline-message" :class="{ error: messageError }" role="status"><strong>{{ messageError ? 'Scan failed' : 'Status' }}</strong><span>{{ message }}</span><button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
    <div v-if="!project" class="empty-state"><h3>Project not found</h3><p>Select a project from the Projects page.</p><button class="button-outline" @click="navigate({ kind: 'home' })">Projects</button></div>
    <div v-else-if="permissionRequired" class="empty-state"><h3>Project access required</h3><p>Grant read access to open this project. Ming will not modify its files.</p><button class="button-primary" @click="applyRoute(true)">Grant access</button></div>
    <FilesView v-else-if="view === 'files'" :project="project" :git-info="gitInfo" :path="filePath" :data="fileView?.data ?? null" :busy="filesBusy" :error="filesError" :settings="settings" @navigate="selectFilePath" @refresh="refreshFiles" />
    <ReviewsView v-else-if="view === 'reviews'" :key="`${activeReviewId ?? 'empty'}:${record?.createdAt ?? ''}`" :project="project" :reviews="reviews" :record="record" :data="reviewData" :review-view="reviewView" :settings="settings" :scan-busy="scanBusy" :scan-progress="scanProgress" :ai-busy="aiBusy" :ai-progress="displayedAiProgress" :ai-completed="aiCompleted" :ai-total="aiTotal" :ai-configured="!!settings.copilotDeepSeekApiKey.trim()" :commit-history="commitHistory" :commits-busy="commitsBusy" :commits-error="commitsError" :message="message" :message-error="messageError" @select-review="selectReview" @select-tab="selectReviewTab" @scan="scanProject" @cancel-scan="cancelScan" @delete-review="deleteSelectedReview" @generate-ai-review="generateAiReview" @cancel-ai-review="cancelAi" @mark-topic="markTopic" @retry-commits="loadCommits" @dismiss-message="message = ''" />
    <BranchesView v-else-if="view === 'branches'" :git-info="gitInfo" />
    <ProjectSettingsView v-else :project="project" :git-info="gitInfo" @save="saveProjectSettings" @remove="removeProject" />
    <template #toast><div v-if="!project && message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

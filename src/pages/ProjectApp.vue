<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { inspectRepository, type CommitHistory, type RepositoryInfo } from '../lib/localRepository';
import { deleteProject, listProjects, listReviews, rememberProject, saveReviewSnapshot, type Project, type ReviewRecord } from '../lib/projectStore';
import { parseRoute, resolveId, routeUrl, shortId, type Route } from '../lib/routes';
import { readProjectPath, type ProjectPath } from '../lib/projectFiles';
import { loadGlobalSettings } from '../lib/globalSettings';
import AppShell from '../components/AppShell.vue';
import { addLocalProject } from '../lib/addProject';
import type { Review } from '../lib/reviewTypes';

type View = 'files' | 'reviews' | 'branches' | 'settings';
type ReviewView = 'changes' | 'commits';
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
const commitHistory = shallowRef<CommitHistory | null>(null);
const commitsBusy = ref(false);
const commitsError = ref('');
let routeGeneration = 0;
let requestAccessOnNextRoute = false;
let cancelCommitLoad: (() => void) | null = null;
let cancelActiveScan: (() => void) | null = null;

function note(value: string, error = false) { message.value = value; messageError.value = error; }
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
    reviewView.value = route.kind === 'review' ? route.page : 'changes';
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
type WorkerMessage = { type: 'progress'; message: string } | { type: 'done'; data: string | null; gitInfo: RepositoryInfo } | { type: 'error'; message: string };
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
    worker.postMessage({ directory, baseRef });
  });
}
async function scanProject() {
  const selected = project.value;
  if (!selected || scanBusy.value) return;
  cancelCommitLoad?.(); commitsBusy.value = false;
  scanBusy.value = true; scanProgress.value = 'Preparing scan…'; message.value = ''; messageError.value = false;
  try {
    const result = await scanInWorker(selected.directory, selected.settings.baseRef);
    gitInfo.value = result.gitInfo;
    if (!result.data) return note('No changes between the working tree and comparison ref.');
    const data = JSON.parse(result.data) as Review;
    if (!data.files.length) return note('No reviewable changes between the working tree and comparison ref.');
    const saved = await saveReviewSnapshot({ id: crypto.randomUUID(), projectId: selected.id, createdAt: Date.now(), branch: result.gitInfo.currentBranch, baseRef: selected.settings.baseRef, headOid: result.gitInfo.headOid, fileCount: data.files.length, data: result.data });
    reviews.value = await listReviews(selected.id);
    reviewData.value = data;
    activeReviewId.value = saved.id;
    commitHistory.value = null; commitsError.value = '';
    navigate({ kind: 'review', projectId: selected.id, reviewId: saved.id, page: settings.defaultReviewTab });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') note('Scan canceled.');
    else note(`Scan failed: ${error instanceof Error ? error.message : String(error)}`, true);
  } finally { scanBusy.value = false; }
}
async function addProject() {
  try { const selected = await addLocalProject(projects.value); if (!projects.value.some(item => item.id === selected.id)) projects.value = [...projects.value, selected]; navigate({ kind: 'project', projectId: selected.id, page: 'files' }); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; note(error instanceof Error ? error.message : String(error), true); }
}
async function saveProjectSettings(name: string, baseRef: string) {
  const selected = project.value;
  if (!selected) return;
  if (!name) return note('Project name cannot be empty.', true);
  selected.name = name; selected.settings.baseRef = baseRef;
  try { await rememberProject(selected); projects.value = [...projects.value]; note('Project settings saved in this browser.'); }
  catch (error) { note(error instanceof Error ? error.message : String(error), true); }
}
async function removeProject() {
  const selected = project.value;
  if (!selected) return;
  try { await deleteProject(selected.id); void router.push(routeUrl({ kind: 'home' })); }
  catch (error) { note(error instanceof Error ? error.message : String(error), true); }
}
function selectProject(id: string | null) { navigate(id ? { kind: 'project', projectId: id, page: 'files' } : { kind: 'home' }); }
function selectPage(page: View) { if (activeId.value) navigate({ kind: 'project', projectId: activeId.value, page }); }
function selectFilePath(path: string) { if (activeId.value) { navigate({ kind: 'project', projectId: activeId.value, page: 'files', ...(path ? { path } : {}) }); window.scrollTo(0, 0); } }
function refreshFiles() { fileView.value = null; gitInfo.value = null; selectFilePath(filePath.value); }
function selectReview(id: string) { if (activeId.value) navigate({ kind: 'review', projectId: activeId.value, reviewId: id, page: settings.defaultReviewTab }); }
function selectReviewTab(tab: ReviewView) { if (activeId.value && activeReviewId.value) navigate({ kind: 'review', projectId: activeId.value, reviewId: activeReviewId.value, page: tab }); }
function cancelScan() { cancelActiveScan?.(); }
watch(() => currentRoute.fullPath, () => {
  const requestAccess = requestAccessOnNextRoute;
  requestAccessOnNextRoute = false;
  void applyRoute(requestAccess);
});
onMounted(async () => {
  try { projects.value = await listProjects(); await applyRoute(); }
  catch (error) { note(`Initialization failed: ${error}`, true); ready.value = true; }
});
onUnmounted(() => { cancelCommitLoad?.(); cancelActiveScan?.(); });
</script>

<template>
  <AppShell v-if="ready" :projects="projects" :active-project="project" mode="project" :page="view" :review-count="reviews.length" :branch-count="gitInfo?.branches.length" :review-layout="view === 'reviews' && !permissionRequired && !!project" :hide-line-numbers="!settings.showLineNumbers" :code-font-size="settings.codeFontSize" :code-line-height="settings.codeLineHeight" @home="navigate({ kind: 'home' })" @add-project="addProject" @select-project="selectProject" @select-page="selectPage" @global-settings="navigate({ kind: 'global-settings' })">
    <div v-if="project && message" class="inline-message" :class="{ error: messageError }" role="status"><strong>{{ messageError ? 'Scan failed' : 'Status' }}</strong><span>{{ message }}</span><button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div>
    <div v-if="!project" class="empty-state"><h3>Project not found</h3><p>Select a project from the Projects page.</p><button class="button-outline" @click="navigate({ kind: 'home' })">Projects</button></div>
    <div v-else-if="permissionRequired" class="empty-state"><h3>Project access required</h3><p>Grant read access to open this project. Ming will not modify its files.</p><button class="button-primary" @click="applyRoute(true)">Grant access</button></div>
    <FilesView v-else-if="view === 'files'" :project="project" :git-info="gitInfo" :path="filePath" :data="fileView?.data ?? null" :busy="filesBusy" :error="filesError" :settings="settings" @navigate="selectFilePath" @refresh="refreshFiles" />
    <ReviewsView v-else-if="view === 'reviews'" :key="activeReviewId ?? 'empty'" :project="project" :reviews="reviews" :record="record" :data="reviewData" :review-view="reviewView" :settings="settings" :scan-busy="scanBusy" :scan-progress="scanProgress" :commit-history="commitHistory" :commits-busy="commitsBusy" :commits-error="commitsError" @select-review="selectReview" @select-tab="selectReviewTab" @scan="scanProject" @cancel-scan="cancelScan" @retry-commits="loadCommits" />
    <BranchesView v-else-if="view === 'branches'" :git-info="gitInfo" />
    <ProjectSettingsView v-else :project="project" :git-info="gitInfo" @save="saveProjectSettings" @remove="removeProject" />
    <template #toast><div v-if="!project && message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

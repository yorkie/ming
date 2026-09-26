<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import AppShell from '../components/AppShell.vue';
import FilesView from '../components/FilesView.vue';
import ReviewsView from '../components/ReviewsView.vue';
import BranchesView from '../components/BranchesView.vue';
import DemoIntro from '../components/DemoIntro.vue';
import { addLocalProject } from '../lib/addProject';
import { demoCommits, demoFiles, demoRepository, demoReview, createDemoReview } from '../lib/demoProject';
import { loadGlobalSettings } from '../lib/globalSettings';
import { language, t } from '../lib/i18n';
import { listProjects, type Project, type ReviewRecord } from '../lib/projectStore';
import { routeUrl } from '../lib/routes';

const router = useRouter();
const projects = shallowRef<Project[]>([]);
const demo = { id: 'demo-project', name: 'Demo Project', directory: null as unknown as FileSystemDirectoryHandle, addedAt: 0, settings: { baseRef: 'main' } } satisfies Project;
const review = ref<ReviewRecord>(createDemoReview(language.value));
const settings = loadGlobalSettings();
const page = ref<'files' | 'reviews' | 'branches'>('reviews');
const tab = ref<'topics' | 'changes' | 'commits'>('topics');
const path = ref('');
const message = ref('');

function openProject(id: string | null) { void router.push(id ? routeUrl({ kind: 'project', projectId: id, page: 'files' }) : routeUrl({ kind: 'home' })); }
async function addProject() {
  try { const project = await addLocalProject(projects.value); openProject(project.id); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; message.value = error instanceof Error ? error.message : String(error); }
}
function markTopic(id: string, status: 'reviewed' | 'needs-work' | null) {
  const reviewed = { ...review.value.aiReview!.reviewed };
  if (status) reviewed[id] = status;
  else delete reviewed[id];
  review.value = { ...review.value, aiReview: { ...review.value.aiReview!, reviewed } };
}
onMounted(async () => { try { projects.value = await listProjects(); } catch { /* The self-contained demo remains available. */ } });
</script>

<template>
  <AppShell :projects="projects" :active-project="demo" hide-project-settings mode="project" :page="page" :review-count="1" :branch-count="2" :review-layout="page === 'reviews'" :hide-line-numbers="!settings.showLineNumbers" :code-font-size="settings.codeFontSize" :code-line-height="settings.codeLineHeight" @home="openProject(null)" @add-project="addProject" @select-project="openProject" @select-page="page = $event as typeof page" @global-settings="router.push(routeUrl({ kind: 'global-settings', section: 'appearance' }))">
    <DemoIntro v-if="page !== 'reviews'" @add-project="addProject" />
    <FilesView v-if="page === 'files'" :project="demo" :git-info="demoRepository" :path="path" :data="demoFiles[path] ?? null" :busy="false" :error="''" :settings="settings" @navigate="path = $event" @refresh="path = ''" />
    <ReviewsView v-else-if="page === 'reviews'" demo :project="demo" :reviews="[review]" :record="review" :data="demoReview" :review-view="tab" :settings="settings" :scan-busy="false" :scan-progress="''" :ai-busy="false" :ai-progress="''" :ai-completed="0" :ai-total="0" :ai-configured="false" :commit-history="demoCommits" :commits-busy="false" :commits-error="''" @select-tab="tab = $event" @mark-topic="markTopic"><template #intro><DemoIntro @add-project="addProject" /></template></ReviewsView>
    <BranchesView v-else :git-info="demoRepository" />
    <template #toast><div v-if="message" class="toast error" role="status">{{ message }}<button :aria-label="t('Dismiss message')" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

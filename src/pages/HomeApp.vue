<script setup lang="ts">
import { computed, onMounted, shallowRef, ref } from 'vue';
import { useRouter } from 'vue-router';
import { listProjects, type Project } from '../lib/projectStore';
import { routeUrl } from '../lib/routes';
import AppShell from '../components/AppShell.vue';
import { addLocalProject } from '../lib/addProject';
import { language, t } from '../lib/i18n';
import { loadGlobalSettings, shouldShowDemoProject } from '../lib/globalSettings';

const projects = shallowRef<Project[]>([]);
const demoVisible = computed(() => shouldShowDemoProject(loadGlobalSettings(), projects.value.length, localStorage.getItem('ming-created-real-project') === '1'));
const router = useRouter();
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
function note(value: string, error = false) { message.value = value; messageError.value = error; }
function openProject(id: string | null, page: 'files' | 'reviews' = 'files') { if (id) void router.push(routeUrl({ kind: 'project', projectId: id, page })); }
function openSettings() { void router.push(routeUrl({ kind: 'global-settings' })); }
function openDemo() { void router.push('/demo/'); }
async function addProject() {
  try { const project = await addLocalProject(projects.value); openProject(project.id); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; note(error instanceof Error ? error.message : String(error), true); }
}
onMounted(async () => {
  try { projects.value = await listProjects(); if (projects.value.length) localStorage.setItem('ming-created-real-project', '1'); }
  catch (error) { note(`Initialization failed: ${error}`, true); }
  finally { ready.value = true; }
});
</script>
<template>
  <AppShell v-if="ready" :projects="projects" mode="home" @home="() => {}" @add-project="addProject" @select-project="openProject" @global-settings="openSettings">
    <div class="projects-page home-page">
      <section class="home-hero">
        <div class="home-eyebrow">{{ t('WELCOME TO MING') }}</div>
        <h1>{{ t('Review AI-written code with confidence.') }}</h1>
        <p>{{ t('Ming turns local Git changes into a review you can follow. Inspect the real diff, group related changes into topics, and decide what needs another look.') }}</p>
        <div class="home-hero-actions"><button class="button-primary" @click="addProject"><i class="bi bi-plus-lg" aria-hidden="true"></i> {{ t('Add a local repository') }}</button><button v-if="demoVisible" class="button-outline" @click="openDemo">{{ t('Try the demo') }}</button><span>{{ t('Runs in your browser. Your repository stays on your computer.') }}</span></div>
      </section>
      <section class="home-guide" :aria-label="t('Get started')">
        <div class="home-section-heading"><div><span class="home-eyebrow">{{ t('GET STARTED') }}</span><h2>{{ t('Your first review in three steps') }}</h2></div></div>
        <div class="home-steps">
          <article><span class="home-step-number">01</span><i class="bi bi-folder2-open" aria-hidden="true"></i><h3>{{ t('Choose your repository') }}</h3><p>{{ t('Select a local Git folder and grant read access. No upload or GitHub sign-in is needed.') }}</p></article>
          <article><span class="home-step-number">02</span><i class="bi bi-file-earmark-diff" aria-hidden="true"></i><h3>{{ t('Inspect the changes') }}</h3><p>{{ t('Open Reviews to compare your working tree with a Git ref. Ming keeps the review current while this page is open.') }}</p></article>
          <article><span class="home-step-number">03</span><i class="bi bi-check2-square" aria-hidden="true"></i><h3>{{ t('Review by topic') }}</h3><p>{{ t('Add a DeepSeek key in MING Console when you want AI topics. Check each topic against its diff and mark your decision.') }}</p></article>
        </div>
      </section>
      <section class="home-projects" :aria-label="t('Local projects')">
        <div class="home-section-heading"><div><span class="home-eyebrow">{{ t('YOUR WORKSPACE') }}</span><h2>{{ t('Local projects') }}</h2><p>{{ projects.length ? language === 'zh-CN' ? `${projects.length} 个本地仓库` : `${projects.length} local ${projects.length === 1 ? 'repository' : 'repositories'}` : t(demoVisible ? 'Try the sample project or add your own repository.' : 'Add a repository to begin your first review.') }}</p></div><button v-if="projects.length" class="button-outline" @click="addProject"><i class="bi bi-plus" aria-hidden="true"></i> {{ t('Add project') }}</button></div>
        <div v-if="projects.length || demoVisible" class="home-project-grid"><article v-if="demoVisible" class="home-project-card home-demo-card"><div class="home-project-icon"><i class="bi bi-stars" aria-hidden="true"></i></div><h3>{{ t('Demo Project') }}</h3><p>{{ t('Explore files, review a sample diff, and try topic decisions. No folder or API key required.') }}</p><div class="home-project-actions"><button class="button-primary" @click="openDemo">{{ t('Try the demo') }} <i class="bi bi-arrow-right" aria-hidden="true"></i></button></div></article><article v-for="project in projects" :key="project.id" class="home-project-card"><div class="home-project-icon"><i class="bi bi-folder2" aria-hidden="true"></i></div><h3>{{ project.name }}</h3><p>{{ t('Local Git repository') }}</p><div class="home-project-actions"><button class="button-primary" @click="openProject(project.id, 'reviews')">{{ t('Open reviews') }} <i class="bi bi-arrow-right" aria-hidden="true"></i></button><button class="button-outline" @click="openProject(project.id)">{{ t('Browse files') }}</button></div></article></div>
        <div v-else class="home-empty"><i class="bi bi-folder-plus" aria-hidden="true"></i><div><h3>{{ t('Ready when you are') }}</h3><p>{{ t('Choose a local repository to start reviewing its changes.') }}</p></div><button class="button-outline" @click="addProject">{{ t('Choose folder') }}</button></div>
      </section>
    </div>
    <template #toast><div v-if="message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

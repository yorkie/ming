<script setup lang="ts">
import { onMounted, shallowRef, ref } from 'vue';
import { useRouter } from 'vue-router';
import { listProjects, type Project } from '../lib/projectStore';
import { routeUrl } from '../lib/routes';
import AppShell from '../components/AppShell.vue';
import { addLocalProject } from '../lib/addProject';
import { language, t } from '../lib/i18n';

const projects = shallowRef<Project[]>([]);
const router = useRouter();
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
function note(value: string, error = false) { message.value = value; messageError.value = error; }
function openProject(id: string | null) { if (id) void router.push(routeUrl({ kind: 'project', projectId: id, page: 'files' })); }
function openSettings() { void router.push(routeUrl({ kind: 'global-settings' })); }
async function addProject() {
  try { const project = await addLocalProject(projects.value); openProject(project.id); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; note(error instanceof Error ? error.message : String(error), true); }
}
onMounted(async () => {
  try { projects.value = await listProjects(); }
  catch (error) { note(`Initialization failed: ${error}`, true); }
  finally { ready.value = true; }
});
</script>
<template>
  <AppShell v-if="ready" :projects="projects" mode="home" @home="() => {}" @add-project="addProject" @select-project="openProject" @global-settings="openSettings">
    <div class="projects-page"><div class="projects-header"><div><h1>{{ t('Projects') }}</h1><p>{{ projects.length ? language === 'zh-CN' ? `${projects.length} 个本地仓库` : `${projects.length} local ${projects.length === 1 ? 'repository' : 'repositories'}` : t('Add a local Git repository to browse files and review changes.') }}</p></div><button class="button-primary" @click="addProject"><i class="bi bi-plus" aria-hidden="true"></i> {{ t('Add project') }}</button></div>
      <section v-if="projects.length" class="project-list-panel" :aria-label="t('Local projects')"><button v-for="project in projects" :key="project.id" type="button" class="project-list-row" @click="openProject(project.id)"><span class="project-list-icon"><i class="bi bi-folder2" aria-hidden="true"></i></span><strong class="project-list-name">{{ project.name }}</strong><i class="bi bi-chevron-right" aria-hidden="true"></i></button></section>
      <div v-else class="projects-empty"><i class="bi bi-folder2-open" aria-hidden="true"></i><h2>{{ t('No projects yet') }}</h2><p>{{ t('Choose a local Git repository to get started.') }}</p><button class="button-outline" @click="addProject">{{ t('Choose folder') }}</button></div>
    </div>
    <template #toast><div v-if="message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

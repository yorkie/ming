<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loadGlobalSettings, saveGlobalSettings } from '../lib/globalSettings';
import { listProjects, type Project } from '../lib/projectStore';
import { parseRoute, routeUrl, type GlobalSettingsSection } from '../lib/routes';
import AppShell from '../components/AppShell.vue';
import ChoiceSelect from '../components/ChoiceSelect.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import AiUsageView from '../components/AiUsageView.vue';
import { addLocalProject } from '../lib/addProject';

const router = useRouter();
const currentRoute = useRoute();
const initialRoute = parseRoute(currentRoute.fullPath);
const section = ref<GlobalSettingsSection>(initialRoute?.kind === 'global-settings' ? initialRoute.section ?? 'usage' : 'usage');
const draft = ref(loadGlobalSettings());
const projects = shallowRef<Project[]>([]);
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
const fontSizes = [12, 13, 14, 15, 16].map(value => ({ value: String(value), label: `${value} px` }));
const lineHeights = [20, 24, 28, 32].map(value => ({ value: String(value), label: `${value} px` }));
const previewLimits = [['100', '100 KB'], ['500', '500 KB'], ['1000', '1 MB'], ['2000', '2 MB']].map(([value, label]) => ({ value, label }));
const reviewTabs = [{ value: 'topics', label: 'Topics' }, { value: 'changes', label: 'Changes' }, { value: 'commits', label: 'Commits' }];
const deepSeekModels = [{ value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' }, { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }];
function note(value: string, error = false) { message.value = value; messageError.value = error; }
function openHome() { void router.push(routeUrl({ kind: 'home' })); }
function openProject(id: string | null) { void router.push(id ? routeUrl({ kind: 'project', projectId: id, page: 'files' }) : routeUrl({ kind: 'home' })); }
function selectSection(next: GlobalSettingsSection) {
  section.value = next;
  message.value = '';
  const url = routeUrl({ kind: 'global-settings', section: next });
  if (currentRoute.fullPath !== url) void router.push(url);
}
watch(() => currentRoute.fullPath, value => {
  const route = parseRoute(value);
  if (route?.kind === 'global-settings') section.value = route.section ?? 'usage';
});
function save() {
  try {
    saveGlobalSettings(draft.value);
    draft.value = loadGlobalSettings();
    note('Settings saved in this browser.');
  } catch (error) { note(error instanceof Error ? error.message : String(error), true); }
}
async function addProject() {
  try { const project = await addLocalProject(projects.value); void router.push(routeUrl({ kind: 'project', projectId: project.id, page: 'files' })); }
  catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; note(error instanceof Error ? error.message : String(error), true); }
}
onMounted(async () => {
  try { projects.value = await listProjects(); }
  catch (error) { note(`Initialization failed: ${error}`, true); }
  finally { ready.value = true; }
});
</script>

<template>
  <AppShell v-if="ready" :projects="projects" mode="settings" :section="section" @home="openHome" @add-project="addProject" @select-project="openProject" @select-section="selectSection" @global-settings="selectSection('usage')">
    <div class="global-settings-page">
      <div class="section-intro"><div><span class="section-index">MING / CONSOLE</span><h2>MING Console</h2></div><p>{{ section === 'usage' ? 'Track AI usage across projects in this browser.' : 'Manage preferences that apply to every project in this browser.' }}</p></div>
      <AiUsageView v-if="section === 'usage'" :projects="projects" />
      <form v-else class="global-settings-form" @submit.prevent="save">
        <section class="global-settings-section"><div class="global-settings-section-heading">
          <h3>{{ { appearance: 'Appearance', files: 'File browsing', reviews: 'Reviews', copilot: 'Copilot' }[section] }}</h3>
          <p>{{ { appearance: 'Choose how code appears in file previews and reviews.', files: 'Control how repository files are previewed.', reviews: 'Choose how saved reviews open.', copilot: 'Configure DeepSeek for AI-assisted topic reviews.' }[section] }}</p>
        </div>
          <template v-if="section === 'appearance'">
            <div class="setting-row"><label><strong>Code font size</strong><span>Applies to file previews and diff lines</span></label><ChoiceSelect :model-value="String(draft.codeFontSize)" :options="fontSizes" label="Code font size" @update:model-value="draft.codeFontSize = Number($event)" /></div>
            <div class="setting-row"><label><strong>Code line height</strong><span>Vertical space between code lines</span></label><ChoiceSelect :model-value="String(draft.codeLineHeight)" :options="lineHeights" label="Code line height" @update:model-value="draft.codeLineHeight = Number($event)" /></div>
            <div class="setting-row"><label><strong>Syntax highlighting</strong><span>Color code in file previews and diffs</span></label><ToggleSwitch v-model="draft.syntaxHighlighting" label="Syntax highlighting" /></div>
            <div class="setting-row"><label><strong>Line numbers</strong><span>Show line numbers beside source code and diffs</span></label><ToggleSwitch v-model="draft.showLineNumbers" label="Line numbers" /></div>
          </template>
          <template v-else-if="section === 'files'">
            <div class="setting-row"><label><strong>README preview</strong><span>Render README below each folder listing</span></label><ToggleSwitch v-model="draft.showReadmePreview" label="README preview" /></div>
            <div class="setting-row"><label><strong>Text preview limit</strong><span>Files above this size are not loaded into the preview</span></label><ChoiceSelect :model-value="String(draft.filePreviewLimitKb)" :options="previewLimits" label="Text preview limit" @update:model-value="draft.filePreviewLimitKb = Number($event)" /></div>
          </template>
          <template v-else-if="section === 'reviews'">
            <div class="setting-row"><label><strong>Default tab</strong><span>Tab shown after scanning changes</span></label><ChoiceSelect :model-value="draft.defaultReviewTab" :options="reviewTabs" label="Default tab" @update:model-value="draft.defaultReviewTab = $event as typeof draft.defaultReviewTab" /></div>
            <div class="setting-row"><label><strong>Expand file diffs</strong><span>Open changed files when a review is selected</span></label><ToggleSwitch v-model="draft.expandDiffs" label="Expand file diffs" /></div>
            <div class="setting-row"><label><strong>Rich Markdown diff</strong><span>Open Markdown changes in rendered view when available</span></label><ToggleSwitch v-model="draft.richMarkdownByDefault" label="Rich Markdown diff" /></div>
          </template>
          <template v-else>
            <div class="setting-row"><label for="copilot-deepseek-key"><strong>DeepSeek API key</strong><span>Saved in this browser with your Copilot settings</span></label><input id="copilot-deepseek-key" v-model="draft.copilotDeepSeekApiKey" type="password" autocomplete="off" placeholder="Enter DeepSeek API key" maxlength="500"></div>
            <div v-if="draft.copilotDeepSeekApiKey.trim()" class="setting-row"><label><strong>Model</strong><span>DeepSeek model for AI topic reviews</span></label><ChoiceSelect :model-value="draft.copilotModel" :options="deepSeekModels" label="DeepSeek model" @update:model-value="draft.copilotModel = $event as typeof draft.copilotModel" /></div>
          </template>
        </section>
        <div class="global-settings-actions"><button type="submit" class="button-primary">Save settings</button></div>
      </form>
    </div>
    <template #toast><div v-if="message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

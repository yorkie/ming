<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { loadGlobalSettings, saveGlobalSettings } from '../lib/globalSettings';
import { listProjects, type Project } from '../lib/projectStore';
import { parseRoute, routeUrl, type GlobalSettingsSection } from '../lib/routes';
import AppShell from '../components/AppShell.vue';
import ChoiceSelect from '../components/ChoiceSelect.vue';
import ToggleSwitch from '../components/ToggleSwitch.vue';
import { addLocalProject } from '../lib/addProject';

const router = useRouter();
const currentRoute = useRoute();
const initialRoute = parseRoute(currentRoute.fullPath);
const section = ref<GlobalSettingsSection>(initialRoute?.kind === 'global-settings' ? initialRoute.section ?? 'appearance' : 'appearance');
const draft = ref(loadGlobalSettings());
const projects = shallowRef<Project[]>([]);
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
const fontSizes = [12, 13, 14, 15, 16].map(value => ({ value: String(value), label: `${value} px` }));
const lineHeights = [20, 24, 28, 32].map(value => ({ value: String(value), label: `${value} px` }));
const previewLimits = [['100', '100 KB'], ['500', '500 KB'], ['1000', '1 MB'], ['2000', '2 MB']].map(([value, label]) => ({ value, label }));
const reviewTabs = [{ value: 'changes', label: 'Changes' }, { value: 'commits', label: 'Commits' }];
const providers = [{ value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' }, { value: 'google', label: 'Google' }, { value: 'custom', label: 'Custom endpoint' }];
const roles = [{ value: 'reviewer', label: 'Code reviewer' }, { value: 'security', label: 'Security reviewer' }, { value: 'maintainer', label: 'Maintainer' }, { value: 'custom', label: 'Custom role' }];
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
  if (route?.kind === 'global-settings') section.value = route.section ?? 'appearance';
});
function save() {
  try {
    saveGlobalSettings(draft.value);
    draft.value = loadGlobalSettings();
    note(section.value === 'copilot' ? 'Copilot preferences saved. AI review is not connected yet.' : 'Settings saved in this browser.');
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
  <AppShell v-if="ready" :projects="projects" mode="settings" :section="section" @home="openHome" @add-project="addProject" @select-project="openProject" @select-section="selectSection" @global-settings="selectSection('appearance')">
    <div class="global-settings-page">
      <div class="section-intro"><div><span class="section-index">SETTINGS</span><h2>Settings</h2></div><p>These preferences apply to every project in this browser.</p></div>
      <form class="global-settings-form" @submit.prevent="save">
        <section class="global-settings-section"><div class="global-settings-section-heading">
          <h3>{{ { appearance: 'Appearance', files: 'File browsing', reviews: 'Reviews', copilot: 'Copilot' }[section] }}</h3>
          <p>{{ { appearance: 'Choose how code appears in file previews and reviews.', files: 'Control how repository files are previewed.', reviews: 'Choose how saved reviews open.', copilot: 'Prepare AI review preferences. Copilot is not connected yet, so these settings do not run a review.' }[section] }}</p>
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
            <div class="setting-row"><label><strong>Default tab</strong><span>Tab shown when opening a review</span></label><ChoiceSelect :model-value="draft.defaultReviewTab" :options="reviewTabs" label="Default tab" @update:model-value="draft.defaultReviewTab = $event as 'changes' | 'commits'" /></div>
            <div class="setting-row"><label><strong>Expand file diffs</strong><span>Open changed files when a review is selected</span></label><ToggleSwitch v-model="draft.expandDiffs" label="Expand file diffs" /></div>
            <div class="setting-row"><label><strong>Rich Markdown diff</strong><span>Open Markdown changes in rendered view when available</span></label><ToggleSwitch v-model="draft.richMarkdownByDefault" label="Rich Markdown diff" /></div>
          </template>
          <template v-else>
            <div class="setting-row"><label><strong>LLM provider</strong><span>Provider to use when Copilot is available</span></label><ChoiceSelect :model-value="draft.copilotProvider" :options="providers" label="LLM provider" @update:model-value="draft.copilotProvider = $event as typeof draft.copilotProvider" /></div>
            <div class="setting-row"><label for="copilot-model"><strong>Model</strong><span>Provider model identifier</span></label><input id="copilot-model" v-model="draft.copilotModel" type="text" placeholder="Model name" maxlength="120"></div>
            <div class="setting-row"><label for="copilot-endpoint"><strong>Custom endpoint</strong><span>Optional API base URL for a custom provider</span></label><input id="copilot-endpoint" v-model="draft.copilotEndpoint" type="text" placeholder="https://example.com/v1" maxlength="500"></div>
            <div class="setting-row"><label><strong>Review role</strong><span>Perspective for future AI reviews</span></label><ChoiceSelect :model-value="draft.copilotRole" :options="roles" label="Review role" @update:model-value="draft.copilotRole = $event as typeof draft.copilotRole" /></div>
            <div class="setting-row setting-row-textarea"><label for="copilot-instructions"><strong>Review instructions</strong><span>Additional guidance for your Copilot role</span></label><textarea id="copilot-instructions" v-model="draft.copilotInstructions" maxlength="4000" rows="5" placeholder="Focus on correctness, risks, and actionable feedback…"></textarea></div>
          </template>
        </section>
        <div class="global-settings-actions"><button type="submit" class="button-primary">Save settings</button></div>
      </form>
    </div>
    <template #toast><div v-if="message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

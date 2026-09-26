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
import { setLanguage, t } from '../lib/i18n';

const router = useRouter();
const currentRoute = useRoute();
const initialRoute = parseRoute(currentRoute.fullPath);
const section = ref<GlobalSettingsSection>(initialRoute?.kind === 'global-settings' ? initialRoute.section ?? 'usage' : 'usage');
const draft = ref(loadGlobalSettings());
const projects = shallowRef<Project[]>([]);
const ready = ref(false);
const message = ref('');
const messageError = ref(false);
const showDeepSeekKey = ref(false);
const fontSizes = [12, 13, 14, 15, 16].map(value => ({ value: String(value), label: `${value} px` }));
const lineHeights = [20, 24, 28, 32].map(value => ({ value: String(value), label: `${value} px` }));
const previewLimits = [['100', '100 KB'], ['500', '500 KB'], ['1000', '1 MB'], ['2000', '2 MB']].map(([value, label]) => ({ value, label }));
const reviewTabs = [{ value: 'topics', label: 'Topics' }, { value: 'changes', label: 'Changes' }, { value: 'commits', label: 'Commits' }];
const deepSeekModels = [{ value: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' }, { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }];
const languages = [{ value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }];
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
    window.dispatchEvent(new Event('ming:settings-changed'));
    draft.value = loadGlobalSettings();
    setLanguage(draft.value.language);
    note(t('Settings saved in this browser.'));
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
      <div class="section-intro"><div><span class="section-index">MING / CONSOLE</span><h2>{{ t('MING Console') }}</h2></div><p>{{ t(section === 'usage' ? 'Track AI usage across projects in this browser.' : 'Manage preferences that apply to every project in this browser.') }}</p></div>
      <AiUsageView v-if="section === 'usage'" :projects="projects" />
      <form v-else class="global-settings-form" @submit.prevent="save">
        <section class="global-settings-section"><div class="global-settings-section-heading">
          <h3>{{ t({ appearance: 'Appearance', files: 'File browsing', reviews: 'Reviews', copilot: 'Copilot' }[section]) }}</h3>
          <p>{{ t({ appearance: 'Choose how code appears in file previews and reviews.', files: 'Control how repository files are previewed.', reviews: 'Choose how saved reviews open.', copilot: 'Configure DeepSeek for review titles and topics.' }[section]) }}</p>
        </div>
          <template v-if="section === 'appearance'">
            <div class="setting-row"><label><strong>{{ t('Show Demo Project') }}</strong><span>{{ t('Show the sample project on Home until you add a local repository') }}</span></label><ToggleSwitch v-model="draft.showDemoProject" :label="t('Show Demo Project')" /></div>
            <div class="setting-row"><label><strong>{{ t('Language') }}</strong><span>{{ t('Language used throughout Ming') }}</span></label><ChoiceSelect :model-value="draft.language" :options="languages" :label="t('Language')" @update:model-value="draft.language = $event as typeof draft.language" /></div>
            <div class="setting-row"><label><strong>{{ t('Code font size') }}</strong><span>{{ t('Applies to file previews and diff lines') }}</span></label><ChoiceSelect :model-value="String(draft.codeFontSize)" :options="fontSizes" :label="t('Code font size')" @update:model-value="draft.codeFontSize = Number($event)" /></div>
            <div class="setting-row"><label><strong>{{ t('Code line height') }}</strong><span>{{ t('Vertical space between code lines') }}</span></label><ChoiceSelect :model-value="String(draft.codeLineHeight)" :options="lineHeights" :label="t('Code line height')" @update:model-value="draft.codeLineHeight = Number($event)" /></div>
            <div class="setting-row"><label><strong>{{ t('Syntax highlighting') }}</strong><span>{{ t('Color code in file previews and diffs') }}</span></label><ToggleSwitch v-model="draft.syntaxHighlighting" :label="t('Syntax highlighting')" /></div>
            <div class="setting-row"><label><strong>{{ t('Line numbers') }}</strong><span>{{ t('Show line numbers beside source code and diffs') }}</span></label><ToggleSwitch v-model="draft.showLineNumbers" :label="t('Line numbers')" /></div>
          </template>
          <template v-else-if="section === 'files'">
            <div class="setting-row"><label><strong>{{ t('README preview') }}</strong><span>{{ t('Render README below each folder listing') }}</span></label><ToggleSwitch v-model="draft.showReadmePreview" :label="t('README preview')" /></div>
            <div class="setting-row"><label><strong>{{ t('Text preview limit') }}</strong><span>{{ t('Files above this size are not loaded into the preview') }}</span></label><ChoiceSelect :model-value="String(draft.filePreviewLimitKb)" :options="previewLimits" :label="t('Text preview limit')" @update:model-value="draft.filePreviewLimitKb = Number($event)" /></div>
          </template>
          <template v-else-if="section === 'reviews'">
            <div class="setting-row"><label><strong>{{ t('Local change detection') }}</strong><span>{{ t('Use file notifications when available, or check on a timer') }}</span></label><ChoiceSelect :model-value="draft.fileChangeDetection" :options="[{ value: 'observer', label: t('Observer with timer fallback') }, { value: 'timer', label: t('Timer only') }]" :label="t('Local change detection')" @update:model-value="draft.fileChangeDetection = $event as typeof draft.fileChangeDetection" /></div>
            <div class="setting-row"><label><strong>{{ t('Default tab') }}</strong><span>{{ t('Tab shown after scanning changes') }}</span></label><ChoiceSelect :model-value="draft.defaultReviewTab" :options="reviewTabs.map(item => ({ ...item, label: t(item.label) }))" :label="t('Default tab')" @update:model-value="draft.defaultReviewTab = $event as typeof draft.defaultReviewTab" /></div>
            <div class="setting-row"><label><strong>{{ t('Expand file diffs') }}</strong><span>{{ t('Open changed files when a review is selected') }}</span></label><ToggleSwitch v-model="draft.expandDiffs" :label="t('Expand file diffs')" /></div>
            <div class="setting-row"><label><strong>{{ t('Rich Markdown diff') }}</strong><span>{{ t('Open Markdown changes in rendered view when available') }}</span></label><ToggleSwitch v-model="draft.richMarkdownByDefault" :label="t('Rich Markdown diff')" /></div>
          </template>
          <template v-else>
            <div class="setting-row"><label for="copilot-deepseek-key"><strong>{{ t('DeepSeek API key') }}</strong><span>{{ t('Saved in this browser with your Copilot settings') }}</span></label><div class="secret-input"><input id="copilot-deepseek-key" v-model="draft.copilotDeepSeekApiKey" :type="showDeepSeekKey ? 'text' : 'password'" autocomplete="off" :placeholder="t('Enter DeepSeek API key')" maxlength="500"><button type="button" :aria-label="t(showDeepSeekKey ? 'Hide DeepSeek API key' : 'Show DeepSeek API key')" :aria-pressed="showDeepSeekKey" @click="showDeepSeekKey = !showDeepSeekKey"><i :class="showDeepSeekKey ? 'bi bi-eye-slash' : 'bi bi-eye'" aria-hidden="true"></i></button></div></div>
            <div v-if="draft.copilotDeepSeekApiKey.trim()" class="setting-row"><label><strong>{{ t('Model') }}</strong><span>{{ t('DeepSeek model for review titles and topics') }}</span></label><ChoiceSelect :model-value="draft.copilotModel" :options="deepSeekModels" :label="t('Model')" @update:model-value="draft.copilotModel = $event as typeof draft.copilotModel" /></div>
            <div class="setting-row"><label><strong>{{ t('Summary language') }}</strong><span>{{ t('Language for topic titles and summaries') }}</span></label><ChoiceSelect :model-value="draft.copilotSummaryLanguage" :options="languages" :label="t('Summary language')" @update:model-value="draft.copilotSummaryLanguage = $event as typeof draft.copilotSummaryLanguage" /></div>
            <div class="setting-row"><label><strong>{{ t('Review language') }}</strong><span>{{ t('Language for review guidance, comments and conclusions') }}</span></label><ChoiceSelect :model-value="draft.copilotReviewLanguage" :options="languages" :label="t('Review language')" @update:model-value="draft.copilotReviewLanguage = $event as typeof draft.copilotReviewLanguage" /></div>
          </template>
        </section>
        <div class="global-settings-actions"><button type="submit" class="button-primary">{{ t('Save settings') }}</button></div>
      </form>
    </div>
    <template #toast><div v-if="message" class="toast" :class="{ error: messageError }" role="status">{{ message }}<button aria-label="Dismiss message" @click="message = ''"><i class="bi bi-x-lg" aria-hidden="true"></i></button></div></template>
  </AppShell>
</template>

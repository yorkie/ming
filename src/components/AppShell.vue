<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { Project } from '../lib/projectStore';
import type { GlobalSettingsSection } from '../lib/routes';
import { t } from '../lib/i18n';
import BackgroundTasks from './BackgroundTasks.vue';

type Page = 'files' | 'reviews' | 'branches' | 'settings';
const props = defineProps<{
  projects: Project[];
  activeProject?: Project | null;
  mode: 'home' | 'project' | 'settings';
  page?: Page;
  reviewCount?: number;
  branchCount?: number | null;
  reviewLayout?: boolean;
  section?: GlobalSettingsSection;
  hideLineNumbers?: boolean;
  codeFontSize?: number;
  codeLineHeight?: number;
}>();
const emit = defineEmits<{
  home: [];
  addProject: [];
  selectProject: [id: string | null];
  selectPage: [page: Page];
  selectSection: [section: GlobalSettingsSection];
  globalSettings: [];
}>();
const pickerOpen = ref(false);
const logoUrl = `${import.meta.env.BASE_URL}logo-header.png`;
const picker = ref<HTMLElement | null>(null);
const options = ref<HTMLButtonElement[]>([]);
const categories: { id: GlobalSettingsSection; label: string; icon: string }[] = [
  { id: 'usage', label: 'AI usage', icon: 'bar-chart' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'files', label: 'File browsing', icon: 'folder2-open' },
  { id: 'reviews', label: 'Reviews', icon: 'file-earmark-diff' },
  { id: 'copilot', label: 'Copilot', icon: 'robot' },
];
function chooseProject(id: string | null) { pickerOpen.value = false; emit('selectProject', id); }
function pickerKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { pickerOpen.value = false; (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('#project-picker-trigger')?.focus(); return; }
  if (event.key === 'Tab') { pickerOpen.value = false; return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  pickerOpen.value = true;
  const index = options.value.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.value.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.value.length) % options.value.length;
  options.value[next]?.focus();
}
function outside(event: PointerEvent) { if (picker.value && event.target instanceof Node && !picker.value.contains(event.target)) pickerOpen.value = false; }
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>

<template>
  <div class="app-shell" :class="{ 'hide-line-numbers': props.hideLineNumbers }" :style="{ '--code-font-size': `${props.codeFontSize ?? 13}px`, '--code-line-height': `${props.codeLineHeight ?? 24}px` }">
    <header class="masthead">
      <button id="home" class="wordmark" aria-label="Ming home" @click="emit('home')"><img class="wordmark-logo" :src="logoUrl" alt="Ming" /></button>
      <div class="top-project-picker">
        <span class="project-picker-label">{{ t('Projects') }}</span>
        <div ref="picker" class="project-picker" @keydown="pickerKey">
          <button id="project-picker-trigger" type="button" class="project-picker-trigger" :aria-label="t('Select a project')" aria-haspopup="true" :aria-expanded="pickerOpen" aria-controls="project-picker-menu" @click="pickerOpen = !pickerOpen"><span>{{ activeProject?.name ?? t('All projects') }}</span><i class="bi bi-chevron-down" aria-hidden="true"></i></button>
          <nav v-show="pickerOpen" id="project-picker-menu" class="project-picker-menu" :aria-label="t('Projects')">
            <button ref="options" type="button" class="project-picker-option" :class="{ selected: !activeProject }" :aria-current="!activeProject" @click="chooseProject(null)"><span class="project-picker-option-name">{{ t('All projects') }}</span><i v-if="!activeProject" class="bi bi-check2" aria-hidden="true"></i></button>
            <button v-for="project in projects" :key="project.id" ref="options" type="button" class="project-picker-option" :class="{ selected: activeProject?.id === project.id }" :aria-current="activeProject?.id === project.id" @click="chooseProject(project.id)"><span class="project-picker-option-name">{{ project.name }}</span><i v-if="activeProject?.id === project.id" class="bi bi-check2" aria-hidden="true"></i></button>
          </nav>
        </div>
        <button id="add-project-small" class="button-outline" :title="t('Add project')" @click="emit('addProject')"><i class="bi bi-plus" aria-hidden="true"></i> {{ t('Add project') }}</button>
      </div>
      <BackgroundTasks :projects="projects" />
    </header>
    <div class="app-body">
      <aside class="rail">
        <div v-if="mode === 'settings'" class="rail-section"><div class="rail-heading"><span>{{ t('Console sections') }}</span></div><nav class="project-nav" :aria-label="t('Console sections')"><button v-for="category in categories" :key="category.id" type="button" :class="{ active: section === category.id }" :aria-current="section === category.id ? 'page' : undefined" @click="emit('selectSection', category.id)"><i :class="`bi bi-${category.icon}`" aria-hidden="true"></i><span class="project-nav-text">{{ t(category.label) }}</span></button></nav></div>
        <div v-else-if="activeProject" class="rail-section"><div class="rail-heading"><span>{{ t('Project navigation') }}</span></div><nav class="project-nav" :aria-label="t('Project pages')">
          <button type="button" :class="{ active: page === 'files' }" @click="emit('selectPage', 'files')"><i class="bi bi-folder2" aria-hidden="true"></i><span class="project-nav-text">{{ t('Files') }}</span></button>
          <button type="button" :class="{ active: page === 'reviews' }" @click="emit('selectPage', 'reviews')"><i class="bi bi-file-earmark-diff" aria-hidden="true"></i><span class="project-nav-text">{{ t('Reviews') }}</span><span class="project-nav-count">{{ reviewCount ?? 0 }}</span></button>
          <button type="button" :class="{ active: page === 'branches' }" @click="emit('selectPage', 'branches')"><i class="bi bi-git" aria-hidden="true"></i><span class="project-nav-text">{{ t('Branches') }}</span><span class="project-nav-count">{{ branchCount ?? '—' }}</span></button>
          <button type="button" :class="{ active: page === 'settings' }" @click="emit('selectPage', 'settings')"><i class="bi bi-gear" aria-hidden="true"></i><span class="project-nav-text">{{ t('Settings') }}</span></button>
        </nav></div>
        <div v-else class="rail-section"><div class="rail-heading"><span>{{ t('Workspace') }}</span></div><p class="rail-empty">{{ t('Select a project above.') }}</p></div>
        <div class="rail-global-settings"><button type="button" :class="{ active: mode === 'settings' }" :aria-label="t('MING Console')" :title="t('MING Console')" @click="emit('globalSettings')"><i class="bi bi-grid-1x2" aria-hidden="true"></i><span>{{ t('MING Console') }}</span></button></div>
      </aside>
      <main class="workspace"><div class="page" :class="{ 'reviews-page': reviewLayout }"><slot /></div><slot name="toast" /></main>
    </div>
  </div>
</template>

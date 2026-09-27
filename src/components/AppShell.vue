<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { listReviews, type Project } from '../lib/projectStore';
import type { GlobalSettingsSection } from '../lib/routes';
import { language, t } from '../lib/i18n';
import BackgroundTasks from './BackgroundTasks.vue';
import AiTaskDock from './AiTaskDock.vue';

type Page = 'files' | 'reviews' | 'branches' | 'settings';
const props = defineProps<{
  projects: Project[];
  activeProject?: Project | null;
  hideProjectSettings?: boolean;
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
const reviewSummaries = ref<Record<string, { count: number; latestAt: number | null }>>({});
const summariesLoaded = ref(false);
const now = ref(Date.now());
let summaryRequest = 0;
let clock: ReturnType<typeof setInterval> | null = null;
async function loadReviewSummaries() {
  const request = ++summaryRequest;
  summariesLoaded.value = false;
  const results = await Promise.allSettled(props.projects.map(async project => {
    const reviews = await listReviews(project.id);
    return [project.id, { count: reviews.length, latestAt: reviews[0]?.createdAt ?? null }] as const;
  }));
  if (request !== summaryRequest || !pickerOpen.value) return;
  reviewSummaries.value = Object.fromEntries(results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []));
  summariesLoaded.value = true;
}
watch(pickerOpen, open => {
  if (clock) clearInterval(clock);
  clock = null;
  if (open) {
    now.value = Date.now();
    void loadReviewSummaries();
    clock = setInterval(() => { now.value = Date.now(); }, 60_000);
  }
});
watch(() => props.projects, () => { if (pickerOpen.value) void loadReviewSummaries(); });
function onReviewsChanged() { if (pickerOpen.value) void loadReviewSummaries(); }
function relativeDate(value: number) {
  const seconds = Math.max(0, Math.floor((now.value - value) / 1000));
  if (seconds < 60) return language.value === 'zh-CN' ? '刚刚' : 'just now';
  if (seconds < 3600) { const minutes = Math.floor(seconds / 60); return language.value === 'zh-CN' ? `${minutes} 分钟前` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`; }
  if (seconds < 86_400) { const hours = Math.floor(seconds / 3600); return language.value === 'zh-CN' ? `${hours} 小时前` : `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`; }
  const days = Math.floor(seconds / 86_400);
  if (days < 30) return language.value === 'zh-CN' ? `${days} 天前` : `${days} ${days === 1 ? 'day' : 'days'} ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return language.value === 'zh-CN' ? `${months} 个月前` : `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365);
  return language.value === 'zh-CN' ? `${years} 年前` : `${years} ${years === 1 ? 'year' : 'years'} ago`;
}
function reviewSummary(projectId: string) {
  const summary = reviewSummaries.value[projectId];
  if (!summary) return t(summariesLoaded.value ? 'Review info unavailable' : 'Loading reviews…');
  if (summary.latestAt === null) return t('No reviews yet');
  const count = language.value === 'zh-CN' ? `${summary.count} 条评审` : `${summary.count} ${summary.count === 1 ? 'review' : 'reviews'}`;
  return `${count} · ${t('Last updated')} ${relativeDate(summary.latestAt)}`;
}
const categoryGroups: { label: string; categories: { id: GlobalSettingsSection; label: string; icon: string }[] }[] = [
  { label: 'Overview', categories: [{ id: 'usage', label: 'AI usage', icon: 'bar-chart' }] },
  { label: 'Preferences', categories: [
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'files', label: 'File browsing', icon: 'folder2-open' },
    { id: 'reviews', label: 'Reviews', icon: 'file-earmark-diff' },
  ] },
  { label: 'Integrations', categories: [
    { id: 'copilot', label: 'Copilot', icon: 'robot' },
    { id: 'github', label: 'GitHub', icon: 'github' },
  ] },
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
onMounted(() => { document.addEventListener('pointerdown', outside); window.addEventListener('ming:reviews-changed', onReviewsChanged); });
onUnmounted(() => { summaryRequest++; if (clock) clearInterval(clock); document.removeEventListener('pointerdown', outside); window.removeEventListener('ming:reviews-changed', onReviewsChanged); });
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
            <div v-if="projects.length" class="project-picker-divider" role="separator"></div>
            <button v-for="project in projects" :key="project.id" ref="options" type="button" class="project-picker-option project-picker-project" :class="{ selected: activeProject?.id === project.id }" :aria-current="activeProject?.id === project.id" @click="chooseProject(project.id)"><span class="project-picker-option-details"><span class="project-picker-option-name">{{ project.name }}</span><span class="project-picker-option-meta">{{ reviewSummary(project.id) }}</span></span><i v-if="activeProject?.id === project.id" class="bi bi-check2" aria-hidden="true"></i></button>
          </nav>
        </div>
        <button id="add-project-small" class="button-outline" :title="t('Add project')" @click="emit('addProject')"><i class="bi bi-plus" aria-hidden="true"></i> {{ t('Add project') }}</button>
      </div>
      <BackgroundTasks :projects="projects" />
    </header>
    <div class="app-body">
      <aside class="rail">
        <div v-if="mode === 'settings'" class="rail-section"><nav class="project-nav console-nav" :aria-label="t('Console sections')"><div v-for="group in categoryGroups" :key="group.label" class="console-nav-group"><div class="rail-heading"><span>{{ t(group.label) }}</span></div><button v-for="category in group.categories" :key="category.id" type="button" :class="{ active: section === category.id }" :aria-current="section === category.id ? 'page' : undefined" @click="emit('selectSection', category.id)"><i :class="`bi bi-${category.icon}`" aria-hidden="true"></i><span class="project-nav-text">{{ t(category.label) }}</span></button></div></nav></div>
        <div v-else-if="activeProject" class="rail-section"><div class="rail-heading"><span>{{ t('Project navigation') }}</span></div><nav class="project-nav" :aria-label="t('Project pages')">
          <button type="button" :class="{ active: page === 'files' }" @click="emit('selectPage', 'files')"><i class="bi bi-folder2" aria-hidden="true"></i><span class="project-nav-text">{{ t('Files') }}</span></button>
          <button type="button" :class="{ active: page === 'reviews' }" @click="emit('selectPage', 'reviews')"><i class="bi bi-file-earmark-diff" aria-hidden="true"></i><span class="project-nav-text">{{ t('Reviews') }}</span><span class="project-nav-count">{{ reviewCount ?? 0 }}</span></button>
          <button type="button" :class="{ active: page === 'branches' }" @click="emit('selectPage', 'branches')"><i class="bi bi-git" aria-hidden="true"></i><span class="project-nav-text">{{ t('Branches') }}</span><span class="project-nav-count">{{ branchCount ?? '—' }}</span></button>
          <button v-if="!hideProjectSettings" type="button" :class="{ active: page === 'settings' }" @click="emit('selectPage', 'settings')"><i class="bi bi-gear" aria-hidden="true"></i><span class="project-nav-text">{{ t('Settings') }}</span></button>
        </nav></div>
        <div v-else class="rail-section"><div class="rail-heading"><span>{{ t('Workspace') }}</span></div><p class="rail-empty">{{ t('Select a project above.') }}</p></div>
        <div class="rail-global-settings"><a class="rail-source-link" href="https://github.com/yorkie/ming" target="_blank" rel="noopener noreferrer" aria-label="Ming on GitHub" title="Ming on GitHub"><i class="bi bi-github" aria-hidden="true"></i></a><button type="button" :class="{ active: mode === 'settings' }" :aria-label="t('MING Console')" :title="t('MING Console')" @click="emit('globalSettings')"><i class="bi bi-sliders2" aria-hidden="true"></i><span>{{ t('MING Console') }}</span></button></div>
      </aside>
      <main class="workspace"><div class="page" :class="{ 'reviews-page': reviewLayout }"><slot /></div><slot name="toast" /></main>
    </div>
    <AiTaskDock />
  </div>
</template>

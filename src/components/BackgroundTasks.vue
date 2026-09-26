<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { Project } from '../lib/projectStore';
import { liveReviewStatuses, type LiveReviewStatus } from '../lib/liveReviews';
import { reviewTitleStatuses } from '../lib/reviewTitles';
import { t } from '../lib/i18n';

type TaskStatus = LiveReviewStatus | { phase: 'titling'; detail?: string };
const props = defineProps<{ projects: Project[] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const entries = computed(() => props.projects.flatMap(project => {
  const statuses: TaskStatus[] = [];
  const live = liveReviewStatuses.get(project.id);
  if (live) statuses.push(live);
  for (const projectId of reviewTitleStatuses.values()) if (projectId === project.id) statuses.push({ phase: 'titling' });
  return statuses.length ? [{ project, statuses }] : [];
}));
const activeCount = computed(() => entries.value.reduce((count, entry) => count + entry.statuses.filter(status => status.phase === 'scanning' || status.phase === 'titling').length, 0));
const errorCount = computed(() => entries.value.reduce((count, entry) => count + entry.statuses.filter(status => status.phase === 'error').length, 0));
const icon = (phase: TaskStatus['phase']) => ({ watching: 'bi-eye', polling: 'bi-clock-history', scanning: 'bi-arrow-repeat', titling: 'bi-pencil-square', permission: 'bi-lock', error: 'bi-exclamation-triangle' })[phase];
const title = (phase: TaskStatus['phase']) => t(({ watching: 'File watcher', polling: 'Timer checks', scanning: 'Scanning changes', titling: 'Generating review title', permission: 'Folder access required', error: 'Background task failed' })[phase]);
const mode = (status: TaskStatus) => 'mode' in status ? status.mode : undefined;
const description = (status: TaskStatus) => status.detail ?? t(({ watching: 'Watching for local changes', polling: 'Timer checks active', scanning: 'Checking local changes', titling: 'Summarizing the latest diff', permission: 'Waiting for folder permission', error: 'Background task failed' })[status.phase]);
function outside(event: PointerEvent) { if (root.value && event.target instanceof Node && !root.value.contains(event.target)) open.value = false; }
function keydown(event: KeyboardEvent) { if (event.key === 'Escape') open.value = false; }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', keydown); });
onUnmounted(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', keydown); });
</script>

<template>
  <div ref="root" class="background-tasks">
    <button type="button" class="background-tasks-trigger" :class="{ 'has-error': errorCount }" :aria-label="t('Background tasks')" aria-haspopup="true" :aria-expanded="open" aria-controls="background-tasks-panel" @click="open = !open">
      <i :class="`bi ${errorCount ? 'bi-exclamation-triangle' : activeCount ? 'bi-arrow-repeat' : 'bi-activity'} ${activeCount && !errorCount ? 'icon-spin' : ''}`" aria-hidden="true"></i>
      <span>{{ t('Tasks') }}</span>
    </button>
    <section v-if="open" id="background-tasks-panel" class="background-tasks-panel" :aria-label="t('Background tasks')">
      <div class="background-tasks-heading"><strong>{{ t('Background tasks') }}</strong><span>{{ entries.length }} {{ t('projects monitored') }}</span></div>
      <p v-if="!entries.length" class="background-tasks-empty">{{ t('No background tasks. Enable live review updates in a project’s settings.') }}</p>
      <div v-for="{ project, statuses } in entries" :key="project.id" class="background-task-project">
        <strong class="background-task-project-name" :title="project.name">{{ project.name }}</strong>
        <div v-for="(status, index) in statuses" :key="index" class="background-task-state" :class="`is-${status.phase}`" role="status">
          <i :class="`bi ${icon(status.phase)} ${status.phase === 'scanning' ? 'icon-spin' : ''}`" aria-hidden="true"></i>
          <div><div class="background-task-state-heading"><strong>{{ title(status.phase) }}</strong><span v-if="mode(status)" class="background-task-mode">{{ mode(status) === 'observer' ? 'Observer' : 'Timer' }}</span></div><p>{{ description(status) }}</p></div>
        </div>
      </div>
    </section>
  </div>
</template>

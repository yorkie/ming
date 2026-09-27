<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { Project } from '../lib/projectStore';
import { listGitHubRemotes, type RepositoryInfo } from '../lib/localRepository';
import ChoiceSelect from './ChoiceSelect.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { t } from '../lib/i18n';

const props = defineProps<{ project: Project; gitInfo: RepositoryInfo | null }>();
const emit = defineEmits<{ save: [name: string, baseRef: string, liveReview: boolean, githubRepository: string]; remove: [] }>();
const name = ref(props.project.name);
const baseRef = ref(props.project.settings.baseRef);
const liveReview = ref(props.project.settings.liveReview ?? true);
const githubRepository = ref(props.project.settings.githubRepository ?? '');
const githubRemotes = ref<Array<{ remote: string; repository: string }>>([]);
const githubOptions = computed(() => {
  const options: Array<{ value: string; label: string; icon?: 'github' }> = [{ value: '', label: t('No GitHub repository') }];
  for (const item of githubRemotes.value) {
    if (!options.some(option => option.value === item.repository)) options.push({ value: item.repository, label: `${item.remote} · ${item.repository}`, icon: 'github' });
  }
  if (githubRepository.value && !options.some(option => option.value === githubRepository.value)) {
    options.push({ value: githubRepository.value, label: githubRepository.value, icon: 'github' });
  }
  return options;
});

async function loadRemotes() {
  const projectId = props.project.id;
  try {
    const remotes = await listGitHubRemotes(props.project.directory);
    if (projectId === props.project.id) githubRemotes.value = remotes.map(item => ({ remote: item.remote, repository: `${item.repository.owner}/${item.repository.repo}` }));
  } catch { githubRemotes.value = []; }
}

onMounted(() => { void loadRemotes(); });
watch(() => props.project.id, () => {
  name.value = props.project.name;
  baseRef.value = props.project.settings.baseRef;
  liveReview.value = props.project.settings.liveReview ?? true;
  githubRepository.value = props.project.settings.githubRepository ?? '';
  void loadRemotes();
});
</script>

<template>
  <div class="settings-page">
  <div class="section-intro"><div><span class="section-index">03 / SETTINGS</span><h2>{{ t('Project settings') }}</h2></div><p>{{ t('These settings are saved in your browser. The Git repository is not modified.') }}</p></div>
  <form class="settings-panel" @submit.prevent="emit('save', name.trim(), baseRef, liveReview, githubRepository.trim())">
    <div class="setting-row"><label for="project-name"><strong>{{ t('Project name') }}</strong><span>{{ t('Shown in the Ming workspace') }}</span></label><input id="project-name" v-model="name" required maxlength="80"></div>
    <div class="setting-row"><label><strong>{{ t('Live review updates') }}</strong><span>{{ t('Watch this repository while Ming is open') }}</span></label><ToggleSwitch v-model="liveReview" :label="t('Live review updates')" /></div>
    <div class="setting-row">
      <label><strong>{{ t('GitHub repository') }}</strong><span>{{ t('Choose a GitHub repository from this project’s remotes.') }}</span></label>
      <ChoiceSelect v-model="githubRepository" :label="t('GitHub repository')" :options="githubOptions" />
    </div>
    <div class="setting-actions"><button type="submit" class="button-primary">{{ t('Save settings') }}</button></div>
  </form>
  <div class="danger-panel"><div><strong>{{ t('Remove from workspace') }}</strong><p>{{ t('Remove this project, its reviews, and AI usage history from this browser. Local files will stay intact.') }}</p></div><button class="button-danger" @click="emit('remove')">{{ t('Remove project') }}</button></div>
  </div>
</template>

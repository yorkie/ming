<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Project } from '../lib/projectStore';
import type { RepositoryInfo } from '../lib/localRepository';
import ChoiceSelect from './ChoiceSelect.vue';
import ToggleSwitch from './ToggleSwitch.vue';
import { liveReviewStatuses } from '../lib/liveReviews';
import { t } from '../lib/i18n';
const props = defineProps<{ project: Project; gitInfo: RepositoryInfo | null }>();
const emit = defineEmits<{ save: [name: string, baseRef: string, liveReview: boolean, liveTopics: boolean]; remove: [] }>();
const name = ref(props.project.name);
const baseRef = ref(props.project.settings.baseRef);
const liveReview = ref(props.project.settings.liveReview ?? false);
const liveTopics = ref(props.project.settings.liveTopics ?? false);
watch(() => props.project.id, () => { name.value = props.project.name; baseRef.value = props.project.settings.baseRef; liveReview.value = props.project.settings.liveReview ?? false; liveTopics.value = props.project.settings.liveTopics ?? false; });
</script>
<template><div class="section-intro"><div><span class="section-index">03 / SETTINGS</span><h2>{{ t('Project settings') }}</h2></div><p>{{ t('These settings are saved in your browser. The Git repository is not modified.') }}</p></div><form class="settings-panel" @submit.prevent="emit('save', name.trim(), baseRef, liveReview, liveTopics)"><div class="setting-row"><label for="project-name"><strong>{{ t('Project name') }}</strong><span>{{ t('Shown in the Ming workspace') }}</span></label><input id="project-name" v-model="name" required maxlength="80"></div><div class="setting-row"><label><strong>{{ t('Comparison ref') }}</strong><span>{{ t('Use the current branch’s remote-tracking ref by default; choose a branch to override') }}</span></label><ChoiceSelect v-model="baseRef" :label="t('Comparison ref')" :options="[{ value: 'HEAD', label: t('Current branch’s remote (automatic)') }, ...(gitInfo?.branches ?? []).map(branch => ({ value: branch, label: branch }))]" /></div><div class="setting-row"><label><strong>{{ t('Live review updates') }}</strong><span>{{ t('Watch this repository while Ming is open') }}</span></label><ToggleSwitch v-model="liveReview" :label="t('Live review updates')" /></div><div class="setting-row"><label><strong>{{ t('Generate topics for live updates') }}</strong><span>{{ t('Generate topics in the background after the diff changes') }}</span></label><ToggleSwitch v-model="liveTopics" :label="t('Generate topics for live updates')" :disabled="!liveReview" /></div><div v-if="project.settings.liveReview && liveReviewStatuses.get(project.id)" class="setting-row"><label><strong>{{ t('Live review status') }}</strong></label><span role="status">{{ t(liveReviewStatuses.get(project.id)!) }}</span></div><div class="setting-actions"><button type="submit" class="button-primary">{{ t('Save settings') }}</button></div></form><div class="danger-panel"><div><strong>{{ t('Remove from workspace') }}</strong><p>{{ t('Remove this project and its reviews from the browser. Local files will stay intact.') }}</p></div><button class="button-danger" @click="emit('remove')">{{ t('Remove project') }}</button></div></template>

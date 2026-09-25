<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Project } from '../lib/projectStore';
import type { RepositoryInfo } from '../lib/localRepository';
import ChoiceSelect from './ChoiceSelect.vue';
const props = defineProps<{ project: Project; gitInfo: RepositoryInfo | null }>();
const emit = defineEmits<{ save: [name: string, baseRef: string]; remove: [] }>();
const name = ref(props.project.name);
const baseRef = ref(props.project.settings.baseRef);
watch(() => props.project.id, () => { name.value = props.project.name; baseRef.value = props.project.settings.baseRef; });
</script>
<template><div class="section-intro"><div><span class="section-index">03 / SETTINGS</span><h2>Project settings</h2></div><p>These settings are saved in your browser. The Git repository is not modified.</p></div><form class="settings-panel" @submit.prevent="emit('save', name.trim(), baseRef)"><div class="setting-row"><label for="project-name"><strong>Project name</strong><span>Shown in the Ming workspace</span></label><input id="project-name" v-model="name" required maxlength="80"></div><div class="setting-row"><label><strong>Comparison ref</strong><span>Compare the working tree with this Git ref when scanning</span></label><ChoiceSelect v-model="baseRef" label="Comparison ref" :options="[{ value: 'HEAD', label: 'HEAD (current commit)' }, ...(gitInfo?.branches ?? []).map(branch => ({ value: branch, label: branch }))]" /></div><div class="setting-actions"><button type="submit" class="button-primary">Save settings</button></div></form><div class="danger-panel"><div><strong>Remove from workspace</strong><p>Remove this project and its reviews from the browser. Local files will stay intact.</p></div><button class="button-danger" @click="emit('remove')">Remove project</button></div></template>

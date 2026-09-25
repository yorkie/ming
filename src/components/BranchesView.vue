<script setup lang="ts">
import type { RepositoryInfo } from '../lib/localRepository';
defineProps<{ gitInfo: RepositoryInfo | null }>();
</script>
<template><div class="section-intro"><div><span class="section-index">02 / BRANCHES</span><h2>Local branches</h2></div><p>Local branches in this project. Use a Git tool to switch branches.</p></div><div class="list-panel"><div v-for="branch in gitInfo?.branches ?? []" :key="branch" class="branch-row"><span class="branch-icon"><i class="bi bi-git" aria-hidden="true"></i></span><strong>{{ branch }}</strong><span v-if="branch === gitInfo?.currentBranch" class="branch-tag">Current branch</span></div><div v-if="!gitInfo?.branches.length" class="list-empty">This repository has no committed local branches yet.</div></div></template>

<script setup lang="ts">
import { t } from '../lib/i18n';
defineEmits<{ addProject: [] }>();
</script>

<template>
  <div class="demo-intro"><div><strong>{{ t('Demo Project') }}</strong><p>{{ t('Sample content. Try browsing files, inspecting changes, and marking topics. Nothing is sent to an AI provider.') }}</p></div><button class="button-outline" @click="$emit('addProject')">{{ t('Add your own project') }}</button></div>
</template>

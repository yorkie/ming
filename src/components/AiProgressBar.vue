<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../lib/i18n';

const props = defineProps<{ completed?: number; total?: number }>();
const measured = computed(() => (props.total ?? 0) > 0 && (props.completed ?? 0) > 0);
const value = computed(() => Math.min(Math.max(props.completed ?? 0, 0), props.total ?? 0));
const percent = computed(() => measured.value ? `${(value.value / (props.total ?? 1)) * 100}%` : undefined);
</script>

<template>
  <div class="ai-progress-track" :class="{ 'is-indeterminate': !measured }" role="progressbar"
    :aria-label="t('Generating AI topics')" :aria-valuemin="measured ? 0 : undefined"
    :aria-valuemax="measured ? total : undefined" :aria-valuenow="measured ? value : undefined">
    <span class="ai-progress-fill" :style="percent ? { width: percent } : undefined"></span>
  </div>
</template>

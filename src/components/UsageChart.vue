<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { Chart, type ChartConfiguration } from 'chart.js/auto';

const props = defineProps<{ config: ChartConfiguration; label: string }>();
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart | undefined;

watch([canvas, () => props.config], ([element, config]) => {
  if (!element) return;
  chart?.destroy();
  chart = new Chart(element, config);
}, { immediate: true, flush: 'post' });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
  <canvas ref="canvas" role="img" :aria-label="label"></canvas>
</template>

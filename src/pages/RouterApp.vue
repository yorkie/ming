<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { startLiveReviews, stopLiveReviews } from '../lib/liveReviews';
onMounted(startLiveReviews);
onUnmounted(stopLiveReviews);
</script>
<template>
  <RouterView />
</template>

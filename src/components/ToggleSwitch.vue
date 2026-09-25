<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>
<template><span class="custom-toggle-wrap"><button type="button" class="custom-toggle" role="switch" :aria-label="label" :aria-checked="modelValue" @click="emit('update:modelValue', !modelValue)"><span class="custom-toggle-thumb" aria-hidden="true"></span></button></span></template>

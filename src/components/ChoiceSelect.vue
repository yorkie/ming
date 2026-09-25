<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
const props = defineProps<{ modelValue: string; options: { value: string; label: string }[]; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const optionButtons = ref<HTMLButtonElement[]>([]);
function outside(event: PointerEvent) { if (root.value && event.target instanceof Node && !root.value.contains(event.target)) open.value = false; }
function choose(value: string) { emit('update:modelValue', value); open.value = false; trigger.value?.focus(); }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { open.value = false; trigger.value?.focus(); return; }
  if (event.key === 'Tab') { open.value = false; return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); open.value = true;
  const current = optionButtons.value.indexOf(document.activeElement as HTMLButtonElement);
  const selected = props.options.findIndex(option => option.value === props.modelValue);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? optionButtons.value.length - 1 : current < 0 ? selected : (current + (event.key === 'ArrowDown' ? 1 : -1) + optionButtons.value.length) % optionButtons.value.length;
  optionButtons.value[next]?.focus();
}
onMounted(() => document.addEventListener('pointerdown', outside));
onUnmounted(() => document.removeEventListener('pointerdown', outside));
</script>
<template>
  <div ref="root" class="custom-select" @keydown="keydown">
    <button ref="trigger" type="button" class="custom-select-trigger" aria-haspopup="listbox" :aria-label="label" :aria-expanded="open" @click="open = !open"><span class="custom-select-value">{{ options.find(option => option.value === modelValue)?.label ?? options[0]?.label }}</span><i class="bi bi-chevron-down" aria-hidden="true"></i></button>
    <div v-show="open" class="custom-select-options" role="listbox" :aria-label="label">
      <button v-for="option in options" :key="option.value" ref="optionButtons" type="button" class="custom-select-option" role="option" :aria-selected="option.value === modelValue" tabindex="-1" @click="choose(option.value)"><span>{{ option.label }}</span><i class="bi bi-check2" aria-hidden="true"></i></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { compactDirectory, type FileTreeNode } from '../lib/reviewTree';
import type { FileChange } from '../lib/reviewTypes';
import { t } from '../lib/i18n';
const props = defineProps<{ node: FileTreeNode; files: FileChange[]; depth: number; collapsed: Set<string>; selectedIndex: number | null }>();
const emit = defineEmits<{ toggle: [path: string]; select: [index: number] }>();
const compact = computed(() => props.node.kind === 'directory' ? compactDirectory(props.node) : null);
const file = computed(() => props.node.kind === 'file' ? props.files[props.node.fileIndex!] : null);
const statusIcons: Record<string, string> = { added: 'file-earmark-plus', deleted: 'file-earmark-minus', renamed: 'file-earmark-diff', binary: 'file-earmark-binary' };
const statusLabels: Record<string, string> = { added: 'Added', deleted: 'Deleted', renamed: 'Renamed', binary: 'Binary' };
const statusIcon = computed(() => statusIcons[file.value?.status ?? ''] ?? 'file-earmark-text');
const statusLabel = computed(() => t(statusLabels[file.value?.status ?? ''] ?? 'Modified'));
</script>
<template>
  <button v-if="node.kind === 'file' && file" type="button" role="treeitem" class="tree-row tree-file" :class="{ selected: selectedIndex === node.fileIndex }" :style="{ '--depth': depth }" :title="`${file.path} · ${statusLabel}`" :aria-label="`${file.path}, ${statusLabel}, ${file.additions} lines added, ${file.deletions} lines deleted`" @click="emit('select', node.fileIndex!)"><span class="tree-symbol" :class="`tree-status-${file.status}`"><i :class="`bi bi-${statusIcon}`" aria-hidden="true"></i></span><span class="tree-name">{{ node.name }}</span><span class="tree-change">+{{ file.additions }} −{{ file.deletions }}</span></button>
  <div v-else-if="compact" class="tree-group" role="group"><button type="button" role="treeitem" class="tree-row tree-directory" :style="{ '--depth': depth }" :title="compact.node.path" :aria-expanded="!collapsed.has(compact.node.path)" @click="emit('toggle', compact.node.path)"><span class="tree-symbol"><i :class="collapsed.has(compact.node.path) ? 'bi bi-chevron-right' : 'bi bi-chevron-down'" aria-hidden="true"></i></span><span class="tree-folder-icon"><i class="bi bi-folder" aria-hidden="true"></i></span><span class="tree-name">{{ compact.label }}</span><span class="tree-count">{{ compact.node.count }}</span></button><template v-if="!collapsed.has(compact.node.path)"><ReviewTreeNode v-for="child in compact.node.children" :key="child.path" :node="child" :files="files" :depth="depth + 1" :collapsed="collapsed" :selected-index="selectedIndex" @toggle="emit('toggle', $event)" @select="emit('select', $event)" /></template></div>
</template>

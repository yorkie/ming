<script setup lang="ts">
import { computed, ref } from 'vue';
import { compactDirectory, type FileTreeNode } from '../lib/reviewTree';
import type { FileChange } from '../lib/reviewTypes';
import { t } from '../lib/i18n';
const props = defineProps<{ node: FileTreeNode; files: FileChange[]; commentCounts?: Record<number, number>; depth: number; collapsed: Set<string>; selectedIndex: number | null; large?: boolean; filtering?: boolean }>();
const emit = defineEmits<{ toggle: [path: string]; select: [index: number] }>();
const compact = computed(() => props.node.kind === 'directory' ? compactDirectory(props.node) : null);
const expanded = computed(() => !props.collapsed.has(compact.value?.node.path ?? ''));
const visibleCount = ref(100);
const visibleChildren = computed(() => props.large ? compact.value?.node.children.slice(0, visibleCount.value) ?? [] : compact.value?.node.children ?? []);
const file = computed(() => props.node.kind === 'file' ? props.files[props.node.fileIndex!] : null);
const statusIcons: Record<string, string> = { added: 'file-earmark-plus', deleted: 'file-earmark-minus', renamed: 'file-earmark-diff', binary: 'file-earmark-binary' };
const statusLabels: Record<string, string> = { added: 'Added', deleted: 'Deleted', renamed: 'Renamed', binary: 'Binary' };
const statusIcon = computed(() => statusIcons[file.value?.status ?? ''] ?? 'file-earmark-text');
const statusLabel = computed(() => t(statusLabels[file.value?.status ?? ''] ?? 'Modified'));
function commentsIn(node: FileTreeNode): number { return node.kind === 'file' ? props.commentCounts?.[node.fileIndex!] ?? 0 : node.children.reduce((sum, child) => sum + commentsIn(child), 0); }
</script>
<template>
  <button v-if="node.kind === 'file' && file" type="button" role="treeitem" class="tree-row tree-file" :class="{ selected: selectedIndex === node.fileIndex }" :style="{ '--depth': depth }" :title="`${file.path} · ${statusLabel}`" :aria-label="`${file.path}, ${statusLabel}, ${file.additions} lines added, ${file.deletions} lines deleted, ${commentsIn(node)} ${t('comments')}`" @click="emit('select', node.fileIndex!)"><span class="tree-symbol" :class="`tree-status-${file.status}`"><i :class="`bi bi-${statusIcon}`" aria-hidden="true"></i></span><span class="tree-entry"><span class="tree-name">{{ node.name }}</span><span v-if="commentsIn(node)" class="tree-comment-count" :title="`${commentsIn(node)} ${t('comments')}`"><i class="bi bi-chat-left-text" aria-hidden="true"></i>{{ commentsIn(node) }}</span></span><span class="tree-change"><span class="add">+{{ file.additions }}</span><span class="remove">−{{ file.deletions }}</span></span></button>
  <div v-else-if="compact" class="tree-group" role="group"><button type="button" role="treeitem" class="tree-row tree-directory" :style="{ '--depth': depth }" :title="compact.node.path" :aria-expanded="expanded" @click="emit('toggle', compact.node.path)"><span class="tree-symbol"><i :class="expanded ? 'bi bi-chevron-down' : 'bi bi-chevron-right'" aria-hidden="true"></i></span><span class="tree-folder-icon"><i class="bi bi-folder" aria-hidden="true"></i></span><span class="tree-entry"><span class="tree-name">{{ compact.label }}</span><span v-if="commentsIn(compact.node)" class="tree-comment-count" :title="`${commentsIn(compact.node)} ${t('comments')}`"><i class="bi bi-chat-left-text" aria-hidden="true"></i>{{ commentsIn(compact.node) }}</span></span></button><template v-if="expanded"><ReviewTreeNode v-for="child in visibleChildren" :key="child.path" :node="child" :files="files" :comment-counts="commentCounts" :depth="depth + 1" :collapsed="collapsed" :selected-index="selectedIndex" :large="large" :filtering="filtering" @toggle="emit('toggle', $event)" @select="emit('select', $event)" /><button v-if="large && visibleChildren.length < compact.node.children.length" type="button" class="tree-row tree-more" :style="{ '--depth': depth + 1 }" @click="visibleCount += 100">{{ t('Show more files') }}</button></template></div>
</template>

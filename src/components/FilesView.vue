<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import type { Project } from '../lib/projectStore';
import type { RepositoryInfo } from '../lib/localRepository';
import { resolveProjectAssetPath, type ProjectPath } from '../lib/projectFiles';
import type { GlobalSettings } from '../lib/globalSettings';
import { renderMarkdownDocument } from '../lib/markdownDocument';
import { highlightLines } from '../lib/syntaxHighlight';

const props = defineProps<{ project: Project; gitInfo: RepositoryInfo | null; path: string; data: ProjectPath | null; busy: boolean; error: string; settings: GlobalSettings }>();
const emit = defineEmits<{ navigate: [path: string]; refresh: [] }>();
const root = ref<HTMLElement | null>(null);
const parts = computed(() => props.path ? props.path.split('/') : []);
const directory = computed(() => props.data?.kind === 'directory' ? props.data : null);
const file = computed(() => props.data?.kind === 'file' ? props.data : null);
const fileText = computed(() => file.value?.content.text ?? null);
const markdownFile = computed(() => !!file.value && /\.(md|markdown)$/i.test(file.value.name));
const sourceLines = computed(() => {
  if (!file.value || fileText.value === null || markdownFile.value) return [];
  const lines = fileText.value.replace(/\r\n?/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return props.settings.syntaxHighlighting ? highlightLines(file.value.path, lines) : lines.map(escapeHtml);
});
const readmeHtml = computed(() => directory.value?.readme?.content.text == null ? '' : renderMarkdownDocument(directory.value.readme.content.text));
const fileMarkdownHtml = computed(() => markdownFile.value && fileText.value !== null ? renderMarkdownDocument(fileText.value) : '');
const imageUrls = new Map<string, string>();
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function childPath(name: string) { return [props.path, name].filter(Boolean).join('/'); }
function parentPath(index: number) { return parts.value.slice(0, index + 1).join('/'); }
function clearImages() { for (const url of imageUrls.values()) URL.revokeObjectURL(url); imageUrls.clear(); }
async function hydrateImages() {
  await nextTick();
  const markdownPath = directory.value?.readme ? childPath(directory.value.readme.name) : file.value?.path;
  if (!markdownPath || !root.value) return;
  for (const image of root.value.querySelectorAll<HTMLImageElement>('.markdown-rich-diff img')) {
    const source = image.getAttribute('data-project-src') ?? '';
    const path = resolveProjectAssetPath(markdownPath, source);
    if (!path) continue;
    let url = imageUrls.get(path);
    if (!url) {
      try {
        let handle = props.project.directory;
        const segments = path.split('/');
        for (const segment of segments.slice(0, -1)) handle = await handle.getDirectoryHandle(segment);
        const blob = await (await handle.getFileHandle(segments.at(-1)!)).getFile();
        if (!blob.type.startsWith('image/')) continue;
        url = URL.createObjectURL(blob);
        imageUrls.set(path, url);
      } catch { continue; }
    }
    if (image.isConnected) image.src = url;
  }
}
watch(() => [props.project.id, props.path, props.data, props.settings.showReadmePreview], () => { clearImages(); void hydrateImages(); }, { immediate: true });
onUnmounted(clearImages);
</script>

<template>
  <div ref="root" class="project-files-page">
    <div class="project-files-title"><div><h1>Files</h1><p>Browse the local working tree{{ gitInfo?.currentBranch ? ` on ${gitInfo.currentBranch}` : '' }}.</p></div><button type="button" class="button-outline" @click="emit('refresh')"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Refresh</button></div>
    <nav v-if="parts.length" class="project-files-breadcrumbs" aria-label="File path"><button type="button" @click="emit('navigate', '')">{{ project.name }}</button><template v-for="(part, index) in parts" :key="index"><span aria-hidden="true">/</span><strong v-if="index === parts.length - 1">{{ part }}</strong><button v-else type="button" @click="emit('navigate', parentPath(index))">{{ part }}</button></template></nav>
    <div v-if="busy" class="files-state" role="status"><i class="bi bi-arrow-clockwise icon-spin" aria-hidden="true"></i> Loading files…</div>
    <div v-else-if="error" class="files-state error" role="status">{{ error }}</div>
    <template v-else-if="directory">
      <section class="project-file-list"><div class="project-file-heading project-file-list-heading"><template v-if="directory.path"><i class="bi bi-folder2-open" aria-hidden="true"></i><strong>{{ parts.at(-1) }}</strong></template><div class="project-file-repository-meta"><span class="project-file-branch" title="Current branch"><i class="bi bi-git" aria-hidden="true"></i> {{ gitInfo?.currentBranch ?? 'Detached HEAD' }}</span><span class="project-file-commit" :title="gitInfo?.latestCommit ? `${gitInfo.latestCommit.title} · ${gitInfo.latestCommit.author}` : 'No commits yet'"><i class="bi bi-clock-history" aria-hidden="true"></i><span>{{ gitInfo?.latestCommit?.title ?? 'No commits yet' }}</span><code v-if="gitInfo?.latestCommit">{{ gitInfo.latestCommit.oid.slice(0, 7) }}</code></span></div><span class="project-file-item-count">{{ directory.entries.length }} {{ directory.entries.length === 1 ? 'item' : 'items' }}</span></div>
        <button v-for="entry in directory.entries" :key="entry.name" type="button" class="project-file-row" @click="emit('navigate', childPath(entry.name))"><span class="project-file-icon" :class="`project-file-icon--${entry.kind}`"><i :class="entry.kind === 'directory' ? 'bi bi-folder-fill' : 'bi bi-file-earmark-text'" aria-hidden="true"></i></span><span>{{ entry.name }}</span><i v-if="entry.kind === 'directory'" class="bi bi-chevron-right" aria-hidden="true"></i></button>
        <div v-if="!directory.entries.length" class="files-state">This folder is empty.</div>
      </section>
      <section v-if="settings.showReadmePreview && directory.readme" class="project-readme"><div class="project-file-heading"><i class="bi bi-book" aria-hidden="true"></i><strong>{{ directory.readme.name }}</strong></div><div v-if="directory.readme.content.text === null" class="files-state">{{ directory.readme.content.reason === 'large' ? `README preview is limited to ${settings.filePreviewLimitKb} KB.` : 'README is not UTF-8 text.' }}</div><div v-else v-html="readmeHtml"></div></section>
    </template>
    <section v-else-if="file" class="project-file-preview"><div class="project-file-heading"><i class="bi bi-file-earmark-text" aria-hidden="true"></i><strong>{{ file.name }}</strong><span>Read-only preview</span></div>
      <div v-if="fileText === null" class="files-state">{{ file.content.reason === 'large' ? `File preview is limited to ${settings.filePreviewLimitKb} KB.` : 'Binary or non-UTF-8 file. Preview unavailable.' }}</div>
      <div v-else-if="markdownFile" v-html="fileMarkdownHtml"></div>
      <div v-else-if="!sourceLines.length" class="files-state">This file is empty.</div>
      <div v-else class="project-source"><div v-for="(line, index) in sourceLines" :key="index" class="project-source-row"><span class="project-source-number">{{ index + 1 }}</span><span class="project-source-text code-source" v-html="line"></span></div></div>
    </section>
  </div>
</template>

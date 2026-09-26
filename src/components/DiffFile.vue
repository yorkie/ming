<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, watch } from 'vue';
import { highlightLines } from '../lib/syntaxHighlight';
import { markdownSnapshotForHunks, renderMarkdownRichDiff } from '../lib/markdownRichDiff';
import { cssRuleChanges } from '../lib/cssReview';
import { resolveProjectAssetPath } from '../lib/projectFiles';
import { rememberReview, type Project, type ReviewRecord } from '../lib/projectStore';
import type { GlobalSettings } from '../lib/globalSettings';
import type { MarkdownSnapshot } from '../lib/localRepository';
import type { FileChange, Hunk, Review } from '../lib/reviewTypes';
import { t } from '../lib/i18n';
const props = defineProps<{ file: FileChange; index: number; project: Project; record: ReviewRecord; data: Review; settings: GlobalSettings; selected: boolean; hunkIndices?: number[]; readOnly?: boolean }>();
const expanded = ref(props.settings.expandDiffs);
const snapshot = shallowRef<MarkdownSnapshot | null>(props.file.markdown ?? null);
watch(() => props.file.markdown, value => { if (value) snapshot.value = value; });
const selectedSnapshot = computed(() => snapshot.value ? markdownSnapshotForHunks(snapshot.value, props.file.hunks, props.hunkIndices) : null);
const rich = ref(props.settings.richMarkdownByDefault && !!selectedSnapshot.value && /\.md$/i.test(props.file.path));
const cssMode = ref(true);
const loading = ref(false);
const error = ref('');
const isMarkdown = computed(() => /\.md$/i.test(props.file.path));
const cssChanges = computed(() => /\.css$/i.test(props.file.path) ? cssRuleChanges(props.file.hunks.filter((_, index) => !props.hunkIndices || props.hunkIndices.includes(index))) : []);
const isCss = computed(() => cssChanges.value.length > 0);
const emptyMessage = computed(() => t(({ added: 'Empty file added.', deleted: 'Empty file deleted.', binary: 'Binary files have no text diff.' }[props.file.status] ?? 'No text diff.')));
const statusLabel = computed(() => t(({ added: 'Added', deleted: 'Deleted', renamed: 'Renamed', binary: 'Binary' }[props.file.status] ?? 'Modified')));
const highlightedHunks = computed(() => props.file.hunks.filter((_, index) => !props.hunkIndices || props.hunkIndices.includes(index)).map(hunk => ({ ...hunk, highlighted: props.settings.syntaxHighlighting ? highlightLines(props.file.path, hunk.lines.map(line => line.text)) : hunk.lines.map(line => escapeHtml(line.text)) })));
const shownCounts = computed(() => props.hunkIndices ? {
  additions: highlightedHunks.value.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === 'add').length, 0),
  deletions: highlightedHunks.value.reduce((sum, hunk) => sum + hunk.lines.filter(line => line.kind === 'delete').length, 0),
} : { additions: props.file.additions, deletions: props.file.deletions });
const richHtml = computed(() => selectedSnapshot.value ? renderMarkdownRichDiff(selectedSnapshot.value) : '');
const root = ref<HTMLElement | null>(null);
const imageUrls = new Map<string, string>();
function clearImages() { for (const url of imageUrls.values()) URL.revokeObjectURL(url); imageUrls.clear(); }
async function hydrateImages() {
  await nextTick();
  if (!rich.value || !expanded.value || !root.value) return;
  for (const image of root.value.querySelectorAll<HTMLImageElement>('.markdown-rich-diff img[data-project-src]')) {
    const path = resolveProjectAssetPath(props.file.path, image.getAttribute('data-project-src') ?? '');
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
watch(() => [props.file.path, props.project.id, rich.value, expanded.value, richHtml.value], () => { clearImages(); void hydrateImages(); }, { immediate: true });
onUnmounted(clearImages);
function escapeHtml(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
async function chooseRich() {
  error.value = '';
  if (snapshot.value) {
    if (!selectedSnapshot.value) { error.value = 'This topic’s Markdown change cannot be reconstructed. Use the source diff.'; return; }
    rich.value = true; expanded.value = true; return;
  }
  if (props.readOnly) return;
  if (loading.value) return;
  loading.value = true;
  const worker = new Worker(new URL('../workers/markdownWorker.ts', import.meta.url), { type: 'module' });
  try {
    const response = await new Promise<{ snapshot: MarkdownSnapshot; status: string; hunks: Hunk[] }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: 'done'; snapshot: MarkdownSnapshot; status: string; hunks: Hunk[] } | { type: 'error'; message: string }>) => event.data.type === 'error' ? reject(new Error(event.data.message)) : resolve(event.data);
      worker.onerror = event => reject(new Error(event.message || 'Could not read Markdown'));
      worker.postMessage({ directory: props.project.directory, baseRef: props.record.baseRef, path: props.file.path });
    });
    if (response.status !== props.file.status || JSON.stringify(response.hunks) !== JSON.stringify(props.file.hunks)) throw new Error('The repository no longer matches this review. Scan again to view its Rich diff.');
    if (!markdownSnapshotForHunks(response.snapshot, props.file.hunks, props.hunkIndices)) throw new Error('This topic’s Markdown change cannot be reconstructed. Use the source diff.');
    props.file.markdown = response.snapshot;
    props.record.data = JSON.stringify(props.data);
    await rememberReview(props.record);
    snapshot.value = response.snapshot;
    rich.value = true;
    expanded.value = true;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { worker.terminate(); loading.value = false; }
}
</script>
<template>
  <article ref="root" class="file" :class="{ selected }" :data-file-section="index"><div class="file-header"><button type="button" class="file-toggle" :aria-expanded="expanded" @click="expanded = !expanded"><span class="file-mark"><i :class="expanded ? 'bi bi-chevron-down' : 'bi bi-chevron-right'" aria-hidden="true"></i></span><strong>{{ file.path }}</strong><small>{{ statusLabel }}</small></button><div class="file-header-actions"><span class="file-counts"><b class="add">+{{ shownCounts.additions }}</b><b class="remove">−{{ shownCounts.deletions }}</b></span><div v-if="isCss" class="markdown-mode" role="group" :aria-label="t('CSS view mode')"><button type="button" :class="{ active: cssMode }" :aria-pressed="cssMode" :title="t('Selector view')" @click="cssMode = true"><i class="bi bi-list-nested" aria-hidden="true"></i></button><button type="button" :class="{ active: !cssMode }" :aria-pressed="!cssMode" :title="t('Raw diff')" @click="cssMode = false"><i class="bi bi-code-slash" aria-hidden="true"></i></button></div><div v-if="isMarkdown" class="markdown-mode" role="group" aria-label="Markdown view mode"><button type="button" :class="{ active: !rich }" :aria-pressed="!rich" title="View Markdown source" @click="rich = false"><i class="bi bi-code-slash" aria-hidden="true"></i></button><button type="button" :class="{ active: rich }" :aria-pressed="rich" title="View Rich diff" :disabled="loading || (readOnly && !snapshot)" @click="chooseRich"><i :class="loading ? 'bi bi-arrow-clockwise icon-spin' : 'bi bi-file-earmark-richtext'" aria-hidden="true"></i></button></div></div></div>
    <div v-if="error" class="markdown-error" role="status">{{ error }}</div>
    <template v-if="expanded"><div v-if="rich && selectedSnapshot" v-html="richHtml"></div><div v-else-if="isCss && cssMode" class="css-review"><p>{{ t('Changed CSS rules found in this diff. Use Raw diff for full context.') }}</p><section v-for="rule in cssChanges" :key="rule.selector" class="css-review-rule"><header><code>{{ rule.selector }}</code><span>{{ t(rule.kind === 'added' ? 'Added' : rule.kind === 'removed' ? 'Deleted' : 'Modified') }}</span></header><div v-for="(value, index) in rule.before" :key="`old-${index}`" class="css-review-declaration delete">− {{ value }};</div><div v-for="(value, index) in rule.after" :key="`new-${index}`" class="css-review-declaration add">+ {{ value }};</div></section></div><template v-else-if="highlightedHunks.length"><div v-for="(hunk, hunkIndex) in highlightedHunks" :key="hunkIndex" class="hunk"><div class="hunk-header">{{ hunk.header }}</div><div class="code"><div v-for="(line, lineIndex) in hunk.lines" :key="lineIndex" class="code-line" :class="line.kind"><span class="line-number">{{ line.oldNumber ?? '' }}</span><span class="line-number">{{ line.newNumber ?? '' }}</span><span class="code-text"><span class="line-marker">{{ line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ' ' }}</span><span class="code-source" v-html="hunk.highlighted[lineIndex]"></span></span></div></div></div></template><div v-else class="file-empty">{{ emptyMessage }}</div></template>
  </article>
</template>

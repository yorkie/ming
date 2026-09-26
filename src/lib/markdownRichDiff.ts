import MarkdownIt from 'markdown-it';
import { diffArrays } from 'diff';
import type { MarkdownSnapshot } from './localRepository';
import type { Hunk } from './reviewTypes';
import { sanitizeMarkdownHtml } from './markdownDocument';

const markdown = new MarkdownIt({ html: true, linkify: false, maxNesting: 20 });
markdown.renderer.rules.link_open = (tokens, index) => {
  const href = String(tokens[index].attrGet('href') ?? '');
  return `<span class="markdown-link" title="${markdown.utils.escapeHtml(href)}">`;
};
markdown.renderer.rules.link_close = () => '</span>';

function blocks(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return markdown.parse(source, {})
    .filter(token => token.level === 0 && token.map && token.nesting !== -1)
    .map(token => lines.slice(token.map![0], token.map![1]).join('\n'));
}

export function markdownSnapshotForHunks(snapshot: MarkdownSnapshot, hunks: Hunk[], indices?: number[]): MarkdownSnapshot | null {
  if (!indices || !hunks.length) return snapshot;
  const selected = [...new Set(indices)].sort((a, b) => a - b);
  if (selected.some(index => !Number.isInteger(index) || index < 0 || index >= hunks.length)) return null;
  if (selected.length === hunks.length) return snapshot;
  const before = snapshot.before.replace(/\r\n?/g, '\n');
  const originalLines = before.endsWith('\n') ? before.slice(0, -1).split('\n') : before ? before.split('\n') : [];
  const afterLines = [...originalLines];
  let offset = 0;
  let touchesEnd = false;
  for (const index of selected) {
    const hunk = hunks[index]!;
    const oldLines = hunk.lines.filter(line => line.kind !== 'add').map(line => line.text);
    const newLines = hunk.lines.filter(line => line.kind !== 'delete').map(line => line.text);
    const start = hunk.lines.find(line => line.oldNumber !== null)?.oldNumber;
    const headerStart = /^@@ -(\d+)/.exec(hunk.header)?.[1];
    const oldIndex = start !== undefined && start !== null ? start - 1 : headerStart === undefined ? -1 : Number(headerStart);
    if (oldIndex < 0 || oldIndex + oldLines.length > originalLines.length ||
      oldLines.some((line, lineIndex) => originalLines[oldIndex + lineIndex] !== line)) return null;
    afterLines.splice(oldIndex + offset, oldLines.length, ...newLines);
    offset += newLines.length - oldLines.length;
    touchesEnd ||= oldIndex + oldLines.length === originalLines.length;
  }
  const endsWithNewline = touchesEnd ? snapshot.after.endsWith('\n') : before.endsWith('\n');
  return { before, after: afterLines.join('\n') + (endsWithNewline && afterLines.length ? '\n' : '') };
}

export function renderMarkdownRichDiff(snapshot: MarkdownSnapshot): string {
  const before = blocks(snapshot.before);
  const after = blocks(snapshot.after);
  const parts = diffArrays(before, after);
  return `<div class="markdown-rich-diff">${parts.map(part => {
    const kind = part.added ? 'add' : part.removed ? 'delete' : 'context';
    return part.value.map(source => `<div class="markdown-rich-block ${kind}">${sanitizeMarkdownHtml(markdown.render(source), true)}</div>`).join('');
  }).join('')}</div>`;
}

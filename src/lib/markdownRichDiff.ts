import MarkdownIt from 'markdown-it';
import { diffArrays } from 'diff';
import type { MarkdownSnapshot } from './localRepository';

const markdown = new MarkdownIt({ html: false, linkify: false, maxNesting: 20 });
markdown.renderer.rules.link_open = (tokens, index) => {
  const href = String(tokens[index].attrGet('href') ?? '');
  return `<span class="markdown-link" title="${markdown.utils.escapeHtml(href)}">`;
};
markdown.renderer.rules.link_close = () => '</span>';
markdown.renderer.rules.image = (tokens, index) => {
  const alt = tokens[index].content || 'image';
  return `<span class="markdown-image">[Image: ${markdown.utils.escapeHtml(alt)}]</span>`;
};

function blocks(source: string): string[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return markdown.parse(source, {})
    .filter(token => token.level === 0 && token.map && token.nesting !== -1)
    .map(token => lines.slice(token.map![0], token.map![1]).join('\n'));
}

export function renderMarkdownRichDiff(snapshot: MarkdownSnapshot): string {
  const before = blocks(snapshot.before);
  const after = blocks(snapshot.after);
  const parts = diffArrays(before, after);
  return `<div class="markdown-rich-diff">${parts.map(part => {
    const kind = part.added ? 'add' : part.removed ? 'delete' : 'context';
    return part.value.map(source => `<div class="markdown-rich-block ${kind}">${markdown.render(source)}</div>`).join('');
  }).join('')}</div>`;
}

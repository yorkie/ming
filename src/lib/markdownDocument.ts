import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const documentMarkdown = new MarkdownIt({ html: true, linkify: false, maxNesting: 20 });

export function renderMarkdownDocument(source: string): string {
  const html = sanitizeHtml(documentMarkdown.render(source), {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['align'],
      a: ['href', 'name', 'target', 'title'],
      img: ['src', 'data-project-src', 'alt', 'title', 'width', 'height'],
      td: ['align', 'colspan', 'rowspan'],
      th: ['align', 'colspan', 'rowspan'],
    },
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: {
      img: (tagName, attributes) => {
        const src = attributes.src ?? '';
        if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return { tagName, attribs: attributes };
        const { src: _src, ...remaining } = attributes;
        return { tagName, attribs: { ...remaining, 'data-project-src': src } };
      },
    },
  });
  return `<div class="markdown-rich-diff">${html}</div>`;
}

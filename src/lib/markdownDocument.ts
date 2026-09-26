import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';

const documentMarkdown = new MarkdownIt({ html: true, linkify: false, maxNesting: 20 });
const inlineMarkdown = new MarkdownIt({ html: false, linkify: false, maxNesting: 10 });

export function renderMarkdownInline(source: string): string {
  return sanitizeHtml(inlineMarkdown.renderInline(source), {
    allowedTags: ['a', 'br', 'code', 'em', 's', 'strong'],
    allowedAttributes: { a: ['href', 'title'] },
  });
}

export function renderTopicSummary(source: string): string {
  let content = source.trim();
  if (content.length > 240 && !content.includes('\n')) {
    content = content.replace(/([^\n])(?=(?:数据层|逻辑层|测试层|界面层|调用层)[:：])/g, '$1\n\n')
      .replace(/([；;])\s*/g, '$1\n\n');
  }
  return sanitizeHtml(inlineMarkdown.render(content), {
    allowedTags: ['p', 'ul', 'ol', 'li', 'br', 'code', 'em', 's', 'strong'],
    allowedAttributes: {},
  });
}

export function sanitizeMarkdownHtml(html: string, localImagesOnly = false): string {
  return sanitizeHtml(html, {
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
        if (localImagesOnly && (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src))) {
          return { tagName: 'span', attribs: { class: 'markdown-image' }, text: `[Image: ${attributes.alt || 'image'}]` };
        }
        if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) return { tagName, attribs: attributes };
        const { src: _src, ...remaining } = attributes;
        return { tagName, attribs: { ...remaining, 'data-project-src': src } };
      },
    },
  });
}

export function renderMarkdownDocument(source: string): string {
  return `<div class="markdown-rich-diff">${sanitizeMarkdownHtml(documentMarkdown.render(source))}</div>`;
}

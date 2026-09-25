import { strict as assert } from 'node:assert';
import { renderMarkdownRichDiff } from '../src/lib/markdownRichDiff';
import { renderMarkdownDocument, renderMarkdownInline } from '../src/lib/markdownDocument';

const rich = renderMarkdownRichDiff({
  before: '# Guide\n\nOld paragraph.\n',
  after: '# Guide\n\nNew **paragraph**.\n',
});
assert.match(rich, /markdown-rich-block context"><h1>Guide<\/h1>/);
assert.match(rich, /markdown-rich-block delete"><p>Old paragraph\.<\/p>/);
assert.match(rich, /markdown-rich-block add"><p>New <strong>paragraph<\/strong>\.<\/p>/);

const unsafe = renderMarkdownRichDiff({ before: '', after: '<script>alert(1)</script>\n\n![remote](https://example.com/image.png)\n' });
assert.doesNotMatch(unsafe, /<script>|<img/);
assert.match(unsafe, /&lt;script&gt;/);
const document = renderMarkdownDocument('<div align="center"><img src="./logo.png" alt="Logo" width="320" /><p><strong>Title</strong></p><table><tr><td>Package</td></tr></table></div>');
assert.match(document, /<div align="center">/);
assert.match(document, /<img[^>]+data-project-src="\.\/logo\.png"/);
assert.match(document, /<table>/);
assert.doesNotMatch(renderMarkdownDocument('<script>alert(1)</script><a href="javascript:alert(1)">bad</a>'), /<script|href="javascript:/);
assert.match(renderMarkdownInline('Check `npm run build` and **routing**.'), /<code>npm run build<\/code>.*<strong>routing<\/strong>/);
assert.doesNotMatch(renderMarkdownInline('<img src="https://example.com/x" onerror="alert(1)"> [bad](javascript:alert(1))'), /<img|href="javascript:/);
console.log('Markdown rich diff test passed');

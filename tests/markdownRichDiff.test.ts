import { strict as assert } from 'node:assert';
import { markdownSnapshotForHunks, renderMarkdownRichDiff } from '../src/lib/markdownRichDiff';
import { renderMarkdownDocument, renderMarkdownInline, renderTopicSummary } from '../src/lib/markdownDocument';

const rich = renderMarkdownRichDiff({
  before: '# Guide\n\nOld paragraph.\n',
  after: '# Guide\n\nNew **paragraph**.\n',
});
assert.match(rich, /markdown-rich-block context"><h1>Guide<\/h1>/);
assert.match(rich, /markdown-rich-block delete"><p>Old paragraph\.<\/p>/);
assert.match(rich, /markdown-rich-block add"><p>New <strong>paragraph<\/strong>\.<\/p>/);

const snapshot = { before: '# Guide\n\nOld first.\n\nSame.\n\nOld second.\n', after: '# Guide\n\nNew first.\n\nSame.\n\nNew second.\n' };
const hunks = [
  { header: '@@ -3 +3 @@', lines: [
    { kind: 'delete' as const, text: 'Old first.', oldNumber: 3, newNumber: null },
    { kind: 'add' as const, text: 'New first.', oldNumber: null, newNumber: 3 },
  ] },
  { header: '@@ -7 +7 @@', lines: [
    { kind: 'delete' as const, text: 'Old second.', oldNumber: 7, newNumber: null },
    { kind: 'add' as const, text: 'New second.', oldNumber: null, newNumber: 7 },
  ] },
];
const firstTopic = markdownSnapshotForHunks(snapshot, hunks, [0]);
assert.equal(firstTopic?.after, '# Guide\n\nNew first.\n\nSame.\n\nOld second.\n');
assert.doesNotMatch(renderMarkdownRichDiff(firstTopic!), /New second/);
assert.equal(markdownSnapshotForHunks(snapshot, hunks, [1])?.after, '# Guide\n\nOld first.\n\nSame.\n\nNew second.\n');
assert.equal(markdownSnapshotForHunks(snapshot, hunks, [0, 1]), snapshot);
assert.equal(markdownSnapshotForHunks(snapshot, hunks, [2]), null);

const unsafe = renderMarkdownRichDiff({ before: '', after: '<script>alert(1)</script>\n\n![remote](https://example.com/image.png)\n' });
assert.doesNotMatch(unsafe, /<script>|<img/);
assert.doesNotMatch(unsafe, /alert\(1\)/);
assert.match(unsafe, /\[Image: remote\]/);
const imageDiff = renderMarkdownRichDiff({ before: '', after: '<img src="public/logo.png" alt="Ming logo" width="180" onerror="alert(1)" />\n\n![Icon](./icon.png)\n' });
assert.match(imageDiff, /<img[^>]+data-project-src="public\/logo\.png"/);
assert.match(imageDiff, /<img[^>]+width="180"/);
assert.match(imageDiff, /<img[^>]+data-project-src="\.\/icon\.png"/);
assert.doesNotMatch(imageDiff, /onerror|\s+src="public\/logo\.png"/);
const document = renderMarkdownDocument('<div align="center"><img src="./logo.png" alt="Logo" width="320" /><p><strong>Title</strong></p><table><tr><td>Package</td></tr></table></div>');
assert.match(document, /<div align="center">/);
assert.match(document, /<img[^>]+data-project-src="\.\/logo\.png"/);
assert.match(document, /<table>/);
assert.doesNotMatch(renderMarkdownDocument('<script>alert(1)</script><a href="javascript:alert(1)">bad</a>'), /<script|href="javascript:/);
assert.match(renderMarkdownInline('Check `npm run build` and **routing**.'), /<code>npm run build<\/code>.*<strong>routing<\/strong>/);
assert.doesNotMatch(renderMarkdownInline('<img src="https://example.com/x" onerror="alert(1)"> [bad](javascript:alert(1))'), /<img|href="javascript:/);
assert.match(renderTopicSummary('- Main behavior changes.\n- Tests cover the new path.'), /<ul>\s*<li>Main behavior changes\.<\/li>\s*<li>Tests cover the new path\.<\/li>\s*<\/ul>/);
const legacySummary = `修改核心行为。数据层：${'状态字段。'.repeat(60)}逻辑层：调用新工具；测试层：新增测试。`;
assert.match(renderTopicSummary(legacySummary), /<p>修改核心行为。<\/p>\s*<p>数据层：/);
assert.match(renderTopicSummary(legacySummary), /<p>逻辑层：调用新工具；<\/p>/);
assert.doesNotMatch(renderTopicSummary('- <script>alert(1)</script>'), /<script>/);
console.log('Markdown rich diff test passed');

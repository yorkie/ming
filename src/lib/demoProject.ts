import type { Review } from './reviewTypes';
import type { ProjectPath } from './projectFiles';
import type { ReviewRecord } from './projectStore';
import type { RepositoryInfo, CommitHistory } from './localRepository';
import type { Language } from './i18n';

const readme = `# Welcome to the demo

Discounts now have a floor of zero.
Check whether that matches your product rules.

This small shopping cart shows how Ming presents a repository.

1. Browse the files.
2. Compare the changed code in Reviews.
3. Check each topic and mark your decision.

The example stays in your browser and uses no API key.
`;
const source = `export function total(prices: number[], discount = 0) {
  const subtotal = prices.reduce((sum, price) => sum + price, 0);
  const safeDiscount = Math.max(0, discount);
  return Math.max(0, subtotal - safeDiscount);
}
`;
const file = (path: string, text: string): ProjectPath => ({ kind: 'file', path, name: path.split('/').at(-1)!, content: { text, reason: null, size: new TextEncoder().encode(text).length } });
export const demoFiles: Record<string, ProjectPath> = {
  '': { kind: 'directory', path: '', entries: [{ name: 'src', kind: 'directory' }, { name: 'README.md', kind: 'file' }], readme: { name: 'README.md', content: { text: readme, reason: null, size: readme.length } } },
  src: { kind: 'directory', path: 'src', entries: [{ name: 'cart.ts', kind: 'file' }], readme: null },
  'README.md': file('README.md', readme),
  'src/cart.ts': file('src/cart.ts', source),
};

export const demoRepository: RepositoryInfo = { currentBranch: 'feature/discount', branches: ['main', 'feature/discount'], headOid: null, latestCommit: null };

export const demoReview: Review = {
  additions: 4, deletions: 1,
  files: [
    { path: 'src/cart.ts', status: 'modified', additions: 2, deletions: 1, hunks: [{ header: '@@ -1,4 +1,5 @@', lines: [
      { kind: 'context', text: 'export function total(prices: number[], discount = 0) {', oldNumber: 1, newNumber: 1 },
      { kind: 'context', text: '  const subtotal = prices.reduce((sum, price) => sum + price, 0);', oldNumber: 2, newNumber: 2 },
      { kind: 'delete', text: '  return subtotal;', oldNumber: 3, newNumber: null },
      { kind: 'add', text: '  const safeDiscount = Math.max(0, discount);', oldNumber: null, newNumber: 3 },
      { kind: 'add', text: '  return Math.max(0, subtotal - safeDiscount);', oldNumber: null, newNumber: 4 },
      { kind: 'context', text: '}', oldNumber: 4, newNumber: 5 },
    ] }] },
    { path: 'README.md', status: 'modified', additions: 2, deletions: 0, hunks: [{ header: '@@ -1 +1,3 @@', lines: [
      { kind: 'context', text: '# Welcome to the demo', oldNumber: 1, newNumber: 1 },
      { kind: 'add', text: 'Discounts now have a floor of zero.', oldNumber: null, newNumber: 2 },
      { kind: 'add', text: 'Check whether that matches your product rules.', oldNumber: null, newNumber: 3 },
    ] }] },
  ],
};

export function createDemoReview(language: Language): ReviewRecord {
  const zh = language === 'zh-CN';
  const data = JSON.stringify(demoReview);
  return { id: 'demo-review', projectId: 'demo-project', createdAt: Date.now(), branch: 'feature/discount', baseRef: 'main', title: zh ? '折扣边界与使用说明' : 'Discount boundaries and guidance', fileCount: 2, data, snapshotHash: 'demo-snapshot',
    aiReview: { createdAt: Date.now(), sourceData: data, reviewed: {}, artifact: { schemaVersion: 1, snapshotHash: 'demo-snapshot', model: 'sample', topics: [
      { id: 'discount', title: zh ? '检查折扣边界' : 'Check discount boundaries', summary: zh ? '示例改动会把负折扣归零，并让合计金额不低于零。' : 'The sample change clamps negative discounts and keeps the total at or above zero.', checks: [zh ? '负折扣应当被忽略吗？' : 'Should a negative discount be ignored?', zh ? '折扣超过小计时，返回零是否符合业务规则？' : 'Should a discount above the subtotal return zero?'], unitIds: ['f0h0'] },
      { id: 'docs', title: zh ? '核对使用说明' : 'Check the guidance', summary: zh ? 'README 中新增了折扣行为说明。' : 'The README adds a description of the discount behavior.', checks: [zh ? '说明是否与代码行为一致？' : 'Does the guidance match the code?'], unitIds: ['f1h0'] },
    ] } },
  };
}

export const demoCommits: CommitHistory = { localRef: 'HEAD', remoteRef: 'origin/main', localOnly: [{ oid: '1234567890abcdef', title: 'Add discount handling', author: 'Ming Demo', timestamp: Math.floor(Date.now() / 1000) - 3600 }], remoteOnly: [], limit: 50 };

import { strict as assert } from 'node:assert';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createServer } from 'vite';
import { defaultGlobalSettings } from '../src/lib/globalSettings';
import type { Project, ReviewRecord } from '../src/lib/projectStore';
import type { Review } from '../src/lib/reviewTypes';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { setLanguage } = await server.ssrLoadModule('/src/lib/i18n.ts');
  const { default: FilesView } = await server.ssrLoadModule('/src/components/FilesView.vue');
  const { default: ReviewsView } = await server.ssrLoadModule('/src/components/ReviewsView.vue');
  const { default: TopicReviewView } = await server.ssrLoadModule('/src/components/TopicReviewView.vue');
  const project: Project = { id: 'project-1', name: 'sample', directory: {} as FileSystemDirectoryHandle, addedAt: 1, settings: { baseRef: 'HEAD' } };
  const filesHtml = await renderToString(createSSRApp(FilesView, {
    project, gitInfo: null, path: '', busy: false, error: '', settings: defaultGlobalSettings,
    data: { kind: 'directory', path: '', entries: [{ name: 'src', kind: 'directory' }, { name: 'README.md', kind: 'file' }], readme: { name: 'README.md', content: { text: '# Sample\n', reason: null, size: 9 } } },
  }));
  assert.match(filesHtml, /project-file-row/);
  assert.match(filesHtml, /README\.md/);
  assert.match(filesHtml, /<h1>Sample<\/h1>/);

  const data: Review = { files: [{ path: 'src/main.ts', status: 'modified', additions: 1, deletions: 0, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'add', text: 'const value = 1;', oldNumber: null, newNumber: 1 }] }] }], additions: 1, deletions: 0 };
  const record: ReviewRecord = { id: 'review-1', projectId: project.id, createdAt: 1, branch: 'main', baseRef: 'HEAD', data: JSON.stringify(data) };
  const reviewsHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [record], record, data, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(reviewsHtml, /src\/main\.ts/);
  assert.match(reviewsHtml, /const/);
  assert.match(reviewsHtml, /Changed files/);
  assert.match(reviewsHtml, /Review pairs/);
  const topicRecord: ReviewRecord = { ...record, aiReview: { createdAt: 2, reviewed: {}, artifact: {
    schemaVersion: 1, snapshotHash: 'sample', model: 'deepseek-flash',
    topics: [{ id: 'topic-1', title: 'Update main', summary: 'Changes the main value.', checks: ['Check callers.'], unitIds: ['f0h0'] }],
  } } };
  const topicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: topicRecord, data, settings: defaultGlobalSettings }));
  assert.match(topicHtml, /Update main/);
  assert.match(topicHtml, /code-source/);
  assert.match(topicHtml, /value/);
  assert.match(topicHtml, /Mark reviewed/);
  setLanguage('zh-CN');
  const chineseTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: topicRecord, data, settings: defaultGlobalSettings }));
  assert.match(chineseTopicHtml, /标记已评审/);
  const chineseReviewsHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [record], record, data, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(chineseReviewsHtml, /改动文件/);
  assert.match(chineseReviewsHtml, /分支评审/);
  setLanguage('en');
  console.log('Vue view rendering test passed');
} finally {
  await server.close();
}

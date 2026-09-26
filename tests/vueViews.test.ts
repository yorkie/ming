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
  const { default: ReviewTreeNode } = await server.ssrLoadModule('/src/components/ReviewTreeNode.vue');
  const { default: TopicReviewView } = await server.ssrLoadModule('/src/components/TopicReviewView.vue');
  const { default: AiGenerationProgress } = await server.ssrLoadModule('/src/components/AiGenerationProgress.vue');
  const { default: ProjectSettingsView } = await server.ssrLoadModule('/src/components/ProjectSettingsView.vue');
  const project: Project = { id: 'project-1', name: 'sample', directory: {} as FileSystemDirectoryHandle, addedAt: 1, settings: { baseRef: 'HEAD' } };
  const projectSettingsHtml = await renderToString(createSSRApp(ProjectSettingsView, { project, gitInfo: null }));
  assert.match(projectSettingsHtml, /Live review updates/);
  assert.doesNotMatch(projectSettingsHtml, /Generate topics for live updates/);
  assert.match(projectSettingsHtml, /aria-label="Live review updates" aria-checked="true"/);
  const filesHtml = await renderToString(createSSRApp(FilesView, {
    project, gitInfo: null, path: '', busy: false, error: '', settings: defaultGlobalSettings,
    data: { kind: 'directory', path: '', entries: [{ name: 'src', kind: 'directory' }, { name: 'README.md', kind: 'file' }], readme: { name: 'README.md', content: { text: '# Sample\n', reason: null, size: 9 } } },
  }));
  assert.match(filesHtml, /project-file-row/);
  assert.match(filesHtml, /README\.md/);
  assert.match(filesHtml, /<h1>Sample<\/h1>/);

  const data: Review = { files: [{ path: 'src/main.ts', status: 'modified', additions: 1, deletions: 0, hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'add', text: 'const value = 1;', oldNumber: null, newNumber: 1 }] }] }], additions: 1, deletions: 0 };
  const record: ReviewRecord = { id: 'review-1', projectId: project.id, createdAt: 1, branch: 'main', baseRef: 'HEAD', data: JSON.stringify(data) };
  const activityHtml = await renderToString(createSSRApp(AiGenerationProgress, { busy: true, progress: 'Reading changes', completed: 1, total: 2,
    activity: [{ id: 1, at: Date.now() - 330_000, kind: 'tool', title: 'Read changes', detail: 'src/main.ts <script>' }] }));
  assert.match(activityHtml, /Show work log/);
  assert.match(activityHtml, /Working for 5m 30s/);
  assert.match(activityHtml, /Read changes/);
  assert.match(activityHtml, /src\/main\.ts &lt;script&gt;/);
  assert.doesNotMatch(activityHtml, /src\/main\.ts <script>/);
  assert.match(activityHtml, /Show 1 tool call/);
  assert.match(activityHtml, /role="progressbar"[^>]*aria-valuenow="1"/);
  assert.match(activityHtml, /class="ai-progress-fill" style="width:50%;"/);
  assert.doesNotMatch(activityHtml, /<details class="ai-activity" open/);
  const startingActivityHtml = await renderToString(createSSRApp(AiGenerationProgress, { busy: true, completed: 0, total: 2 }));
  assert.match(startingActivityHtml, /ai-progress-track is-indeterminate/);
  assert.doesNotMatch(startingActivityHtml, /aria-valuenow/);
  const noReviewProgressHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [], record: null, data: null, reviewView: 'topics', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: true, aiProgress: 'Reading changes', aiCompleted: 1, aiTotal: 2, aiConfigured: true,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(noReviewProgressHtml, /ai-review-progress/);
  assert.match(noReviewProgressHtml, /role="progressbar"[^>]*aria-valuenow="1"/);
  const finishedActivityHtml = await renderToString(createSSRApp(AiGenerationProgress, { busy: false,
    activity: [{ id: 2, at: 1_700_000_000_000, kind: 'done', title: 'Topic generation complete' }] }));
  assert.match(finishedActivityHtml, /Change topics are ready/);
  assert.match(finishedActivityHtml, /Worked for 0s/);
  assert.match(finishedActivityHtml, /Work log/);
  assert.doesNotMatch(finishedActivityHtml, /Work in progress/);
  assert.doesNotMatch(finishedActivityHtml, /role="progressbar"/);
  assert.doesNotMatch(finishedActivityHtml, /<button/);
  const reviewsHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [record], record, data, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(reviewsHtml, /src\/main\.ts/);
  assert.match(reviewsHtml, /const/);
  assert.match(reviewsHtml, /Changed files/);
  assert.match(reviewsHtml, /Review pairs/);
  const scanningReviewsHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [record], record, data, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: true, scanProgress: 'Checking local changes', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(scanningReviewsHtml, /src\/main\.ts/, 'A scan should keep the current review visible.');
  assert.doesNotMatch(scanningReviewsHtml, /Scanning working tree/, 'A fast scan should not flash the progress panel.');
  const manyFilesData: Review = { files: Array.from({ length: 120 }, (_, index) => ({
    path: `file-${String(index).padStart(3, '0')}.txt`, status: 'modified', additions: 0, deletions: 0, hunks: [],
  })), additions: 0, deletions: 0 };
  const manyFilesHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [record], record, data: manyFilesData, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(manyFilesHtml, /file-000\.txt/);
  assert.doesNotMatch(manyFilesHtml, /file-119\.txt/);
  assert.match(manyFilesHtml, /Show more files/);
  const directoryHtml = await renderToString(createSSRApp(ReviewTreeNode, {
    node: { name: 'src', path: 'src', kind: 'directory', count: 120, children: [
      { name: 'a.ts', path: 'src/a.ts', kind: 'file', count: 1, children: [], fileIndex: 0 },
    ] }, files: manyFilesData.files, depth: 0, collapsed: new Set(), selectedIndex: null, large: true,
  }));
  assert.match(directoryHtml, /tree-directory/);
  assert.match(directoryHtml, /aria-expanded="true"/);
  const titledReviewsHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [{ ...record, title: 'Add task status panel' }], record, data, reviewView: 'changes', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(titledReviewsHtml, /Add task status panel/);
  const topicRecord: ReviewRecord = { ...record, aiReview: { createdAt: 2, reviewed: {}, artifact: {
    schemaVersion: 1, snapshotHash: 'sample', model: 'deepseek-flash',
    topics: [{ id: 'topic-1', title: 'Update main', summary: 'Changes the main value.', checks: ['Check callers.'], unitIds: ['f0h0'] }],
  } } };
  const topicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: topicRecord, data, settings: defaultGlobalSettings }));
  assert.match(topicHtml, /Update main/);
  assert.match(topicHtml, /code-source/);
  assert.match(topicHtml, /value/);
  assert.match(topicHtml, /Mark reviewed/);
  const structuredTopicRecord: ReviewRecord = { ...topicRecord, aiReview: { ...topicRecord.aiReview!, artifact: {
    ...topicRecord.aiReview!.artifact, topics: [{ ...topicRecord.aiReview!.artifact.topics[0], summary: '- Explain the behavior.\n- Cover the test path.' }],
  } } };
  const structuredTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: structuredTopicRecord, data, settings: defaultGlobalSettings }));
  assert.match(structuredTopicHtml, /class="topic-summary"[^>]*><ul>/);
  assert.match(structuredTopicHtml, /<li>Cover the test path\.<\/li>/);
  const longTopicRecord: ReviewRecord = { ...topicRecord, aiReview: { ...topicRecord.aiReview!, artifact: {
    ...topicRecord.aiReview!.artifact, topics: [{ ...topicRecord.aiReview!.artifact.topics[0], summary: `Purpose. ${'Detailed change. '.repeat(30)}` }],
  } } };
  const longTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: longTopicRecord, data, settings: defaultGlobalSettings }));
  assert.match(longTopicHtml, /class="[^"]*is-collapsed[^"]*topic-summary"/);
  assert.match(longTopicHtml, /Show full summary/);
  const reviewedTopicRecord: ReviewRecord = { ...topicRecord, aiReview: { ...topicRecord.aiReview!, reviewed: { 'topic-1': 'reviewed' } } };
  const reviewedTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: reviewedTopicRecord, data, settings: defaultGlobalSettings }));
  assert.match(reviewedTopicHtml, /class="[^"]*reviewed[^"]*topic-list-item"/);
  assert.match(reviewedTopicHtml, /class="topic-status">Reviewed/);
  assert.match(reviewedTopicHtml, /Mark as unread/);
  const markdownData: Review = { files: [{
    path: 'README.md', status: 'modified', additions: 2, deletions: 2,
    markdown: { before: '# Guide\n\nOld first.\n\nSame.\n\nOld second.\n', after: '# Guide\n\nNew first.\n\nSame.\n\nNew second.\n' },
    hunks: [
      { header: '@@ -3 +3 @@', lines: [
        { kind: 'delete', text: 'Old first.', oldNumber: 3, newNumber: null },
        { kind: 'add', text: 'New first.', oldNumber: null, newNumber: 3 },
      ] },
      { header: '@@ -7 +7 @@', lines: [
        { kind: 'delete', text: 'Old second.', oldNumber: 7, newNumber: null },
        { kind: 'add', text: 'New second.', oldNumber: null, newNumber: 7 },
      ] },
    ],
  }], additions: 2, deletions: 2 };
  const markdownRecord: ReviewRecord = { ...record, id: 'review-md', snapshotHash: 'markdown', data: JSON.stringify(markdownData), aiReview: {
    createdAt: 2, reviewed: {}, artifact: { schemaVersion: 1, snapshotHash: 'markdown', model: 'deepseek-flash',
      topics: [{ id: 'topic-md', title: 'Update first section', summary: 'Update Markdown.', checks: [], unitIds: ['f0h0'] }] },
  } };
  const markdownSettings = { ...defaultGlobalSettings, richMarkdownByDefault: true };
  const markdownChangesHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [markdownRecord], record: markdownRecord, data: markdownData, reviewView: 'changes', settings: markdownSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  const markdownTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: markdownRecord, data: markdownData, settings: markdownSettings }));
  assert.match(markdownChangesHtml, /View Rich diff/);
  assert.match(markdownTopicHtml, /View Rich diff/);
  assert.match(markdownChangesHtml, /markdown-rich-diff/);
  assert.match(markdownTopicHtml, /markdown-rich-diff/);
  assert.match(markdownChangesHtml, /New second\./);
  assert.doesNotMatch(markdownTopicHtml, /New second\./);
  assert.match(markdownTopicHtml, /New first\./);
  const cssData: Review = { files: [{ path: 'theme.css', status: 'modified', additions: 1, deletions: 1,
    hunks: [{ header: '@@ -1 +1 @@', lines: [
      { kind: 'delete', text: '.title { color: red; }', oldNumber: 1, newNumber: null },
      { kind: 'add', text: '.title { color: blue; }', oldNumber: null, newNumber: 1 },
    ] }] }], additions: 1, deletions: 1 };
  const cssRecord: ReviewRecord = { ...markdownRecord, id: 'review-css', data: JSON.stringify(cssData) };
  const cssChangesHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [cssRecord], record: cssRecord, data: cssData, reviewView: 'changes', settings: markdownSettings,
    scanBusy: false, scanProgress: '', aiBusy: false, aiProgress: '', aiCompleted: 0, aiTotal: 0, aiConfigured: false,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  const cssTopicHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: cssRecord, data: cssData, settings: markdownSettings }));
  assert.match(cssChangesHtml, /Selector view/);
  assert.match(cssTopicHtml, /Selector view/);
  assert.match(cssChangesHtml, /css-review-rule/);
  assert.match(cssTopicHtml, /css-review-rule/);
  assert.doesNotMatch(topicHtml, /View Rich diff|Selector view/);
  const latestData: Review = { ...data, files: [{ ...data.files[0]!, path: 'src/new.ts' }] };
  const staleRecord: ReviewRecord = { ...topicRecord, data: JSON.stringify(latestData), snapshotHash: 'new-snapshot',
    aiReview: { ...topicRecord.aiReview!, sourceData: JSON.stringify(data) } };
  const staleHtml = await renderToString(createSSRApp(TopicReviewView, { project, record: staleRecord, data: latestData, settings: defaultGlobalSettings }));
  assert.match(staleHtml, /Topics are out of date/);
  assert.match(staleHtml, /topic-stale-action/);
  assert.match(staleHtml, /is-stale/);
  assert.match(staleHtml, /src\/main\.ts/);
  assert.doesNotMatch(staleHtml, /src\/new\.ts/);
  assert.doesNotMatch(staleHtml, /Mark reviewed/);
  const generatingHtml = await renderToString(createSSRApp(TopicReviewView, {
    project, record: staleRecord, data: latestData, settings: defaultGlobalSettings,
    aiBusy: true, aiProgress: 'Analyzing group 2 of 3', aiCompleted: 1, aiTotal: 3,
  }));
  assert.match(generatingHtml, /Analyzing group 2 of 3/);
  assert.match(generatingHtml, /role="progressbar"/);
  assert.match(generatingHtml, /Update main/);
  assert.match(generatingHtml, /src\/main\.ts/);
  const generatingReviewHtml = await renderToString(createSSRApp(ReviewsView, {
    project, reviews: [staleRecord], record: staleRecord, data: latestData, reviewView: 'topics', settings: defaultGlobalSettings,
    scanBusy: false, scanProgress: '', aiBusy: true, aiProgress: 'Analyzing group 2 of 3', aiCompleted: 1, aiTotal: 3, aiConfigured: true,
    commitHistory: null, commitsBusy: false, commitsError: '',
  }));
  assert.match(generatingReviewHtml, /Update main/);
  assert.match(generatingReviewHtml, /Analyzing group 2 of 3/);
  assert.doesNotMatch(generatingReviewHtml, /scan-progress ai-review-progress/);
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

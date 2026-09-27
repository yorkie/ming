import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { clearTopicReviewResultsIfCurrent, deleteProject, deleteReview, listAiUsage, listProjects, listReviews, recordAiUsage, rememberProject, rememberReview, saveAiReviewIfCurrent, saveReviewCommentsIfCurrent, saveReviewSnapshot, saveReviewTitleIfCurrent, saveTopicReviewResultIfCurrent, topicsAreStale, type Project } from '../src/lib/projectStore';

await new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('ming-projects', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('projects', { keyPath: 'id' });
    const reviews = request.result.createObjectStore('reviews', { keyPath: 'id' });
    reviews.createIndex('projectId', 'projectId');
  };
  request.onsuccess = () => { request.result.close(); resolve(); };
  request.onerror = () => reject(request.error);
});

const project: Project = {
  id: 'project-1',
  name: 'sample',
  directory: { kind: 'directory', name: 'sample' } as FileSystemDirectoryHandle,
  addedAt: 1,
  settings: { baseRef: 'HEAD' },
};
await rememberProject(project);
assert.equal((await listProjects())[0].name, 'sample');
project.name = 'renamed';
await rememberProject(project);
assert.equal((await listProjects())[0].name, 'renamed');
await rememberReview({ id: 'review-1', projectId: project.id, createdAt: 2, branch: 'main', baseRef: 'HEAD', data: '{"files":[]}' });
assert.equal((await listReviews(project.id)).length, 1);
const updated = await saveReviewSnapshot({ id: 'review-2', projectId: project.id, createdAt: 3, branch: 'main', baseRef: 'HEAD', data: '{"files":[{}]}' });
assert.equal(updated.id, 'review-1');
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-1']);
const rescanned = await saveReviewSnapshot({ id: 'review-3', projectId: project.id, createdAt: 4, branch: 'main', baseRef: 'HEAD', data: '{"files":[{}]}' });
assert.equal(rescanned.id, 'review-1');
rescanned.aiReview = { createdAt: 4, reviewed: { 'topic-1': 'reviewed' }, artifact: {
  schemaVersion: 1, snapshotHash: 'same-diff', model: 'deepseek-flash',
  topics: [{ id: 'topic-1', title: 'Topic', summary: '', checks: [], unitIds: ['f0'] }],
} };
rescanned.snapshotHash = 'same-diff';
await rememberReview(rescanned);
assert.equal(await saveReviewTitleIfCurrent(rescanned.id, 'same-diff', { schemaVersion: 1, snapshotHash: 'same-diff', model: 'deepseek-flash', title: 'Update review storage' }), true);
const withPreview = await saveReviewSnapshot({ id: 'review-4', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'HEAD', data: '{"files":[{}],"markdown":"preview"}', snapshotHash: 'same-diff' });
assert.equal(withPreview.id, 'review-1');
assert.equal(withPreview.title, 'Update review storage');
assert.equal(withPreview.aiReview?.reviewed['topic-1'], 'reviewed');
const changedAgain = await saveReviewSnapshot({ id: 'review-5', projectId: project.id, createdAt: 6, branch: 'main', baseRef: 'HEAD', data: '{"files":[{"path":"new.ts"}]}', snapshotHash: 'new-diff' });
assert.equal(changedAgain.id, 'review-1');
assert.equal(changedAgain.title, undefined);
assert.equal(await saveReviewTitleIfCurrent(changedAgain.id, 'same-diff', { schemaVersion: 1, snapshotHash: 'same-diff', model: 'deepseek-flash', title: 'Stale title' }), false);
assert.equal(changedAgain.aiReview?.artifact.snapshotHash, 'same-diff');
assert.equal(changedAgain.aiReview?.reviewed['topic-1'], 'reviewed');
assert.equal(changedAgain.aiReview?.sourceData, rescanned.data);
assert.equal(topicsAreStale(changedAgain), true);
assert.equal(await saveAiReviewIfCurrent(changedAgain.id, 'same-diff', rescanned.aiReview!), false);
assert.equal((await listReviews(project.id))[0].aiReview?.artifact.snapshotHash, 'same-diff');
assert.equal(await saveAiReviewIfCurrent(changedAgain.id, 'new-diff', { ...rescanned.aiReview!, artifact: { ...rescanned.aiReview!.artifact, snapshotHash: 'new-diff' } }), true);
assert.equal((await listReviews(project.id))[0].aiReview?.artifact.snapshotHash, 'new-diff');
assert.equal(topicsAreStale((await listReviews(project.id))[0]), false);
assert.equal(await saveReviewCommentsIfCurrent(changedAgain.id, { schemaVersion: 1, snapshotHash: 'new-diff', model: 'deepseek-flash',
  comments: [{ id: 'comment-1', topicId: 'topic-1', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 1, body: 'Check the caller.' }] }, 4), true);
assert.equal((await listReviews(project.id))[0].aiReview?.reviewed['topic-1'], 'reviewed');
assert.equal((await listReviews(project.id))[0].aiReview?.comments?.[0]?.body, 'Check the caller.');
assert.equal(await saveReviewCommentsIfCurrent(changedAgain.id, { schemaVersion: 1, snapshotHash: 'old-diff', model: 'deepseek-flash', comments: [] }, 4), false);
const expandedTopics = { ...rescanned.aiReview!, artifact: { ...rescanned.aiReview!.artifact, snapshotHash: 'new-diff', topics: [
  ...rescanned.aiReview!.artifact.topics, { id: 'topic-2', title: 'Second', summary: '', checks: [], unitIds: ['f0'] }] } };
assert.equal(await saveAiReviewIfCurrent(changedAgain.id, 'new-diff', expandedTopics), true);
assert.equal((await clearTopicReviewResultsIfCurrent(changedAgain.id, 4))?.comments?.length, 0);
const [firstResult, secondResult] = await Promise.all([
  saveTopicReviewResultIfCurrent(changedAgain.id, { schemaVersion: 1, snapshotHash: 'new-diff', model: 'deepseek-flash',
    comments: [{ id: 'topic-1-1', topicId: 'topic-1', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 1, body: 'First issue', severity: 'high' }] }, 4, 'topic-1', ['Check the caller'], ['high']),
  saveTopicReviewResultIfCurrent(changedAgain.id, { schemaVersion: 1, snapshotHash: 'new-diff', model: 'deepseek-flash',
    comments: [{ id: 'topic-2-1', topicId: 'topic-2', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 1, body: 'Second issue' }] }, 4, 'topic-2', ['Check the second path']),
]);
assert.ok(firstResult && secondResult);
const incremental = (await listReviews(project.id))[0].aiReview!;
assert.deepEqual(incremental.comments?.map(comment => comment.topicId).sort(), ['topic-1', 'topic-2']);
assert.deepEqual(incremental.recommendations?.['topic-2'], ['Check the second path']);
assert.deepEqual(incremental.recommendationSeverities?.['topic-1'], ['high']);
assert.equal(incremental.comments?.find(comment => comment.topicId === 'topic-1')?.severity, 'high');
assert.ok(incremental.comments?.every(comment => comment.id.startsWith(`${incremental.reviewRunId}:`)));
assert.equal(await saveTopicReviewResultIfCurrent(changedAgain.id, { schemaVersion: 1, snapshotHash: 'old-diff', model: 'deepseek-flash', comments: [] }, 4, 'topic-1', []), null);
await rememberReview(changedAgain);
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-1']);
await rememberReview({ id: 'legacy-duplicate', projectId: project.id, createdAt: 2, branch: 'main', baseRef: 'HEAD', data: '{"files":[]}' });
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-1']);
await rememberReview({ ...changedAgain, id: 'older-same-snapshot', createdAt: 5, aiReview: { createdAt: 5,
  reviewed: { 'topic-2': 'reviewed' }, artifact: { schemaVersion: 1, snapshotHash: 'new-diff', model: 'deepseek-flash',
    topics: [{ id: 'topic-2', title: 'Latest', summary: '', checks: [], unitIds: ['f0'] }] } } });
const consolidated = await listReviews(project.id);
assert.deepEqual(consolidated.map(review => review.id), ['review-1']);
assert.equal(consolidated[0].aiReview?.reviewed['topic-2'], 'reviewed');
await rememberReview({ id: 'legacy-other-branch', projectId: project.id, createdAt: 1,
  branch: 'feature', baseRef: 'HEAD', data: '{"files":[]}' });
assert.equal((await listReviews(project.id)).length, 2, 'Existing reviews on different source branches must not be discarded.');
await deleteReview('legacy-other-branch');
await assert.rejects(saveReviewSnapshot({ id: 'other-branch', projectId: project.id, createdAt: 4, branch: 'feature', baseRef: 'HEAD', data: '{"files":[]}' }), /Close it/);
await assert.rejects(saveReviewSnapshot({ id: 'other-base', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'origin/main', data: '{"files":[]}' }), /Close the review/);
assert.equal((await listReviews(project.id)).length, 1);
await deleteReview('review-1');
await saveReviewSnapshot({ id: 'other-base', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'origin/main', data: '{"files":[]}' });
await deleteReview('other-base');
assert.deepEqual((await listReviews(project.id)).map(review => review.id), []);
const usage = { id: 'request-1', projectId: project.id, projectName: project.name, reviewId: 'review-2', createdAt: 10,
  task: 'topic-review', provider: 'deepseek', model: 'deepseek-flash', group: 1, attempt: 1, status: 'success', httpStatus: 200,
  promptTokens: 120, completionTokens: 30, totalTokens: 150, cachedPromptTokens: 20 } as const;
await recordAiUsage(usage);
const otherProject = { ...project, id: 'project-2', name: 'other' };
await rememberProject(otherProject);
await recordAiUsage({ ...usage, id: 'request-2', projectId: otherProject.id, projectName: otherProject.name });
assert.equal((await listAiUsage())[0].totalTokens, 150);
await deleteProject(project.id);
assert.equal((await listProjects()).length, 1);
assert.equal((await listReviews(project.id)).length, 0);
assert.deepEqual((await listAiUsage()).map(record => record.id), ['request-2']);
await recordAiUsage({ ...usage, id: 'late-request' });
assert.deepEqual((await listAiUsage()).map(record => record.id), ['request-2']);
await new Promise<void>((resolve, reject) => {
  const request = indexedDB.open('ming-projects', 2);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('aiUsage', 'readwrite');
    tx.objectStore('aiUsage').put({ ...usage, id: 'orphan-request' });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  };
  request.onerror = () => reject(request.error);
});
assert.deepEqual((await listAiUsage()).map(record => record.id), ['request-2']);
await deleteProject(otherProject.id);
assert.deepEqual(await listAiUsage(), []);
console.log('Project storage integration test passed');

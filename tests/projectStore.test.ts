import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { deleteProject, deleteReview, listAiUsage, listProjects, listReviews, recordAiUsage, rememberProject, rememberReview, saveReviewSnapshot, type Project } from '../src/lib/projectStore';

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
assert.equal(updated.id, 'review-2');
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-2', 'review-1']);
const rescanned = await saveReviewSnapshot({ id: 'review-3', projectId: project.id, createdAt: 4, branch: 'main', baseRef: 'HEAD', data: '{"files":[{}]}' });
assert.equal(rescanned.id, 'review-2');
rescanned.aiReview = { createdAt: 4, reviewed: { 'topic-1': 'reviewed' }, artifact: {
  schemaVersion: 1, snapshotHash: 'same-diff', model: 'deepseek-flash',
  topics: [{ id: 'topic-1', title: 'Topic', summary: '', checks: [], unitIds: ['f0'] }],
} };
rescanned.snapshotHash = 'same-diff';
await rememberReview(rescanned);
const withPreview = await saveReviewSnapshot({ id: 'review-4', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'HEAD', data: '{"files":[{}],"markdown":"preview"}', snapshotHash: 'same-diff' });
assert.equal(withPreview.id, 'review-2');
assert.equal(withPreview.aiReview?.reviewed['topic-1'], 'reviewed');
await rememberReview({ id: 'legacy-duplicate', projectId: project.id, createdAt: 2, branch: 'main', baseRef: 'HEAD', data: '{"files":[]}' });
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-2', 'legacy-duplicate', 'review-1']);
await saveReviewSnapshot({ id: 'other-branch', projectId: project.id, createdAt: 4, branch: 'feature', baseRef: 'HEAD', data: '{"files":[]}' });
await saveReviewSnapshot({ id: 'other-base', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'origin/main', data: '{"files":[]}' });
assert.equal((await listReviews(project.id)).length, 5);
await deleteReview('other-base');
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-2', 'other-branch', 'legacy-duplicate', 'review-1']);
await recordAiUsage({ id: 'request-1', projectId: project.id, projectName: project.name, reviewId: 'review-2', createdAt: 10,
  task: 'topic-review', provider: 'deepseek', model: 'deepseek-flash', group: 1, attempt: 1, status: 'success', httpStatus: 200,
  promptTokens: 120, completionTokens: 30, totalTokens: 150, cachedPromptTokens: 20 });
assert.equal((await listAiUsage())[0].totalTokens, 150);
await deleteProject(project.id);
assert.equal((await listProjects()).length, 0);
assert.equal((await listReviews(project.id)).length, 0);
assert.equal((await listAiUsage()).length, 1);
console.log('Project storage integration test passed');

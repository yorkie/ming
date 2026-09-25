import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { deleteProject, listProjects, listReviews, rememberProject, rememberReview, saveReviewSnapshot, type Project } from '../src/lib/projectStore';

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
assert.deepEqual((await listReviews(project.id)).map(review => [review.id, review.createdAt, review.data]), [['review-1', 3, '{"files":[{}]}']]);
await rememberReview({ id: 'legacy-duplicate', projectId: project.id, createdAt: 2, branch: 'main', baseRef: 'HEAD', data: '{"files":[]}' });
assert.deepEqual((await listReviews(project.id)).map(review => review.id), ['review-1']);
await saveReviewSnapshot({ id: 'other-branch', projectId: project.id, createdAt: 4, branch: 'feature', baseRef: 'HEAD', data: '{"files":[]}' });
await saveReviewSnapshot({ id: 'other-base', projectId: project.id, createdAt: 5, branch: 'main', baseRef: 'origin/main', data: '{"files":[]}' });
assert.equal((await listReviews(project.id)).length, 3);
await deleteProject(project.id);
assert.equal((await listProjects()).length, 0);
assert.equal((await listReviews(project.id)).length, 0);
console.log('Project storage integration test passed');

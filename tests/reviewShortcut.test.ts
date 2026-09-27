import { strict as assert } from 'node:assert';
import { parseLastOpenedReview, resolveLastOpenedReview } from '../src/lib/reviewShortcut';
import type { Project, ReviewRecord } from '../src/lib/projectStore';

const project = { id: 'project-1', name: 'ink' } as Project;
const review = { id: 'review-1', projectId: project.id, title: 'Speech support' } as ReviewRecord;
const saved = { projectId: project.id, reviewId: review.id, tab: 'commits' as const };
assert.deepEqual(parseLastOpenedReview(JSON.stringify(saved)), saved);
assert.equal(parseLastOpenedReview('{"projectId":"project-1","reviewId":"review-1","tab":"invalid"}'), null);
assert.equal(parseLastOpenedReview('{"projectId":"project-1","reviewId":"review-1"}'), null);
assert.equal(parseLastOpenedReview('broken'), null);
assert.deepEqual(resolveLastOpenedReview(saved, [project], { [project.id]: [review] }), { project, review, tab: 'commits' });
assert.equal(resolveLastOpenedReview(saved, [], { [project.id]: [review] }), null);
assert.equal(resolveLastOpenedReview(saved, [project], { [project.id]: [] }), null);
console.log('Review shortcut test passed');

import { strict as assert } from 'node:assert';
import { nextTopicReview } from '../src/lib/incrementalReview';
import type { TopicReview } from '../src/lib/aiReviewTypes';
import type { Review } from '../src/lib/reviewTypes';

const file = (path: string, text: string) => ({ path, status: 'modified', additions: 1, deletions: 0,
  hunks: [{ header: '@@ -1 +1 @@', lines: [{ kind: 'add' as const, text, oldNumber: null, newNumber: 1 }] }] });
const oldReview: Review = { files: [file('src/a.ts', 'new behavior')], additions: 1, deletions: 0 };
const old: TopicReview = { createdAt: 1, sourceData: JSON.stringify(oldReview), reviewed: { 'topic-1': 'reviewed' },
  artifact: { schemaVersion: 1, snapshotHash: 'old', model: 'test',
    topics: [{ id: 'topic-1', title: 'Handle input', summary: 'Input', checks: [], unitIds: ['f0h0'] }] },
  comments: [{ id: 'topic-1-1', topicId: 'topic-1', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 1, body: 'Check the input.' }] };
const shiftedReview: Review = { files: [file('src/0.ts', 'unrelated'), file('src/a.ts', 'new behavior')], additions: 2, deletions: 0 };
const artifact = { schemaVersion: 1 as const, snapshotHash: 'new', model: 'test', topics: [
  { id: 'topic-1', title: 'Unrelated', summary: 'New', checks: [], unitIds: ['f0h0'] },
  { id: 'topic-2', title: 'Handle input', summary: 'Input', checks: [], unitIds: ['f1h0'] },
] };
const incremental = nextTopicReview(old, artifact, JSON.stringify(shiftedReview), false);
assert.equal(incremental.artifact.topics[1].id, 'topic-1');
assert.notEqual(incremental.artifact.topics[0].id, 'topic-1');
assert.equal(incremental.reviewed['topic-1'], 'reviewed');
assert.equal(incremental.comments?.length, 0, 'Old anchors must not be applied to a new diff.');
assert.equal(incremental.previousComments?.[0].body, 'Check the input.');
assert.equal(incremental.revisions?.[0].comments?.[0].id, 'topic-1-1');
const another = nextTopicReview({ ...incremental, comments: [{ id: 'new-1', topicId: 'topic-1', fileIndex: 1, hunkIndex: 0,
  side: 'RIGHT', lineNumber: 1, body: 'A new finding.' }] }, artifact, JSON.stringify(shiftedReview), false);
assert.deepEqual(another.previousComments?.map(comment => comment.id), ['topic-1-1', 'new-1']);
const changed = nextTopicReview(old, artifact, JSON.stringify({ ...shiftedReview,
  files: [shiftedReview.files[0], file('src/a.ts', 'changed behavior')] }), false);
assert.equal(changed.reviewed['topic-1'], undefined, 'Changed code needs another review.');
const full = nextTopicReview(old, artifact, JSON.stringify(shiftedReview), true);
assert.deepEqual(full.reviewed, {});
assert.deepEqual(full.previousComments, []);
assert.equal(full.revisions?.length, 1, 'Full generation keeps the old version in history.');
console.log('Incremental review continuity test passed');

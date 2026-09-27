import { strict as assert } from 'node:assert';
import { nextTopicReview } from '../src/lib/incrementalReview';
import { activeTopicArtifact, commentResolved, historicalComments, unresolvedTopicComments, visibleTopics } from '../src/lib/reviewContinuity';
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
assert.equal(full.previousComments?.[0].id, 'topic-1-1', 'Full regeneration retains historical findings.');
assert.equal(full.outdatedTopics?.['topic-1'], old.sourceData);
assert.equal(activeTopicArtifact(full).topics.length, 2, 'Archived topics are excluded from a new review run.');
assert.equal(full.revisions?.length, 1, 'Full generation keeps the old version in history.');
const removed = nextTopicReview(old, { ...artifact, topics: [artifact.topics[0]] }, JSON.stringify(shiftedReview), false);
assert.equal(removed.artifact.topics.length, 2, 'A topic omitted by the model remains visible.');
assert.equal(removed.artifact.topics[1].title, 'Handle input');
assert.equal(removed.outdatedTopics?.['topic-1'], old.sourceData);
assert.equal(removed.previousComments?.[0].topicId, 'topic-1');
assert.equal(activeTopicArtifact(removed).topics.length, 1);
const resolved = { ...old, priorAssessments: { 'topic-1-1': { outcome: 'resolved' as const, reason: 'The failing branch was removed.' } } };
assert.equal(commentResolved(resolved, 'topic-1-1'), true);
assert.equal(commentResolved({ ...resolved, commentDecisions: { 'topic-1-1': 'open' } }, 'topic-1-1'), false,
  'A manual reopen overrides the automatic assessment.');
assert.equal(historicalComments(nextTopicReview(resolved, artifact, JSON.stringify(shiftedReview), false)).length, 1,
  'Resolved comments remain in history.');
assert.deepEqual(unresolvedTopicComments(nextTopicReview(resolved, artifact, JSON.stringify(shiftedReview), false), 'topic-1'),
  { current: [], historical: [] }, 'Automatically resolved comments are omitted from Fix.');
const legacy: TopicReview = { ...old, artifact: { ...artifact, topics: [{ ...artifact.topics[0], id: 'topic-2' }] },
  comments: [], previousComments: [], revisions: [{ artifact: old.artifact, sourceData: old.sourceData,
    reviewed: old.reviewed, comments: old.comments, createdAt: old.createdAt }] };
assert.equal(visibleTopics(legacy).topics[1].title, 'Handle input', 'An earlier lost topic is recovered from saved history.');
assert.equal(visibleTopics(legacy).outdatedSources['topic-1'], old.sourceData);
assert.equal(nextTopicReview(legacy, artifact, JSON.stringify(shiftedReview), false).previousComments?.[0].body, 'Check the input.');
const renamedReview: Review = { files: [file('src/renamed.ts', 'new behavior')], additions: 1, deletions: 0 };
const sameTitle = nextTopicReview(old, { ...artifact, topics: [{ ...artifact.topics[1], unitIds: ['f0h0'] }] }, JSON.stringify(renamedReview), false);
assert.equal(sameTitle.artifact.topics.length, 1, 'A renamed topic is matched by its unique title.');
assert.equal(sameTitle.artifact.topics[0].id, 'topic-1');
const duplicate: TopicReview = { ...old, sourceData: JSON.stringify(shiftedReview),
  artifact: { ...artifact, topics: [{ ...artifact.topics[1], id: 'topic-2' }, old.artifact.topics[0]] },
  outdatedTopics: { 'topic-1': old.sourceData! }, comments: [], previousComments: old.comments };
assert.deepEqual(visibleTopics(duplicate).topics.map(topic => topic.id), ['topic-2'], 'Previously saved duplicate topics display as one.');
assert.equal(historicalComments(duplicate)[0].topicId, 'topic-2', 'Old comments remain with the visible topic.');
assert.equal(nextTopicReview(duplicate, { ...artifact, topics: [artifact.topics[1]] }, JSON.stringify(shiftedReview), false).artifact.topics.length, 1);

const asrBefore: Review = { files: [file('src/asr.ts', 'wire stream'), file('test/asr.test.ts', 'test stream')], additions: 2, deletions: 0 };
const asrAfter: Review = { files: [file('src/asr.ts', 'wire stream'), file('src/types.ts', 'new capability'),
  file('test/asr.test.ts', 'test stream')], additions: 3, deletions: 0 };
const asrReview: TopicReview = { ...old, sourceData: JSON.stringify(asrBefore), reviewed: {},
  artifact: { ...old.artifact, topics: [{ id: 'topic-1', title: '流式 ASR 测试协议接入', summary: '接入协议并覆盖测试',
    checks: [], unitIds: ['f0h0', 'f1h0'] }] } };
const asrUpdate = nextTopicReview(asrReview, { ...artifact, topics: [
  { id: 'topic-1', title: '运行时类型与宿主接口扩展', summary: '扩展接口', checks: [], unitIds: ['f0h0', 'f1h0'] },
  { id: 'topic-2', title: '流式 ASR 测试协议实现与测试', summary: '实现协议并测试', checks: [], unitIds: ['f0h0', 'f2h0'] },
] }, JSON.stringify(asrAfter), false);
assert.equal(asrUpdate.artifact.topics[1].id, 'topic-1', 'A renamed feature topic keeps its identity across file changes.');
assert.equal(asrUpdate.artifact.topics.length, 2, 'The old topic must not appear as an out-of-date duplicate.');
assert.equal(asrUpdate.outdatedTopics?.['topic-1'], undefined);
assert.equal(asrUpdate.previousComments?.[0].topicId, 'topic-1', 'Earlier comments stay on the continuing topic.');
assert.notEqual(asrUpdate.artifact.topics[0].id, 'topic-1', 'A shared implementation file does not merge a different category.');
const legacyAsr: TopicReview = { ...asrUpdate, artifact: { ...asrUpdate.artifact, topics: [
  ...asrUpdate.artifact.topics.map(topic => topic.id === 'topic-1' ? { ...topic, id: 'topic-7' } : topic),
  asrReview.artifact.topics[0],
] }, outdatedTopics: { 'topic-1': JSON.stringify(asrBefore) } };
assert.equal(visibleTopics(legacyAsr).topics.length, 2, 'An already saved renamed duplicate is hidden without losing its comments.');
assert.equal(historicalComments(legacyAsr)[0].topicId, 'topic-7');
console.log('Incremental review continuity test passed');

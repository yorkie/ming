import { strict as assert } from 'node:assert';
import type { ReviewComment, TopicReview } from '../src/lib/aiReviewTypes';
import { commentResolved, unresolvedHistoricalComments } from '../src/lib/reviewContinuity';
import { assessPreviousFindings, filterNewReviewComments, priorFindingsPrompt, repeatedPriorFindingIds } from '../src/lib/reviewCarryover';

const comment = (id: string, body: string): ReviewComment => ({ id, topicId: 'topic-1', fileIndex: 0,
  hunkIndex: 0, side: 'RIGHT', lineNumber: 1, body });
const old = [comment('manual', 'Manually resolved issue.'), comment('automatic', 'Automatically resolved issue.'),
  comment('open', 'Check the caller.')];
const review: TopicReview = { createdAt: 1, reviewed: {}, artifact: { schemaVersion: 1, snapshotHash: 'hash', model: 'test',
  topics: [{ id: 'topic-1', title: 'Topic', summary: '', checks: [], unitIds: ['f0h0'] }] },
  previousComments: old, commentDecisions: { manual: 'resolved' },
  priorAssessments: { automatic: { outcome: 'resolved', reason: 'The caller was fixed.' },
    open: { outcome: 'still-present', reason: 'The caller still fails.' } } };

assert.deepEqual(unresolvedHistoricalComments(review).map(item => item.id), ['open']);
assert.deepEqual(unresolvedHistoricalComments({ ...review, commentDecisions: { manual: 'open' } }).map(item => item.id),
  ['manual', 'open'], 'A manually reopened finding must be reviewed again.');
const manyOpen = Array.from({ length: 25 }, (_, index) => comment(`open-${index + 1}`, `Issue ${index + 1}`));
const prompt = priorFindingsPrompt(manyOpen);
assert.match(prompt, /open-1/);
assert.match(prompt, /open-25/, 'Every unresolved finding must reach the next review.');
assert.match(prompt, /only independently new issues in comments/);

const candidates = [
  { body: '' },
  { body: 'Moved caller still fails.', priorFindingId: 'open', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 2 },
  { body: '  Check  the caller. ', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 3 },
  { body: 'New issue.', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 4 },
  { body: 'New issue.', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 4 },
  { body: 'Another new issue.', fileIndex: 0, hunkIndex: 0, side: 'RIGHT', lineNumber: 5 },
];
assert.deepEqual(filterNewReviewComments(candidates, [old[2]]), [candidates[3], candidates[5]],
  'Old issues and repeated new candidates must not create duplicate comments.');
assert.deepEqual([...repeatedPriorFindingIds(candidates, [old[2]])], ['open']);
assert.equal(assessPreviousFindings([old[2]], [{ id: 'open', outcome: 'resolved', reason: 'Looks fixed.' }], 1,
  repeatedPriorFindingIds(candidates, [old[2]])).open?.outcome, 'still-present',
  'A repeated old issue cannot be resolved by a conflicting assessment.');

assert.deepEqual(assessPreviousFindings([old[2]], []), {}, 'A missing model assessment leaves the prior status intact.');
assert.deepEqual(assessPreviousFindings([old[2]], [{ id: 'open', outcome: 'resolved', reason: 'One section checked it.' }], 2), {},
  'One section cannot resolve a finding across a split review.');
const resolved = assessPreviousFindings([old[2]], [
  { id: 'open', outcome: 'resolved', reason: 'First section checked it.' },
  { id: 'open', outcome: 'resolved', reason: 'Second section checked it.' },
], 2);
assert.equal(commentResolved({ ...review, priorAssessments: { ...review.priorAssessments, ...resolved } }, 'open'), true);
const stillPresent = assessPreviousFindings([old[2]], [
  { id: 'open', outcome: 'resolved', reason: 'One path was fixed.' },
  { id: 'open', outcome: 'still-present', reason: 'The other path still fails.' },
], 2);
assert.equal(stillPresent.open?.outcome, 'still-present');
assert.equal(commentResolved({ ...review, priorAssessments: { ...review.priorAssessments, ...stillPresent } }, 'automatic'), true,
  'Already resolved issues are not reassessed or reopened.');

console.log('Review carryover test passed');

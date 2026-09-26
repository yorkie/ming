import { strict as assert } from 'node:assert';
import { canMergePartialReview, mergeScannedReview } from '../src/lib/mergeScannedReview';
import type { FileChange, Review } from '../src/lib/reviewTypes';

const file = (path: string, additions = 1): FileChange => ({ path, status: 'modified', additions, deletions: 0, hunks: [] });
const previous: Review = { files: [file('src/a.ts'), file('src/b.ts'), file('docs/guide.md')], additions: 3, deletions: 0 };
assert.deepEqual(mergeScannedReview(previous, [file('src/b.ts', 2)], ['src/b.ts'])?.files.map(item => item.path),
  ['docs/guide.md', 'src/a.ts', 'src/b.ts']);
assert.equal(mergeScannedReview(previous, [file('src/b.ts', 2)], ['src/b.ts'])?.additions, 4);
assert.deepEqual(mergeScannedReview(previous, [], ['src'])?.files.map(item => item.path), ['docs/guide.md']);
assert.equal(mergeScannedReview(previous, [], ['src', 'docs']), null);
const expected = { filepaths: ['src/a.ts'], headOid: 'abc', baseRef: 'origin/main', baseOid: 'remote1', branch: 'main', hadReview: true, previousData: JSON.stringify(previous) };
const actual = { headOid: 'abc', baseRef: 'origin/main', baseOid: 'remote1', branch: 'main' };
assert.equal(canMergePartialReview(expected, actual), true);
assert.equal(canMergePartialReview(expected, { ...actual, headOid: 'def' }), false);
assert.equal(canMergePartialReview(expected, { ...actual, baseOid: 'remote2' }), false);
assert.equal(canMergePartialReview({ ...expected, previousData: null }, actual), false);
assert.equal(canMergePartialReview({ ...expected, hadReview: false, previousData: null }, actual), true);
assert.equal(canMergePartialReview({ ...expected, filepaths: [] }, actual), false);
console.log('Partial review merge test passed');

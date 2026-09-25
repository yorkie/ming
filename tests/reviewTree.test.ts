import { strict as assert } from 'node:assert';
import { buildFileTree, compactDirectory, filterFileTree } from '../src/lib/reviewTree';

const tree = buildFileTree([
  'apple/InkAppleView/Sources/Bridge.h',
  'apple/InkAppleView/Sources/Bridge.mm',
  'android/ink/src/Main.kt',
  'README.md',
]);
assert.deepEqual(tree.map(node => node.name), ['android', 'apple', 'README.md']);
assert.equal(tree[1].count, 2);
const apple = compactDirectory(tree[1]);
assert.equal(apple.label, 'apple/InkAppleView/Sources');
assert.deepEqual(apple.node.children.map(node => node.name), ['Bridge.h', 'Bridge.mm']);
assert.equal(apple.node.children[0].fileIndex, 0);
const filtered = filterFileTree(tree, 'bridge.H');
assert.deepEqual(filtered.map(node => node.name), ['apple']);
assert.equal(filtered[0].count, 1);
assert.equal(compactDirectory(filtered[0]).node.children[0].fileIndex, 0);
assert.equal(filterFileTree(tree, 'missing').length, 0);
assert.equal(filterFileTree(tree, '').length, tree.length);
console.log('Review tree test passed');

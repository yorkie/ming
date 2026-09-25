import { strict as assert } from 'node:assert';
import { highlightLines } from '../src/lib/syntaxHighlight';

const highlighted = highlightLines('src/example.ts', [
  'const label = "hello";',
  '/* a comment',
  'still a comment */',
]);
assert.equal(highlighted.length, 3);
assert.match(highlighted[0], /token keyword[^>]*>const<\/span>/);
assert.match(highlighted[0], /token string[^>]*>&quot;hello&quot;<\/span>/);
assert.match(highlighted[1], /token comment/);
assert.match(highlighted[2], /token comment/);
assert.deepEqual(highlightLines('plain.unknown', ['<script>']), ['&lt;script&gt;']);
assert.deepEqual(highlightLines('src/example.rs', []), []);
console.log('Syntax highlight test passed');

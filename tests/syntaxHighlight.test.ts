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
const vue = highlightLines('src/Example.vue', [
  '<script setup lang="ts">',
  'const count: number = 1;',
  '</script>',
  '<template>',
  '  <button>{{ count }}</button>',
  '</template>',
  '<style scoped>',
  'button { color: red; }',
  '</style>',
]);
assert.equal(vue.length, 9);
assert.match(vue[0], /token tag/);
assert.match(vue[1], /token keyword[^>]*>const<\/span>/);
assert.match(vue[4], /token tag/);
assert.match(vue[7], /token property[^>]*>color<\/span>/);
assert.match(highlightLines('src/Example.vue', ['const count = ref(1);'])[0], /token keyword[^>]*>const<\/span>/);
assert.match(highlightLines('src/Example.vue', ['button { color: red; }'])[0], /token property[^>]*>color<\/span>/);
console.log('Syntax highlight test passed');

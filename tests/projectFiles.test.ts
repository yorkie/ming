import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readProjectPath, resolveProjectAssetPath } from '../src/lib/projectFiles';

function directory(path: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory', name: basename(path),
    async getFileHandle(name: string) {
      const next = join(path, name);
      if (!(await stat(next)).isFile()) throw new Error('Not a file');
      return file(next);
    },
    async getDirectoryHandle(name: string) {
      const next = join(path, name);
      if (!(await stat(next)).isDirectory()) throw new Error('Not a directory');
      return directory(next);
    },
    async *values() {
      for (const name of await readdir(path)) {
        const next = join(path, name);
        yield (await stat(next)).isDirectory() ? directory(next) : file(next);
      }
    },
  } as FileSystemDirectoryHandle;
}

function file(path: string): FileSystemFileHandle {
  return {
    kind: 'file', name: basename(path),
    async getFile() {
      const bytes = await readFile(path);
      return { size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    },
  } as FileSystemFileHandle;
}

const root = await mkdtemp(join(tmpdir(), 'ming-files-'));
try {
  await mkdir(join(root, '.git'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, '.gitignore'), 'dist/\n*.log\n!important.log\n');
  await writeFile(join(root, 'README.md'), '# Ming\n');
  await writeFile(join(root, 'debug.log'), 'ignored\n');
  await writeFile(join(root, 'important.log'), 'visible\n');
  await writeFile(join(root, 'dist', 'bundle.js'), 'ignored\n');
  await writeFile(join(root, 'src', '.gitignore'), '*.tmp\n!keep.tmp\n');
  await writeFile(join(root, 'src', 'hidden.tmp'), 'ignored\n');
  await writeFile(join(root, 'src', 'keep.tmp'), 'visible\n');
  await writeFile(join(root, 'src', 'main.ts'), 'export const ming = true;\n');
  const top = await readProjectPath(directory(root));
  assert.equal(top.kind, 'directory');
  if (top.kind !== 'directory') throw new Error('Expected directory');
  assert.deepEqual(top.entries.map(entry => entry.name), ['src', '.gitignore', 'important.log', 'README.md']);
  assert.deepEqual(top.readme, { name: 'README.md', content: { text: '# Ming\n', reason: null, size: 7 } });
  const nested = await readProjectPath(directory(root), 'src');
  assert.equal(nested.kind, 'directory');
  if (nested.kind !== 'directory') throw new Error('Expected directory');
  assert.deepEqual(nested.entries.map(entry => entry.name), ['.gitignore', 'keep.tmp', 'main.ts']);
  const source = await readProjectPath(directory(root), 'src/main.ts');
  assert.equal(source.kind, 'file');
  if (source.kind !== 'file') throw new Error('Expected file');
  assert.equal(source.content.text, 'export const ming = true;\n');
  const limitedSource = await readProjectPath(directory(root), 'src/main.ts', 10);
  assert.equal(limitedSource.kind, 'file');
  if (limitedSource.kind !== 'file') throw new Error('Expected file');
  assert.deepEqual(limitedSource.content, { text: null, reason: 'large', size: 26 });
  assert.equal(resolveProjectAssetPath('docs/README.md', '../logo.png'), 'logo.png');
  assert.equal(resolveProjectAssetPath('README.md', './logo.png'), 'logo.png');
  assert.equal(resolveProjectAssetPath('README.md', '../../outside.png'), null);
  assert.equal(resolveProjectAssetPath('README.md', 'https://example.com/logo.png'), null);
  await assert.rejects(readProjectPath(directory(root), '../README.md'), /Invalid project path/);
  await assert.rejects(readProjectPath(directory(root), '.git'), /Invalid project path/);
  await assert.rejects(readProjectPath(directory(root), 'dist'), /not found/);
  await assert.rejects(readProjectPath(directory(root), 'debug.log'), /not found/);
  await assert.rejects(readProjectPath(directory(root), 'src/hidden.tmp'), /not found/);
  console.log('Project files integration test passed');
} finally { await rm(root, { recursive: true, force: true }); }

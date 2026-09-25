import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { inspectRepository, readCommitHistory, readLocalRepository, readMarkdownSnapshot, validateGitRepository } from '../src/lib/localRepository';

function directory(path: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory', name: basename(path),
    async getFileHandle(name: string) {
      const next = join(path, name);
      if (!(await stat(next)).isFile()) throw new Error('not file');
      return file(next);
    },
    async getDirectoryHandle(name: string) {
      const next = join(path, name);
      if (!(await stat(next)).isDirectory()) throw new Error('not directory');
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
      const info = await stat(path);
      return { size: bytes.byteLength, lastModified: info.mtimeMs, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
    },
  } as FileSystemFileHandle;
}

const root = await mkdtemp(join(tmpdir(), 'ming-repo-'));
try {
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  run('init');
  run('config', 'user.name', 'Ming Test');
  run('config', 'user.email', 'ming@example.test');
  await writeFile(join(root, 'tracked.txt'), 'before\n');
  await writeFile(join(root, 'unborn.md'), '# Before first commit\n');
  const initialPatch = await readLocalRepository(directory(root));
  assert.match(initialPatch, /\+before/);
  const unbornMarkdown = await readMarkdownSnapshot(directory(root), 'HEAD', 'unborn.md');
  assert.deepEqual(unbornMarkdown.snapshot, { before: '', after: '# Before first commit\n' });
  assert.ok(initialPatch.includes(unbornMarkdown.patch));
  run('add', '.');
  run('commit', '-m', 'baseline');
  const baselineOid = run('rev-parse', 'HEAD').toString().trim();
  assert.equal(await readLocalRepository(directory(root)), '');
  await validateGitRepository(directory(root));
  const info = await inspectRepository(directory(root));
  assert.ok(info.currentBranch);
  assert.ok(info.branches.includes(info.currentBranch));
  assert.equal(info.headOid, baselineOid);
  assert.equal(info.latestCommit?.oid, baselineOid);
  assert.equal(info.latestCommit?.title, 'baseline');
  await writeFile(join(root, 'tracked.txt'), 'after\n');
  await writeFile(join(root, 'new.txt'), 'untracked\n');
  await writeFile(join(root, 'new.md'), '# New guide\n');
  const markdown: Record<string, { before: string; after: string }> = {};
  const patch = await readLocalRepository(directory(root), 'HEAD', undefined, (path, snapshot) => { markdown[path] = snapshot; });
  assert.match(patch, /diff --git a\/tracked\.txt b\/tracked\.txt/);
  assert.match(patch, /-before/);
  assert.match(patch, /\+after/);
  assert.match(patch, /diff --git a\/new\.txt b\/new\.txt/);
  assert.match(patch, /\+untracked/);
  assert.deepEqual(markdown['new.md'], { before: '', after: '# New guide\n' });
  const legacyMarkdown = await readMarkdownSnapshot(directory(root), 'HEAD', 'new.md');
  assert.deepEqual(legacyMarkdown.snapshot, markdown['new.md']);
  assert.match(legacyMarkdown.patch, /new file mode 100644/);
  assert.ok(patch.includes(legacyMarkdown.patch));
  await rm(join(root, 'new.md'));
  assert.equal((await readFile(join(root, 'tracked.txt'), 'utf8')), 'after\n');
  run('add', 'tracked.txt');
  run('commit', '-m', 'local change');
  const branch = info.currentBranch!;
  const localOid = run('rev-parse', 'HEAD').toString().trim();
  run('checkout', '-b', 'remote-side', baselineOid);
  await writeFile(join(root, 'tracked.txt'), 'remote\n');
  run('add', 'tracked.txt');
  run('commit', '-m', 'remote change');
  const remoteOid = run('rev-parse', 'HEAD').toString().trim();
  run('checkout', branch);
  run('update-ref', `refs/remotes/origin/${branch}`, remoteOid);
  run('config', `branch.${branch}.remote`, 'origin');
  run('config', `branch.${branch}.merge`, `refs/heads/${branch}`);
  const history = await readCommitHistory(directory(root), localOid, branch);
  assert.equal(history.remoteRef, `origin/${branch}`);
  assert.deepEqual(history.localOnly.map(commit => commit.title), ['local change']);
  assert.deepEqual(history.remoteOnly.map(commit => commit.title), ['remote change']);
  const reviewSnapshot = await readCommitHistory(directory(root), baselineOid, branch);
  assert.deepEqual(reviewSnapshot.localOnly, []);
  assert.deepEqual(reviewSnapshot.remoteOnly.map(commit => commit.title), ['remote change']);
  console.log('Local repository integration test passed');
} finally { await rm(root, { recursive: true, force: true }); }

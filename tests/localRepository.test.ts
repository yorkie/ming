import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { inspectRepository, readCommitHistory, readEntryCommits, readLocalRepository, readMarkdownSnapshot, resolveComparisonOid, resolveComparisonRef, validateGitRepository } from '../src/lib/localRepository';

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
      if (path.endsWith('/.git')) gitDirectoryListings++;
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
      if (path.endsWith('/.git/index')) indexStatReads++;
      const info = await stat(path);
      return { size: info.size, lastModified: info.mtimeMs,
        arrayBuffer: async () => {
          if (path.endsWith('/large.bin')) largeArrayBufferReads++;
          if (path.includes('/.git/objects/pack/') && path.endsWith('.pack')) packReads++;
          return Uint8Array.from(await readFile(path)).buffer;
        },
        stream: () => new ReadableStream<Uint8Array>({
          async start(controller) {
            const bytes = await readFile(path);
            for (let offset = 0; offset < bytes.length; offset += 65_536) controller.enqueue(bytes.subarray(offset, offset + 65_536));
            controller.close();
          },
        }),
        slice: (start = 0, end = info.size) => ({ arrayBuffer: async () => {
          const handle = await open(path, 'r');
          try {
            const bytes = Buffer.allocUnsafe(end - start);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, start);
            if (path.endsWith('.pack')) packSliceReads++;
            return Uint8Array.from(bytes.subarray(0, bytesRead)).buffer;
          } finally { await handle.close(); }
        } }) as Blob,
      };
    },
  } as FileSystemFileHandle;
}

let indexStatReads = 0;
let largeArrayBufferReads = 0;
let gitDirectoryListings = 0;
let packReads = 0;
let packSliceReads = 0;

const root = await mkdtemp(join(tmpdir(), 'ming-repo-'));
try {
  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  run('init');
  run('config', 'user.name', 'Ming Test');
  run('config', 'user.email', 'ming@example.test');
  await writeFile(join(root, 'tracked.txt'), 'before\n');
  await writeFile(join(root, 'unborn.md'), '# Before first commit\n');
  const initialPatch = await readLocalRepository(directory(root));
  assert.equal(gitDirectoryListings, 0, 'Content scans should not enumerate the .git directory.');
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
  assert.equal(await resolveComparisonOid(directory(root), 'HEAD'), baselineOid);
  assert.equal(info.latestCommit?.oid, baselineOid);
  assert.equal(info.latestCommit?.title, 'baseline');
  await assert.rejects(resolveComparisonRef(directory(root), 'HEAD', info.currentBranch), /No local remote-tracking ref/);
  assert.equal(await resolveComparisonRef(directory(root), 'HEAD', null), 'HEAD');
  assert.equal(await resolveComparisonRef(directory(root), 'some-ref', info.currentBranch), 'some-ref');
  await writeFile(join(root, '.gitignore'), 'dist/\n*.log\n');
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'dist', 'bundle.js'), 'ignored\n');
  await writeFile(join(root, 'debug.log'), 'ignored\n');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', '.gitignore'), '*.tmp\n');
  await writeFile(join(root, 'src', 'scratch.tmp'), 'ignored\n');
  await writeFile(join(root, 'src', 'kept.ts'), 'included\n');
  await writeFile(join(root, 'tracked.txt'), 'after\n');
  await writeFile(join(root, 'new.txt'), 'untracked\n');
  await writeFile(join(root, 'new.md'), '# New guide\n');
  const markdown: Record<string, { before: string; after: string }> = {};
  const progress: string[] = [];
  const patch = await readLocalRepository(directory(root), 'HEAD', message => progress.push(message), (path, snapshot) => { markdown[path] = snapshot; });
  assert.ok(progress.some(message => message.startsWith('Scanning directory:')));
  assert.ok(progress.some(message => message.includes('Generating diff')));
  assert.match(patch, /diff --git a\/src\/kept\.ts b\/src\/kept\.ts/);
  assert.doesNotMatch(patch, /dist\/bundle\.js|debug\.log|src\/scratch\.tmp/);
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
  const entryCommits = await readEntryCommits(directory(root), '', ['tracked.txt', 'unborn.md', 'new.txt'], localOid);
  assert.equal(entryCommits['tracked.txt']?.title, 'local change');
  assert.equal(entryCommits['unborn.md']?.title, 'baseline');
  assert.equal(entryCommits['new.txt'], null);
  run('checkout', '-b', 'remote-side', baselineOid);
  await writeFile(join(root, 'tracked.txt'), 'remote\n');
  run('add', 'tracked.txt');
  run('commit', '-m', 'remote change');
  const remoteOid = run('rev-parse', 'HEAD').toString().trim();
  run('checkout', branch);
  run('update-ref', `refs/remotes/origin/${branch}`, remoteOid);
  run('config', `branch.${branch}.remote`, 'origin');
  run('config', `branch.${branch}.merge`, `refs/heads/${branch}`);
  assert.equal(await resolveComparisonRef(directory(root), 'HEAD', branch), `origin/${branch}`);
  assert.equal(await resolveComparisonOid(directory(root), `origin/${branch}`), remoteOid);
  const remotePatch = await readLocalRepository(directory(root), await resolveComparisonRef(directory(root), 'HEAD', branch));
  assert.match(remotePatch, /-remote/);
  assert.match(remotePatch, /\+after/);
  const history = await readCommitHistory(directory(root), localOid, branch);
  assert.equal(history.remoteRef, `origin/${branch}`);
  assert.deepEqual(history.localOnly.map(commit => commit.title), ['local change']);
  assert.deepEqual(history.remoteOnly.map(commit => commit.title), ['remote change']);
  const reviewSnapshot = await readCommitHistory(directory(root), baselineOid, branch);
  assert.deepEqual(reviewSnapshot.localOnly, []);
  assert.deepEqual(reviewSnapshot.remoteOnly.map(commit => commit.title), ['remote change']);
  // The Git tree cap must not include ignored build output or ordinary
  // untracked files, even when their combined count exceeds the old cap.
  await writeFile(join(root, '.gitignore'), 'dist/\n*.log\nbuild/\n');
  await mkdir(join(root, 'build'));
  await Promise.all(Array.from({ length: 510 }, (_, index) => mkdir(join(root, 'build', `part-${index}`))));
  await Promise.all(Array.from({ length: 210 }, (_, index) => writeFile(join(root, `untracked-${index}.txt`), 'new\n')));
  const manyUntrackedPatch = await readLocalRepository(directory(root));
  assert.match(manyUntrackedPatch, /diff --git a\/untracked-209\.txt b\/untracked-209\.txt/);
  assert.doesNotMatch(manyUntrackedPatch, /build\/part-/);
  await mkdir(join(root, 'tracked-many'));
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(root, 'tracked-many', `${index}.txt`), 'before\n')));
  run('add', 'tracked-many');
  run('commit', '-m', 'many tracked files');
  run('gc', '--quiet');
  await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(root, 'tracked-many', `${index}.txt`), 'after\n')));
  const indexReadsBefore = indexStatReads;
  const packReadsBefore = packReads;
  const manyTrackedPatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { packRanges: false });
  assert.ok(indexStatReads - indexReadsBefore < 20, 'A scan should reuse the Git index stat across files.');
  assert.ok(packReads - packReadsBefore > 0 && packReads - packReadsBefore <= 2, 'A scan should reuse packed Git objects across changed files.');
  assert.match(manyTrackedPatch, /diff --git a\/tracked-many\/500\.txt b\/tracked-many\/500\.txt/);
  const packReadsBeforeRanges = packReads;
  const rangedTrackedPatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { packRanges: true });
  assert.equal(rangedTrackedPatch, manyTrackedPatch, 'Ranged packed objects should preserve every patch.');
  assert.equal(packReads, packReadsBeforeRanges, 'Ranged packed objects should not read whole pack files.');
  assert.ok(packSliceReads > 0, 'Ranged packed objects should read only the needed pack slices.');
  const concurrentTrackedPatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { walkConcurrency: 32 });
  assert.equal(manyTrackedPatch, concurrentTrackedPatch, 'Serial and concurrent walks should produce identical patches.');
  const onePathPatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { filepaths: ['tracked-many/500.txt'] });
  assert.match(onePathPatch, /tracked-many\/500\.txt/);
  assert.doesNotMatch(onePathPatch, /tracked-many\/499\.txt/);
  await writeFile(join(root, 'tracked-many', '500.txt'), 'before\n');
  const cappedPatch = await readLocalRepository(directory(root));
  assert.match(cappedPatch, /diff --git a\/tracked-many\/499\.txt b\/tracked-many\/499\.txt/);
  const largePath = join(root, 'large.bin');
  await writeFile(largePath, Buffer.alloc(3_000_000, 42));
  const largePatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { filepaths: ['large.bin'] });
  assert.match(largePatch, /Ming-Binary-Fingerprint: git::sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(largePatch, /@@ /);
  run('add', 'large.bin');
  run('commit', '-m', 'add large binary');
  await writeFile(largePath, Buffer.alloc(3_000_001, 43));
  const modifiedLargePatch = await readLocalRepository(directory(root), 'HEAD', undefined, undefined, { filepaths: ['large.bin'] });
  assert.match(modifiedLargePatch, /Ming-Binary-Fingerprint: git:[a-f0-9]{40}:sha256:[a-f0-9]{64}/);
  assert.equal(largeArrayBufferReads, 0, 'Large files should be hashed from a stream.');
  console.log('Local repository integration test passed');
} finally { await rm(root, { recursive: true, force: true }); }

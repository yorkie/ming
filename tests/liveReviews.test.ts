import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Project } from '../src/lib/projectStore';

const observers = new Map<string, (records: { type: string; relativePathComponents: string[] }[]) => void>();
const scanned: string[] = [];
const requests: Array<{ directory: FileSystemDirectoryHandle; filepaths?: string[] }> = [];
const heldWorkers = new Map<string, () => void>();
function directory(name: string, root = true): FileSystemDirectoryHandle {
  return { kind: 'directory', name, root } as unknown as FileSystemDirectoryHandle;
}
const gitRoot = await mkdtemp(join(tmpdir(), 'ming-live-git-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: gitRoot, stdio: 'pipe' }).toString().trim();
git('init', '-b', 'main');
git('config', 'user.name', 'Ming Test');
git('config', 'user.email', 'ming@example.test');
await mkdir(join(gitRoot, 'src'));
await writeFile(join(gitRoot, 'src', 'changed.rs'), 'before\n');
git('add', '.');
git('commit', '-m', 'baseline');
git('branch', 'baseline');
const browserWindow = new EventTarget() as EventTarget & { setTimeout: typeof setTimeout; setInterval: typeof setInterval };
browserWindow.setTimeout = ((callback: TimerHandler) => setTimeout(callback as () => void, 0)) as typeof setTimeout;
browserWindow.setInterval = (() => 1) as typeof setInterval;
Object.assign(globalThis, { window: browserWindow, document: Object.assign(new EventTarget(), { visibilityState: 'visible', createElement: () => ({}), documentElement: { lang: 'en' } }), localStorage: { getItem: () => null } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: null } });
Object.assign(Object.prototype, {
  queryPermission: async () => 'granted',
  getFileHandle: async function (this: { root?: boolean; rootPath?: string }, child: string) {
    if (this.rootPath) {
      const path = join(this.rootPath, child);
      if ((await stat(path).catch(() => null))?.isFile()) return { kind: 'file', name: child, rootPath: path };
      throw new Error('not a file');
    }
    if (this.root && child === '.gitignore') return { kind: 'file', name: child };
    throw new Error('not a file');
  },
  getDirectoryHandle: async function (this: { root?: boolean; rootPath?: string }, child: string) {
    if (this.rootPath) {
      const path = join(this.rootPath, child);
      if ((await stat(path).catch(() => null))?.isDirectory()) return { kind: 'directory', name: child, rootPath: path };
      throw new Error('not a directory');
    }
    if (this.root && ['.git', 'src', 'target'].includes(child)) return directory(child, false);
    if (!this.root && ['debug', '.fingerprint'].includes(child)) return directory(child, false);
    throw new Error('not a directory');
  },
  getFile: async function (this: { name?: string; rootPath?: string }) {
    if (this.rootPath) {
      const bytes = await readFile(this.rootPath);
      const info = await stat(this.rootPath);
      return { size: bytes.length, lastModified: info.mtimeMs, arrayBuffer: async () => Uint8Array.from(bytes).buffer } as File;
    }
    if (this.name !== '.gitignore') throw new Error('not a file');
    const bytes = new TextEncoder().encode('target/\n*.log\n');
    return { size: bytes.length, lastModified: 0, arrayBuffer: async () => bytes.buffer } as File;
  },
  values: async function* (this: { rootPath?: string }) {
    if (!this.rootPath) return;
    for (const name of await readdir(this.rootPath)) {
      const path = join(this.rootPath, name);
      yield { kind: (await stat(path)).isDirectory() ? 'directory' : 'file', name, rootPath: path };
    }
  },
});
Object.assign(globalThis, {
  FileSystemObserver: class {
    constructor(private callback: (records: { type: string; relativePathComponents: string[] }[]) => void) {}
    async observe(handle: FileSystemDirectoryHandle) { observers.set(handle.name, this.callback); }
    disconnect() {}
  },
  Worker: class {
    onmessage?: (event: MessageEvent) => void;
    constructor(_url: URL, _options: WorkerOptions) {}
    postMessage(request: { directory: FileSystemDirectoryHandle; filepaths?: string[] }) {
      scanned.push(request.directory.name);
      requests.push(request);
      const complete = () => queueMicrotask(() => this.onmessage?.({ data: { type: 'done', data: null,
        gitInfo: { currentBranch: 'main', headOid: request.directory.name === 'gitmeta' ? git('rev-parse', 'HEAD') : null },
        baseRef: request.directory.name === 'gitmeta' ? 'baseline' : 'HEAD',
        baseOid: request.directory.name === 'gitmeta' ? git('rev-parse', 'baseline') : null } } as MessageEvent));
      if (request.directory.name === 'slow') {
        this.onmessage?.({ data: { type: 'progress', message: 'Generating diff 1 of 2: src/changed.rs' } } as MessageEvent);
        heldWorkers.set('slow', complete);
      }
      else complete();
    }
    terminate() {}
  },
});

const { rememberProject } = await import('../src/lib/projectStore');
const { liveReviewStatuses, pauseLiveReviewForScan, refreshLiveReviews, startLiveReviews, stopLiveReviews } = await import('../src/lib/liveReviews');
for (const [index, name] of ['ming', 'ink'].entries()) {
  await rememberProject({ id: name, name, directory: directory(name),
    addedAt: index, settings: { baseRef: 'HEAD', liveReview: true } } satisfies Project);
}
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), 'Background review did not reach the expected state.');
}
const actualNow = Date.now;
let now = 1_000;
Date.now = () => now;
try {
  startLiveReviews();
  await until(() => observers.size === 2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 0, 'Observer startup should not scan every project.');
  observers.get('ming')!([{ type: 'modified', relativePathComponents: ['.git', 'refs', 'codex', 'turn-diffs', 'checkpoints', 'snapshot'] }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 0, 'Internal Codex refs must not trigger a scan.');
  observers.get('ink')!([{ type: 'modified', relativePathComponents: ['src', 'seed.rs'] }]);
  observers.get('ming')!([{ type: 'modified', relativePathComponents: ['src', 'seed.rs'] }]);
  await until(() => scanned.length === 2 && liveReviewStatuses.get('ink')?.phase === 'watching');
  assert.deepEqual(scanned.sort(), ['ink', 'ming']);
  assert.equal(liveReviewStatuses.get('ink')?.mode, 'observer');
  const prepared = await pauseLiveReviewForScan('ink', new AbortController().signal);
  assert.equal(prepared.cached?.hadData, false, 'Manual scan should reuse a completed observed scan.');
  assert.equal(prepared.isCurrent(), true);
  prepared.resume();
  now += 10_000;
  browserWindow.dispatchEvent(new Event('focus'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 2, 'Focus must not rescan every observer project.');
  observers.get('ink')!([{ type: 'modified', relativePathComponents: ['target', 'debug', '.fingerprint', 'ink-core', 'doc-lib-ink_core.json'] }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 2, 'An ignored build file must not schedule a scan.');
  assert.equal(liveReviewStatuses.get('ink')?.detail, 'Last event: src/seed.rs', 'Ignored events must not replace the last relevant event.');
  observers.get('ink')!([{ type: 'appeared', relativePathComponents: ['target'] }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 2, 'An ignored directory must not schedule a scan.');
  observers.get('ink')!([{ type: 'modified', relativePathComponents: ['src', 'changed.rs'] }]);
  await until(() => scanned.length === 3 && liveReviewStatuses.get('ink')?.phase === 'watching');
  assert.equal(scanned.at(-1), 'ink');
  assert.deepEqual(requests.at(-1)?.filepaths, ['src/changed.rs']);
  assert.equal(liveReviewStatuses.get('ink')?.detail, 'Last event: src/changed.rs');
  assert.equal(liveReviewStatuses.get('ming')?.detail, 'Last event: src/seed.rs');
  observers.get('ink')!([{ type: 'modified', relativePathComponents: ['src', '.gitignore'] }]);
  await until(() => scanned.length === 4 && liveReviewStatuses.get('ink')?.phase === 'watching');
  assert.equal(requests.at(-1)?.filepaths, undefined, 'Ignore rule changes require a full scan.');
  observers.get('ink')!([{ type: 'errored', relativePathComponents: [] }]);
  assert.equal(liveReviewStatuses.get('ink')?.mode, 'timer', 'Observer failure should report its active timer fallback.');
  now += 31_000;
  browserWindow.dispatchEvent(new Event('focus'));
  await until(() => scanned.length === 5 && liveReviewStatuses.get('ink')?.phase === 'polling');
  assert.equal(scanned.at(-1), 'ink', 'Timer catch-up must not scan the other project.');
  assert.equal(requests.at(-1)?.filepaths, undefined, 'Timer fallback requires a full scan.');
  await rememberProject({ id: 'gitmeta', name: 'gitmeta', directory: { kind: 'directory', name: 'gitmeta', rootPath: gitRoot } as unknown as FileSystemDirectoryHandle,
    addedAt: 3, settings: { baseRef: 'baseline', liveReview: true } } satisfies Project);
  await refreshLiveReviews();
  await until(() => observers.has('gitmeta'));
  const beforeMetadata = scanned.length;
  observers.get('gitmeta')!([{ type: 'modified', relativePathComponents: ['.git', 'HEAD'] }]);
  await until(() => liveReviewStatuses.get('gitmeta')?.detail === 'Last Git event: .git/HEAD');
  assert.equal(scanned.length, beforeMetadata, 'Git metadata without a scan baseline must not scan contents.');
  observers.get('gitmeta')!([{ type: 'modified', relativePathComponents: ['src', 'changed.rs'] }]);
  await until(() => scanned.length === beforeMetadata + 1 && liveReviewStatuses.get('gitmeta')?.phase === 'watching');
  await writeFile(join(gitRoot, 'src', 'changed.rs'), 'after\n');
  git('add', '.');
  git('commit', '-m', 'next commit');
  const nextOid = git('rev-parse', 'HEAD');
  observers.get('gitmeta')!([{ type: 'modified', relativePathComponents: ['.git', 'index'] }]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, beforeMetadata + 1, 'Git index writes must not scan working-tree contents.');
  observers.get('gitmeta')!([{ type: 'modified', relativePathComponents: ['.git', 'refs', 'heads', 'main'] }]);
  await until(() => liveReviewStatuses.get('gitmeta')?.detail === 'Last Git event: .git/refs/heads/main');
  assert.equal(scanned.length, beforeMetadata + 1, 'A HEAD change with the same comparison ref must only read Git metadata.');
  const metaScan = await pauseLiveReviewForScan('gitmeta', new AbortController().signal);
  assert.equal(metaScan.cached?.gitInfo.headOid, nextOid);
  metaScan.resume();
  git('update-ref', 'refs/heads/baseline', nextOid);
  observers.get('gitmeta')!([{ type: 'modified', relativePathComponents: ['.git', 'refs', 'heads', 'baseline'] }]);
  await until(() => scanned.length === beforeMetadata + 2 && liveReviewStatuses.get('gitmeta')?.phase === 'watching');
  assert.equal(requests.at(-1)?.filepaths, undefined, 'A changed comparison ref requires a full diff.');
  await rememberProject({ id: 'slow', name: 'slow', directory: directory('slow'),
    addedAt: 4, settings: { baseRef: 'HEAD', liveReview: true } } satisfies Project);
  await refreshLiveReviews();
  await until(() => observers.has('slow'));
  observers.get('slow')!([{ type: 'modified', relativePathComponents: ['src', 'changed.rs'] }]);
  await until(() => heldWorkers.has('slow'));
  assert.equal(liveReviewStatuses.get('slow')?.detail, 'Generating diff 1 of 2: src/changed.rs');
  const beforeManual = scanned.length;
  const awaitingScan = pauseLiveReviewForScan('slow', new AbortController().signal);
  heldWorkers.get('slow')!();
  const joined = await awaitingScan;
  assert.equal(joined.cached?.hadData, false, 'Manual scan should join the running background scan.');
  assert.equal(scanned.length, beforeManual, 'Joining must not start another worker.');
  joined.resume();
} finally {
  stopLiveReviews();
  Date.now = actualNow;
  delete (Object.prototype as { queryPermission?: unknown }).queryPermission;
  delete (Object.prototype as { getFileHandle?: unknown }).getFileHandle;
  delete (Object.prototype as { getDirectoryHandle?: unknown }).getDirectoryHandle;
  delete (Object.prototype as { getFile?: unknown }).getFile;
  delete (Object.prototype as { values?: unknown }).values;
  await rm(gitRoot, { recursive: true, force: true });
}
console.log('Live review observer isolation test passed');

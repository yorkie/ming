import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import type { Project } from '../src/lib/projectStore';

const observers = new Map<string, (records: { type: string; relativePathComponents: string[] }[]) => void>();
const scanned: string[] = [];
const browserWindow = new EventTarget() as EventTarget & { setTimeout: typeof setTimeout; setInterval: typeof setInterval };
browserWindow.setTimeout = ((callback: TimerHandler) => setTimeout(callback as () => void, 0)) as typeof setTimeout;
browserWindow.setInterval = (() => 1) as typeof setInterval;
Object.assign(globalThis, { window: browserWindow, document: Object.assign(new EventTarget(), { visibilityState: 'visible', createElement: () => ({}), documentElement: { lang: 'en' } }), localStorage: { getItem: () => null } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: null } });
Object.assign(Object.prototype, { queryPermission: async () => 'granted' });
Object.assign(globalThis, {
  FileSystemObserver: class {
    constructor(private callback: (records: { type: string; relativePathComponents: string[] }[]) => void) {}
    async observe(handle: FileSystemDirectoryHandle) { observers.set(handle.name, this.callback); }
    disconnect() {}
  },
  Worker: class {
    onmessage?: (event: MessageEvent) => void;
    constructor(_url: URL, _options: WorkerOptions) {}
    postMessage(request: { directory: FileSystemDirectoryHandle }) {
      scanned.push(request.directory.name);
      queueMicrotask(() => this.onmessage?.({ data: { type: 'done', data: null, gitInfo: { currentBranch: 'main', headOid: null }, baseRef: 'HEAD' } } as MessageEvent));
    }
    terminate() {}
  },
});

const { rememberProject } = await import('../src/lib/projectStore');
const { liveReviewStatuses, startLiveReviews, stopLiveReviews } = await import('../src/lib/liveReviews');
for (const [index, name] of ['ming', 'ink'].entries()) {
  await rememberProject({ id: name, name, directory: { kind: 'directory', name } as FileSystemDirectoryHandle,
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
  await until(() => scanned.length === 2 && observers.size === 2);
  assert.deepEqual(scanned.sort(), ['ink', 'ming']);
  assert.equal(liveReviewStatuses.get('ink')?.mode, 'observer');
  now += 10_000;
  browserWindow.dispatchEvent(new Event('focus'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scanned.length, 2, 'Focus must not rescan every observer project.');
  observers.get('ink')!([{ type: 'modified', relativePathComponents: ['src', 'changed.rs'] }]);
  await until(() => scanned.length === 3 && liveReviewStatuses.get('ink')?.phase === 'watching');
  assert.equal(scanned.at(-1), 'ink');
  assert.equal(liveReviewStatuses.get('ink')?.detail, 'Last event: src/changed.rs');
  assert.equal(liveReviewStatuses.get('ming')?.detail, undefined);
  observers.get('ink')!([{ type: 'errored', relativePathComponents: [] }]);
  assert.equal(liveReviewStatuses.get('ink')?.mode, 'timer', 'Observer failure should report its active timer fallback.');
  now += 31_000;
  browserWindow.dispatchEvent(new Event('focus'));
  await until(() => scanned.length === 4 && liveReviewStatuses.get('ink')?.phase === 'polling');
  assert.equal(scanned.at(-1), 'ink', 'Timer catch-up must not scan the other project.');
} finally {
  stopLiveReviews();
  Date.now = actualNow;
  delete (Object.prototype as { queryPermission?: unknown }).queryPermission;
}
console.log('Live review observer isolation test passed');

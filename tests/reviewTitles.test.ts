import 'fake-indexeddb/auto';
import { strict as assert } from 'node:assert';
import { defaultGlobalSettings, saveGlobalSettings } from '../src/lib/globalSettings';
import { listReviews, saveReviewSnapshot, type Project } from '../src/lib/projectStore';
import { generateReviewTitleInBackground } from '../src/lib/reviewTitles';

const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
} });
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  request: Record<string, unknown> | null = null;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: Record<string, unknown>) { this.request = request; }
  terminate() {}
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });

saveGlobalSettings({ ...defaultGlobalSettings, copilotDeepSeekApiKey: 'test-key' });
const project: Project = { id: 'project-title', name: 'sample', directory: {} as FileSystemDirectoryHandle,
  addedAt: 1, settings: { baseRef: 'HEAD' } };
const review = await saveReviewSnapshot({ id: 'review-title', projectId: project.id, createdAt: 1,
  branch: 'main', baseRef: 'HEAD', data: '{"files":[{"path":"a.ts"}]}', snapshotHash: 'first' });
const changed = new Promise<void>(resolve => window.addEventListener('ming:reviews-changed', () => resolve(), { once: true }));
generateReviewTitleInBackground(project, review);
const worker = FakeWorker.instances[0]!;
assert.equal(worker.request?.taskKind, 'review-title');
assert.equal(worker.request?.summaryLanguage, defaultGlobalSettings.copilotSummaryLanguage);
assert.equal((await listReviews(project.id))[0].title, undefined);
worker.onmessage?.({ data: { type: 'done', artifact: { schemaVersion: 1, snapshotHash: 'first', model: 'deepseek-flash', title: 'Summarize changes' } } } as MessageEvent);
await changed;
assert.equal((await listReviews(project.id))[0].title, 'Summarize changes');

const updated = await saveReviewSnapshot({ ...review, createdAt: 2, data: '{"files":[{"path":"b.ts"}]}', snapshotHash: 'second' });
assert.equal(updated.title, undefined);
generateReviewTitleInBackground(project, updated);
assert.equal(FakeWorker.instances.length, 2);
FakeWorker.instances[1]!.onmessage?.({ data: { type: 'done', artifact: { schemaVersion: 1, snapshotHash: 'first', model: 'deepseek-flash', title: 'Old changes' } } } as MessageEvent);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal((await listReviews(project.id))[0].title, undefined);
console.log('Review title background task test passed');

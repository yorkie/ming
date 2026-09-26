import { reactive } from 'vue';
import { loadGlobalSettings } from './globalSettings';
import { deleteReview, listProjects, listReviews, saveReviewSnapshot, type Project } from './projectStore';
import type { RepositoryInfo } from './localRepository';
import type { Review } from './reviewTypes';
import { language, t } from './i18n';
import { generateReviewTitleInBackground } from './reviewTitles';

type ObserverRecord = { type: string; relativePathComponents: string[] };
type Observer = { observe(handle: FileSystemDirectoryHandle, options: { recursive: boolean }): Promise<void>; disconnect(): void };
type ObserverConstructor = new (callback: (records: ObserverRecord[]) => void) => Observer;
type ScanResult = { data: string | null; snapshotHash?: string; gitInfo: RepositoryInfo; baseRef: string };
type Job = { project: Project; mode: 'observer' | 'timer'; observer?: Observer; timer?: number; debounce?: number; running: boolean; pending: boolean; paused: boolean; stopped: boolean; lastRun: number; lastObservedPath?: string; worker?: Worker; cancelWorker?: () => void; active?: Promise<void> };

export type LiveReviewStatus = { phase: 'watching' | 'polling' | 'scanning' | 'permission' | 'error'; mode?: 'observer' | 'timer'; detail?: string };
export const liveReviewStatuses = reactive(new Map<string, LiveReviewStatus>());
const jobs = new Map<string, Job>();
let started = false;

function status(job: Job, phase: LiveReviewStatus['phase'], detail?: string) {
  liveReviewStatuses.set(job.project.id, { phase, mode: job.observer ? 'observer' : job.timer ? 'timer' : undefined, detail });
}
function notify(projectId: string) { window.dispatchEvent(new CustomEvent('ming:reviews-changed', { detail: { projectId } })); }
function waitForWorker<T>(worker: Worker, request: unknown, job: Job): Promise<T> {
  job.worker = worker;
  return new Promise<T>((resolve, reject) => {
    job.cancelWorker = () => reject(new DOMException('Background task stopped', 'AbortError'));
    worker.onmessage = (event: MessageEvent<{ type: string; message?: string } & T>) => {
      if (event.data.type === 'done') resolve(event.data);
      else if (event.data.type === 'error') reject(new Error(event.data.message ?? 'Background worker failed'));
    };
    worker.onerror = event => reject(new Error(event.message || 'Background worker stopped'));
    worker.postMessage(request);
  }).finally(() => { worker.terminate(); if (job.worker === worker) { job.worker = undefined; job.cancelWorker = undefined; } });
}
async function reconcile(job: Job) {
  const selected = job.project;
  status(job, 'scanning', job.observer && job.lastObservedPath ? `${t('Observer event')}: ${job.lastObservedPath}` : undefined);
  const scanned = await waitForWorker<ScanResult>(new Worker(new URL('../workers/scanWorker.ts', import.meta.url), { type: 'module' }),
    { directory: selected.directory, baseRef: selected.settings.baseRef, uiLanguage: language.value }, job);
  if (job.stopped) return;
  const existing = (await listReviews(selected.id)).find(item => item.branch === scanned.gitInfo.currentBranch && item.baseRef === scanned.baseRef);
  const data = scanned.data ? JSON.parse(scanned.data) as Review : null;
  if (!data?.files.length) {
    if (existing) { await deleteReview(existing.id); notify(selected.id); }
    return;
  }
  const unchanged = existing && existing.snapshotHash === scanned.snapshotHash && existing.headOid === scanned.gitInfo.headOid;
  if (unchanged) return;
  const saved = await saveReviewSnapshot({ id: crypto.randomUUID(), projectId: selected.id, createdAt: Date.now(),
    branch: scanned.gitInfo.currentBranch, baseRef: scanned.baseRef, headOid: scanned.gitInfo.headOid,
    fileCount: data.files.length, data: scanned.data!, snapshotHash: scanned.snapshotHash });
  notify(selected.id);
  generateReviewTitleInBackground(selected, saved);
}
async function run(job: Job) {
  if (job.paused) { job.pending = true; return; }
  if (job.stopped) return;
  if (job.running) { job.pending = true; return; }
  job.running = true;
  job.lastRun = Date.now();
  try {
    if (navigator.locks) {
      await navigator.locks.request(`ming-live-review:${job.project.id}`, { ifAvailable: true }, async lock => {
        if (lock) await reconcile(job);
      });
    } else await reconcile(job);
    if (!job.stopped) status(job, job.observer ? 'watching' : 'polling', job.observer && job.lastObservedPath ? `${t('Last event')}: ${job.lastObservedPath}` : undefined);
  } catch (error) {
    if (!job.stopped && !job.paused) status(job, 'error', error instanceof Error ? error.message : String(error));
  } finally {
    job.running = false;
    if (job.pending && !job.paused && !job.stopped) {
      job.pending = false;
      schedule(job);
    }
  }
}
function schedule(job: Job, immediate = false) {
  if (job.stopped) return;
  job.pending = true;
  if (job.debounce) clearTimeout(job.debounce);
  const delay = immediate ? 0 : Math.max(2_000, 10_000 - (Date.now() - job.lastRun));
  job.debounce = window.setTimeout(() => { job.debounce = undefined; job.pending = false; job.active = run(job); }, delay);
}
async function watchProject(job: Job) {
  if (await job.project.directory.queryPermission({ mode: 'read' }) !== 'granted') {
    status(job, 'permission');
    return;
  }
  const ObserverType = (globalThis as typeof globalThis & { FileSystemObserver?: ObserverConstructor }).FileSystemObserver;
  if (job.mode === 'observer' && ObserverType) {
    try {
      const observer = new ObserverType(records => {
        if (records.some(record => record.type === 'errored')) {
          observer.disconnect(); job.observer = undefined; startTimer(job); return;
        }
        if (records.length) {
          job.lastObservedPath = records[0]?.relativePathComponents.join('/') || '.';
          schedule(job);
        }
      });
      await observer.observe(job.project.directory, { recursive: true });
      if (job.stopped) { observer.disconnect(); return; }
      job.observer = observer;
      status(job, 'watching');
    } catch { startTimer(job); }
  } else startTimer(job);
  schedule(job, true);
}
function startTimer(job: Job) {
  if (job.stopped || job.timer) return;
  job.timer = window.setInterval(() => schedule(job), 30_000);
  status(job, 'polling');
}
function stopJob(job: Job) {
  job.stopped = true;
  job.observer?.disconnect();
  if (job.timer) clearInterval(job.timer);
  if (job.debounce) clearTimeout(job.debounce);
  job.cancelWorker?.();
  liveReviewStatuses.delete(job.project.id);
}
export async function refreshLiveReviews() {
  if (!started) return;
  const projects = await listProjects();
  const mode = loadGlobalSettings().fileChangeDetection;
  const enabled = new Map(projects.filter(project => project.settings.liveReview !== false).map(project => [project.id, project]));
  for (const [id, job] of jobs) {
    const current = enabled.get(id);
    if (!current || current.settings.baseRef !== job.project.settings.baseRef || job.mode !== mode) {
      stopJob(job); jobs.delete(id);
    }
  }
  for (const project of enabled.values()) {
    if (jobs.has(project.id)) continue;
    const job: Job = { project, mode, running: false, pending: false, paused: false, stopped: false, lastRun: 0 };
    jobs.set(project.id, job);
    void watchProject(job).catch(error => status(job, 'error', error instanceof Error ? error.message : String(error)));
  }
}
function onVisibility() {
  if (document.visibilityState === 'hidden') return;
  void refreshLiveReviews();
  for (const job of jobs.values()) {
    if (liveReviewStatuses.get(job.project.id)?.phase === 'permission') void watchProject(job);
    else if (job.timer && Date.now() - job.lastRun > 30_000) schedule(job, true);
  }
}
export function startLiveReviews() {
  if (started) return;
  started = true;
  window.addEventListener('ming:settings-changed', refreshLiveReviews);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onVisibility);
  void refreshLiveReviews();
}
export async function pauseLiveReview(projectId: string): Promise<() => void> {
  const job = jobs.get(projectId);
  if (!job) return () => {};
  job.paused = true;
  if (job.running) job.pending = true;
  job.cancelWorker?.();
  await job.active?.catch(() => {});
  return () => {
    if (job.stopped) return;
    job.paused = false;
    if (job.pending) { job.pending = false; schedule(job); }
  };
}
export function stopLiveReviews() {
  started = false;
  window.removeEventListener('ming:settings-changed', refreshLiveReviews);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('focus', onVisibility);
  for (const job of jobs.values()) stopJob(job);
  jobs.clear();
}

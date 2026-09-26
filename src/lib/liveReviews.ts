import { reactive } from 'vue';
import { loadGlobalSettings } from './globalSettings';
import { deleteReview, listProjects, listReviews, rememberReview, saveReviewSnapshot, type Project } from './projectStore';
import { createRepositoryIgnoreChecker, inspectRepository, resolveComparisonOid, resolveComparisonRef, type RepositoryInfo } from './localRepository';
import type { Review } from './reviewTypes';
import { language, t } from './i18n';
import { generateReviewTitleInBackground } from './reviewTitles';

type ObserverRecord = { type: string; relativePathComponents: string[] };
type Observer = { observe(handle: FileSystemDirectoryHandle, options: { recursive: boolean }): Promise<void>; disconnect(): void };
type ObserverConstructor = new (callback: (records: ObserverRecord[]) => void) => Observer;
type ScanResult = { data: string | null; snapshotHash?: string; gitInfo: RepositoryInfo; baseRef: string; baseOid: string | null };
type CachedScan = { gitInfo: RepositoryInfo; baseRef: string; baseOid: string | null; snapshotHash?: string; hadData: boolean };
type Job = { project: Project; mode: 'observer' | 'timer'; observer?: Observer; timer?: number; debounce?: number; running: boolean; pending: boolean; paused: boolean; stopped: boolean; lastRun: number; lastObservedPath?: string; lastGitPath?: string; lastEventKind?: 'content' | 'git'; worker?: Worker; cancelWorker?: () => void; active?: Promise<void>; observerEvents?: Promise<void>; isIgnored: (path: string) => Promise<boolean>; ignoredDirectories: Map<string, boolean>; metadataDirty: boolean; contentPending: boolean; fullScan: boolean; dirtyPaths: Set<string>; changeVersion: number; lastHeadOid?: string | null; lastBaseRef?: string; lastBaseOid?: string | null; lastBranch?: string | null; lastHadReview?: boolean; lastCompleted?: CachedScan };

export type LiveReviewStatus = { phase: 'watching' | 'polling' | 'metadata' | 'scanning' | 'permission' | 'error'; mode?: 'observer' | 'timer'; detail?: string };
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
      else if (event.data.type === 'progress' && event.data.message) status(job, 'scanning', event.data.message);
    };
    worker.onerror = event => reject(new Error(event.message || 'Background worker stopped'));
    worker.postMessage(request);
  }).finally(() => { worker.terminate(); if (job.worker === worker) { job.worker = undefined; job.cancelWorker = undefined; } });
}
async function reconcile(job: Job) {
  const selected = job.project;
  const fullScan = job.fullScan || !job.observer || !job.lastBaseRef || !job.dirtyPaths.size;
  const filepaths = fullScan ? undefined : [...job.dirtyPaths];
  job.fullScan = false;
  job.dirtyPaths.clear();
  status(job, 'scanning', job.observer && job.lastObservedPath ? `${t('Observer event')}: ${job.lastObservedPath}` : undefined);
  let scanned: ScanResult;
  try {
    const existing = filepaths ? (await listReviews(selected.id)).find(item => item.branch === job.lastBranch && item.baseRef === job.lastBaseRef) : undefined;
    scanned = await waitForWorker<ScanResult>(new Worker(new URL('../workers/scanWorker.ts', import.meta.url), { type: 'module' }),
      { directory: selected.directory, baseRef: selected.settings.baseRef, source: 'background', uiLanguage: language.value, filepaths,
        previousData: filepaths ? existing?.data ?? null : undefined, expectedHeadOid: job.lastHeadOid,
        expectedBaseRef: job.lastBaseRef, expectedBaseOid: job.lastBaseOid,
        expectedBranch: job.lastBranch, expectedDataPresent: job.lastHadReview }, job);
  } catch (error) {
    job.contentPending = true;
    if (fullScan) job.fullScan = true;
    else for (const path of filepaths!) job.dirtyPaths.add(path);
    throw error;
  }
  if (job.stopped) return;
  job.lastHeadOid = scanned.gitInfo.headOid;
  job.lastBaseRef = scanned.baseRef;
  job.lastBaseOid = scanned.baseOid;
  job.lastBranch = scanned.gitInfo.currentBranch;
  job.lastHadReview = !!scanned.data;
  const existing = (await listReviews(selected.id)).find(item => item.branch === scanned.gitInfo.currentBranch && item.baseRef === scanned.baseRef);
  const data = scanned.data ? JSON.parse(scanned.data) as Review : null;
  if (!data?.files.length) {
    if (existing) { await deleteReview(existing.id); notify(selected.id); }
    job.lastCompleted = { gitInfo: scanned.gitInfo, baseRef: scanned.baseRef, baseOid: scanned.baseOid, hadData: false };
    return;
  }
  const unchanged = existing && existing.snapshotHash === scanned.snapshotHash && existing.headOid === scanned.gitInfo.headOid;
  if (unchanged) {
    job.lastCompleted = { gitInfo: scanned.gitInfo, baseRef: scanned.baseRef, baseOid: scanned.baseOid, snapshotHash: scanned.snapshotHash, hadData: true };
    return;
  }
  const saved = await saveReviewSnapshot({ id: crypto.randomUUID(), projectId: selected.id, createdAt: Date.now(),
    branch: scanned.gitInfo.currentBranch, baseRef: scanned.baseRef, headOid: scanned.gitInfo.headOid,
    fileCount: data.files.length, data: scanned.data!, snapshotHash: scanned.snapshotHash });
  notify(selected.id);
  generateReviewTitleInBackground(selected, saved);
  job.lastCompleted = { gitInfo: scanned.gitInfo, baseRef: scanned.baseRef, baseOid: scanned.baseOid, snapshotHash: scanned.snapshotHash, hadData: true };
}
async function refreshGitMetadata(job: Job) {
  status(job, 'metadata', job.lastGitPath);
  const gitInfo = await inspectRepository(job.project.directory);
  const baseRef = await resolveComparisonRef(job.project.directory, job.project.settings.baseRef, gitInfo.currentBranch);
  const baseOid = await resolveComparisonOid(job.project.directory, baseRef);
  if (!job.lastBaseRef) return;
  if (job.lastBranch !== gitInfo.currentBranch || job.lastBaseRef !== baseRef || job.lastBaseOid !== baseOid) {
    job.fullScan = true;
    job.contentPending = false;
    await reconcile(job);
    return;
  }
  if (job.lastHeadOid === gitInfo.headOid) return;
  job.lastHeadOid = gitInfo.headOid;
  if (job.lastCompleted) job.lastCompleted = { ...job.lastCompleted, gitInfo };
  const existing = (await listReviews(job.project.id)).find(item => item.branch === gitInfo.currentBranch && item.baseRef === baseRef);
  if (existing && existing.headOid !== gitInfo.headOid) {
    await rememberReview({ ...existing, headOid: gitInfo.headOid });
    notify(job.project.id);
  }
}
function lastEventDetail(job: Job): string | undefined {
  if (job.lastEventKind === 'git' && job.lastGitPath) return `${t('Last Git event')}: ${job.lastGitPath}`;
  if (job.lastObservedPath) return `${t('Last event')}: ${job.lastObservedPath}`;
  return undefined;
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
        if (lock) {
          if (job.contentPending) { job.contentPending = false; job.metadataDirty = false; await reconcile(job); }
          else if (job.metadataDirty) { job.metadataDirty = false; await refreshGitMetadata(job); }
        }
      });
    } else if (job.contentPending) { job.contentPending = false; job.metadataDirty = false; await reconcile(job); }
    else if (job.metadataDirty) { job.metadataDirty = false; await refreshGitMetadata(job); }
    if (!job.stopped) status(job, job.observer ? 'watching' : 'polling', job.observer ? lastEventDetail(job) : undefined);
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
async function ignoredObserverPath(job: Job, path: string): Promise<boolean> {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index++) {
    const directory = parts.slice(0, index).join('/');
    let ignored = job.ignoredDirectories.get(directory);
    if (ignored === undefined) {
      ignored = await job.isIgnored(`${directory}/`);
      job.ignoredDirectories.set(directory, ignored);
    }
    if (ignored) return true;
  }
  if (await job.isIgnored(path)) return true;
  // A directory-only rule such as target/ may not match the bare directory name.
  if (!await job.isIgnored(`${path}/`)) return false;
  try {
    let directory = job.project.directory;
    for (const part of parts) directory = await directory.getDirectoryHandle(part);
    job.ignoredDirectories.set(path, true);
    return true;
  } catch { return false; }
}
function relevantGitChange(job: Job, path: string): boolean {
  if (path === '.git' || path === '.git/HEAD' || path === '.git/config' || path === '.git/packed-refs') return true;
  if (!path.startsWith('.git/refs/')) return false;
  if (job.lastBranch && path === `.git/refs/heads/${job.lastBranch}`) return true;
  if (job.lastBaseRef && (path === `.git/refs/heads/${job.lastBaseRef}` || path === `.git/refs/remotes/${job.lastBaseRef}`)) return true;
  // Before the first scan, the active branch and comparison ref are unknown.
  return !job.lastBranch && (path.startsWith('.git/refs/heads/') || path.startsWith('.git/refs/remotes/'));
}
async function handleObserverRecords(job: Job, records: ObserverRecord[]) {
  if (job.stopped || !job.observer) return;
  let observedPath: string | undefined;
  for (const record of records) {
    const parts = record.relativePathComponents;
    const path = parts.join('/');
    if (!path || parts.includes('..')) {
      job.ignoredDirectories.clear();
      job.fullScan = true;
      job.contentPending = true;
      job.lastObservedPath = path || '.';
      job.lastEventKind = 'content';
    } else if (parts[0] === '.git') {
      if (!relevantGitChange(job, path)) continue;
      job.ignoredDirectories.clear();
      job.metadataDirty = true;
      job.lastGitPath = path;
      job.lastEventKind = 'git';
    } else if (parts.at(-1) === '.gitignore') {
      job.ignoredDirectories.clear();
      if (await ignoredObserverPath(job, path)) continue;
      job.fullScan = true;
      job.contentPending = true;
      job.lastObservedPath = path;
      job.lastEventKind = 'content';
    } else {
      if (await ignoredObserverPath(job, path)) continue;
      job.dirtyPaths.add(path);
      job.contentPending = true;
      job.lastObservedPath = path;
      job.lastEventKind = 'content';
    }
    observedPath ??= path || '.';
  }
  if (!observedPath || job.stopped) return;
  job.changeVersion++;
  if (job.dirtyPaths.size > 128) { job.fullScan = true; job.dirtyPaths.clear(); }
  schedule(job);
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
        if (records.length) job.observerEvents = (job.observerEvents ?? Promise.resolve())
          .then(() => handleObserverRecords(job, records))
          .catch(() => { if (!job.stopped) { job.fullScan = true; job.contentPending = true; job.ignoredDirectories.clear(); schedule(job); } });
      });
      await observer.observe(job.project.directory, { recursive: true });
      if (job.stopped) { observer.disconnect(); return; }
      job.observer = observer;
      status(job, 'watching');
    } catch { startTimer(job); }
  } else startTimer(job);
  if (!job.observer) schedule(job, true);
}
function startTimer(job: Job) {
  if (job.stopped || job.timer) return;
  job.fullScan = true;
  job.contentPending = true;
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
    const job: Job = { project, mode, running: false, pending: false, paused: false, stopped: false, lastRun: 0,
      isIgnored: createRepositoryIgnoreChecker(project.directory), ignoredDirectories: new Map(), metadataDirty: false, contentPending: false,
      fullScan: true, dirtyPaths: new Set(), changeVersion: 0 };
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

export async function pauseLiveReviewForScan(projectId: string, signal: AbortSignal): Promise<{ resume: () => void; cached: CachedScan | null; isCurrent: () => boolean; acceptResult: (result: ScanResult) => void }> {
  const job = jobs.get(projectId);
  if (!job) return { resume: () => {}, cached: null, isCurrent: () => false, acceptResult: () => {} };
  const wasRunning = job.running;
  const version = job.changeVersion;
  job.paused = true;
  if (job.debounce) { clearTimeout(job.debounce); job.debounce = undefined; job.pending = true; }
  const resume = () => {
    if (job.stopped) return;
    job.paused = false;
    if (job.pending) { job.pending = false; schedule(job); }
  };
  try {
    if (signal.aborted) throw new DOMException('Scan canceled', 'AbortError');
    if (job.active) {
      let onAbort: (() => void) | undefined;
      try {
        await Promise.race([job.active.catch(() => {}), new Promise<never>((_, reject) => {
          onAbort = () => reject(new DOMException('Scan canceled', 'AbortError'));
          signal.addEventListener('abort', onAbort, { once: true });
        })]);
      } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
    }
    if (signal.aborted) throw new DOMException('Scan canceled', 'AbortError');
  } catch (error) { resume(); throw error; }
  const cached = (job.observer || wasRunning) && !job.fullScan && !job.pending && !job.contentPending && !job.metadataDirty && !job.dirtyPaths.size ? job.lastCompleted ?? null : null;
  return { resume, cached, isCurrent: () => !job.stopped && job.paused && !job.fullScan && !job.pending && !job.contentPending && !job.metadataDirty && !job.dirtyPaths.size && job.lastCompleted === cached,
    acceptResult: result => {
      if (job.stopped) return;
      job.lastHeadOid = result.gitInfo.headOid;
      job.lastBaseRef = result.baseRef;
      job.lastBaseOid = result.baseOid;
      job.lastBranch = result.gitInfo.currentBranch;
      job.lastHadReview = !!result.data;
      job.lastCompleted = { gitInfo: result.gitInfo, baseRef: result.baseRef, baseOid: result.baseOid, snapshotHash: result.snapshotHash, hadData: !!result.data };
      if (job.changeVersion === version) { job.pending = false; job.contentPending = false; job.metadataDirty = false; job.fullScan = false; job.dirtyPaths.clear(); }
    } };
}
export function stopLiveReviews() {
  started = false;
  window.removeEventListener('ming:settings-changed', refreshLiveReviews);
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('focus', onVisibility);
  for (const job of jobs.values()) stopJob(job);
  jobs.clear();
}

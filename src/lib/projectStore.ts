import type { TopicReview } from './aiReviewTypes';
export type ProjectSettings = { baseRef: string; liveReview?: boolean; liveTopics?: boolean };
export type Project = {
  id: string;
  name: string;
  directory: FileSystemDirectoryHandle;
  addedAt: number;
  settings: ProjectSettings;
};
export type ReviewRecord = {
  id: string;
  projectId: string;
  createdAt: number;
  branch: string | null;
  baseRef: string;
  headOid?: string | null;
  data: string;
  fileCount?: number;
  snapshotHash?: string;
  aiReview?: TopicReview;
};
export type AiUsageRecord = {
  id: string;
  projectId: string;
  projectName: string;
  reviewId: string;
  createdAt: number;
  task: 'topic-review';
  provider: 'deepseek';
  model: string;
  group: number;
  attempt: number;
  status: 'success' | 'error';
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedPromptTokens: number | null;
};

// Browser-managed storage only. The selected Git repository is never written.
const DATABASE = 'ming-projects';
const VERSION = 2;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reviews')) {
        const reviews = db.createObjectStore('reviews', { keyPath: 'id' });
        reviews.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains('aiUsage')) {
        const usage = db.createObjectStore('aiUsage', { keyPath: 'id' });
        usage.createIndex('projectId', 'projectId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function requestInStore<T>(storeName: 'projects' | 'reviews' | 'aiUsage', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function listProjects(): Promise<Project[]> {
  return (await requestInStore<Project[]>('projects', 'readonly', store => store.getAll())).sort((a, b) => a.addedAt - b.addedAt);
}
export async function rememberProject(project: Project): Promise<void> {
  await requestInStore('projects', 'readwrite', store => store.put(project));
}
export async function listReviews(projectId: string): Promise<ReviewRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    const request = store.index('projectId').getAll(projectId);
    let reviews: ReviewRecord[] = [];
    request.onsuccess = () => {
      const sorted = request.result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const pairs = new Map<string, ReviewRecord>();
      for (const review of sorted) {
        const key = JSON.stringify([review.branch, review.baseRef]);
        const latest = pairs.get(key);
        if (!latest) { pairs.set(key, review); continue; }
        if (!latest.aiReview && review.aiReview && sameSnapshot(latest, review)) {
          latest.aiReview = review.aiReview;
          store.put(latest);
        }
        store.delete(review.id);
      }
      reviews = [...pairs.values()];
    };
    tx.oncomplete = () => { db.close(); resolve(reviews); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function sameSnapshot(a: ReviewRecord, b: ReviewRecord): boolean {
  return a.snapshotHash && b.snapshotHash ? a.snapshotHash === b.snapshotHash : a.data === b.data;
}
export async function rememberReview(review: ReviewRecord): Promise<void> {
  await requestInStore('reviews', 'readwrite', store => store.put(review));
}
export async function saveAiReviewIfCurrent(id: string, snapshotHash: string | undefined, aiReview: TopicReview, expectedData?: string): Promise<boolean> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (current && (snapshotHash
        ? current.snapshotHash === snapshotHash && aiReview.artifact.snapshotHash === snapshotHash
        : current.snapshotHash === undefined && current.data === expectedData)) {
        store.put({ ...current, snapshotHash: snapshotHash ?? aiReview.artifact.snapshotHash, aiReview });
        saved = true;
      }
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function deleteReview(id: string): Promise<void> {
  await requestInStore('reviews', 'readwrite', store => store.delete(id));
}
export async function recordAiUsage(record: AiUsageRecord): Promise<void> {
  await requestInStore('aiUsage', 'readwrite', store => store.put(record));
}
export async function listAiUsage(): Promise<AiUsageRecord[]> {
  return (await requestInStore<AiUsageRecord[]>('aiUsage', 'readonly', store => store.getAll()))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function saveReviewSnapshot(review: ReviewRecord): Promise<ReviewRecord> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    const request = store.index('projectId').getAll(review.projectId);
    let saved = review;
    request.onsuccess = () => {
      const matches = request.result
        .filter(item => item.branch === review.branch && item.baseRef === review.baseRef)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
      const matchingTopics = matches.find(item => item.aiReview && sameSnapshot(item, review));
      saved = { ...review, id: matches[0]?.id ?? review.id,
        aiReview: matchingTopics?.aiReview };
      for (const duplicate of matches.slice(1)) store.delete(duplicate.id);
      store.put(saved);
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  const reviewIds = (await listReviews(id)).map(review => review.id);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'reviews'], 'readwrite');
    tx.objectStore('projects').delete(id);
    const store = tx.objectStore('reviews');
    for (const reviewId of reviewIds) store.delete(reviewId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

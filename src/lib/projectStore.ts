import type { ReviewCommentArtifact, ReviewSeverity, ReviewTitleArtifact, TopicReview } from './aiReviewTypes';
import { historicalComments } from './reviewContinuity';
import { changeEventsForReview, nextChangeEvents, type ChangeEvent } from './reviewTimeline';
export type ProjectSettings = { baseRef: string; liveReview?: boolean; githubRepository?: string };
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
  updatedAt?: number;
  branch: string | null;
  baseRef: string;
  headOid?: string | null;
  data: string;
  fileCount?: number;
  snapshotHash?: string;
  title?: string;
  aiReview?: TopicReview;
  changeEvents?: ChangeEvent[];
};
export function topicsAreStale(review: ReviewRecord): boolean {
  if (!review.aiReview) return false;
  if (review.snapshotHash) return review.aiReview.artifact.snapshotHash !== review.snapshotHash;
  return !!review.aiReview.sourceData && review.aiReview.sourceData !== review.data;
}
export type AiUsageRecord = {
  id: string;
  projectId: string;
  projectName: string;
  reviewId: string;
  createdAt: number;
  task: 'topic-review' | 'review-title' | 'request-review';
  provider: 'deepseek' | 'openai';
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
      const sorted = request.result.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || b.id.localeCompare(a.id));
      const pairs = new Map<string, ReviewRecord>();
      for (const review of sorted) {
        const key = JSON.stringify([review.branch, review.baseRef]);
        const latest = pairs.get(key);
        if (!latest) { pairs.set(key, review); continue; }
        if ((!latest.aiReview || topicsAreStale(latest)) && review.aiReview && sameSnapshot(latest, review) && !topicsAreStale(review)) {
          latest.aiReview = review.aiReview;
          store.put(latest);
        }
        if (!latest.title && review.title && sameSnapshot(latest, review)) {
          latest.title = review.title;
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
export async function saveReviewCommentsIfCurrent(id: string, artifact: ReviewCommentArtifact, topicsCreatedAt: number): Promise<boolean> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (current?.aiReview && !topicsAreStale(current) && current.aiReview.createdAt === topicsCreatedAt
        && current.aiReview.artifact.snapshotHash === artifact.snapshotHash) {
        store.put({ ...current, aiReview: { ...current.aiReview, comments: artifact.comments, commentsCreatedAt: Date.now() } });
        saved = true;
      }
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveCommentDecision(id: string, commentId: string, status: 'resolved' | 'open'): Promise<TopicReview | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved: TopicReview | null = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      const review = current?.aiReview;
      if (!review || !historicalComments(review).some(comment => comment.id === commentId)) return;
      saved = { ...review, commentDecisions: { ...review.commentDecisions, [commentId]: status } };
      store.put({ ...current, aiReview: saved });
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function completeReviewChangeEvent(id: string, snapshotHash: string | undefined, completedAt: number): Promise<ReviewRecord | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved: ReviewRecord | null = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (!current || current.snapshotHash !== snapshotHash) return;
      const events = changeEventsForReview(current);
      const latest = events.at(-1);
      if (!latest || latest.reviewedAt) { saved = current; return; }
      saved = { ...current, changeEvents: [...events.slice(0, -1), { ...latest, reviewedAt: completedAt }] };
      store.put(saved);
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveTopicReviewResultIfCurrent(id: string, artifact: ReviewCommentArtifact, topicsCreatedAt: number,
  topicId: string, recommendations: string[], recommendationSeverities: (ReviewSeverity | null)[] = [],
  assessments: NonNullable<TopicReview['priorAssessments']> = {}): Promise<TopicReview | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved: TopicReview | null = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (!current?.aiReview || topicsAreStale(current) || current.aiReview.createdAt !== topicsCreatedAt ||
        current.aiReview.artifact.snapshotHash !== artifact.snapshotHash ||
        !current.aiReview.artifact.topics.some(topic => topic.id === topicId) ||
        artifact.comments.some(comment => comment.topicId !== topicId)) return;
      saved = { ...current.aiReview,
        comments: [...(current.aiReview.comments ?? []).filter(comment => comment.topicId !== topicId),
          ...artifact.comments.map(comment => ({ ...comment, id: `${current.aiReview!.reviewRunId ?? topicsCreatedAt}:${comment.id}` }))],
        recommendations: { ...current.aiReview.recommendations, [topicId]: recommendations },
        recommendationSeverities: { ...current.aiReview.recommendationSeverities, [topicId]: recommendationSeverities },
        priorAssessments: { ...current.aiReview.priorAssessments, ...assessments },
        commentsCreatedAt: Date.now() };
      store.put({ ...current, aiReview: saved });
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function clearTopicReviewResultsIfCurrent(id: string, topicsCreatedAt: number): Promise<TopicReview | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved: TopicReview | null = null;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (!current?.aiReview || topicsAreStale(current) || current.aiReview.createdAt !== topicsCreatedAt) return;
      const prior = current.aiReview;
      const previousComments = historicalComments(prior);
      saved = { ...prior, comments: [], reviewRunId: crypto.randomUUID(), previousComments,
        recommendations: {}, recommendationSeverities: {}, commentsCreatedAt: undefined,
        revisions: prior.commentsCreatedAt ? [...(prior.revisions ?? []), { artifact: prior.artifact, sourceData: prior.sourceData,
          reviewed: prior.reviewed, comments: prior.comments, recommendations: prior.recommendations,
          commentDecisions: prior.commentDecisions, createdAt: prior.commentsCreatedAt ?? Date.now(),
          commentsCreatedAt: prior.commentsCreatedAt }] : prior.revisions };
      store.put({ ...current, aiReview: saved, changeEvents: changeEventsForReview(current) });
    };
    tx.oncomplete = () => { db.close(); resolve(saved); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveReviewTitleIfCurrent(id: string, snapshotHash: string | undefined, artifact: ReviewTitleArtifact, expectedData?: string): Promise<boolean> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    let saved = false;
    const request = store.get(id);
    request.onsuccess = () => {
      const current = request.result as ReviewRecord | undefined;
      if (current && artifact.title.trim() && (snapshotHash
        ? current.snapshotHash === snapshotHash && artifact.snapshotHash === snapshotHash
        : current.snapshotHash === undefined && current.data === expectedData)) {
        store.put({ ...current, title: artifact.title.trim() });
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
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'aiUsage'], 'readwrite');
    const request = tx.objectStore('projects').get(record.projectId);
    request.onsuccess = () => { if (request.result) tx.objectStore('aiUsage').put(record); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function listAiUsage(): Promise<AiUsageRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'aiUsage'], 'readwrite');
    const projects = tx.objectStore('projects').getAllKeys();
    let records: AiUsageRecord[] = [];
    projects.onsuccess = () => {
      const active = new Set(projects.result);
      const usage = tx.objectStore('aiUsage');
      const request = usage.getAll();
      request.onsuccess = () => {
        records = request.result.filter(record => {
          if (active.has(record.projectId)) return true;
          usage.delete(record.id);
          return false;
        }).sort((a, b) => b.createdAt - a.createdAt);
      };
    };
    tx.oncomplete = () => { db.close(); resolve(records); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
export async function saveReviewSnapshot(review: ReviewRecord): Promise<ReviewRecord> {
  const existingReviews = await listReviews(review.projectId);
  const active = existingReviews.find(item => item.branch === review.branch && item.baseRef === review.baseRef);
  if (!active && existingReviews.length) {
    const blocking = existingReviews[0];
    if (blocking.baseRef === review.baseRef) throw new Error(`Review for ${review.baseRef} belongs to ${blocking.branch ?? 'detached HEAD'}. Close it before reviewing another source branch.`);
    throw new Error(`Close the review for ${blocking.baseRef} before creating another review.`);
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('reviews', 'readwrite');
    const store = tx.objectStore('reviews');
    const request = store.index('projectId').getAll(review.projectId);
    let saved = review;
    request.onsuccess = () => {
      const matches = request.result
        .filter(item => item.branch === review.branch && item.baseRef === review.baseRef)
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || b.id.localeCompare(a.id));
      const matchingTopics = matches.find(item => item.aiReview && sameSnapshot(item, review));
      const matchingTitle = matches.find(item => item.title && sameSnapshot(item, review));
      const previousTopics = matchingTopics ?? matches.find(item => item.aiReview);
      saved = { ...review, id: matches[0]?.id ?? review.id, createdAt: matches[0]?.createdAt ?? review.createdAt,
        updatedAt: review.createdAt,
        changeEvents: nextChangeEvents(matches[0], review, !!matches[0] && sameSnapshot(matches[0], review)),
        title: matchingTitle?.title,
        aiReview: previousTopics?.aiReview && {
          ...previousTopics.aiReview,
          sourceData: previousTopics.aiReview.sourceData ?? (!previousTopics.snapshotHash || previousTopics.snapshotHash === previousTopics.aiReview.artifact.snapshotHash ? previousTopics.data : undefined),
        } };
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
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['projects', 'reviews', 'aiUsage'], 'readwrite');
    tx.objectStore('projects').delete(id);
    for (const name of ['reviews', 'aiUsage'] as const) {
      const store = tx.objectStore(name);
      const keys = store.index('projectId').getAllKeys(id);
      keys.onsuccess = () => { for (const key of keys.result) store.delete(key); };
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = () => { db.close(); reject(tx.error); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

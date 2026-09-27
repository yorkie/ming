import type { ReviewRecord } from './projectStore';
import type { FileChange, Review } from './reviewTypes';

export type ChangeEvent = {
  id: string;
  startedAt: number;
  updatedAt: number;
  changeCount: number;
  paths: string[];
  snapshotHash?: string;
  reviewedAt?: number;
};

function parseReview(data: string): Review | null {
  try { const value = JSON.parse(data) as Review; return Array.isArray(value.files) ? value : null; }
  catch { return null; }
}

function comparable(file: FileChange): string { const { markdown: _markdown, ...content } = file; return JSON.stringify(content); }

export function changedFilePaths(before: Review | null, after: Review): string[] {
  if (!before) return after.files.map(file => file.path).filter(Boolean);
  const old = new Map(before.files.map(file => [file.path, comparable(file)]));
  const next = new Map(after.files.map(file => [file.path, comparable(file)]));
  return [...new Set([...old.keys(), ...next.keys()].filter(path => !!path && old.get(path) !== next.get(path)))];
}

export function changeEventsForReview(record: ReviewRecord): ChangeEvent[] {
  if (record.changeEvents?.length) {
    const events = record.changeEvents;
    const last = events[0];
    const updatedAt = record.updatedAt;
    // Earlier versions created a legacy event at the review's creation time
    // after Request Review, even though its pending node had used the last scan.
    const hadReviewBeforeScan = (record.aiReview?.revisions ?? []).some(revision => {
      const reviewedAt = revision.commentsCreatedAt;
      return reviewedAt && updatedAt && reviewedAt > record.createdAt && reviewedAt < updatedAt;
    });
    if (events.length === 1 && last && last.changeCount === 1 && last.startedAt === record.createdAt
      && last.updatedAt === record.createdAt && last.reviewedAt && updatedAt && last.reviewedAt > updatedAt
      && hadReviewBeforeScan) return [{ ...last, updatedAt }];
    return events;
  }
  const review = parseReview(record.data);
  if (!review?.files.length) return [];
  const updatedAt = record.updatedAt ?? record.createdAt;
  const reviewedAt = record.aiReview?.commentsCreatedAt;
  return [{ id: `initial-${record.id}`, startedAt: record.createdAt, updatedAt, changeCount: 1,
    paths: review.files.map(file => file.path).filter(Boolean), snapshotHash: record.snapshotHash,
    reviewedAt: reviewedAt && reviewedAt >= updatedAt ? reviewedAt : undefined }];
}

export function nextChangeEvents(previous: ReviewRecord | undefined, incoming: ReviewRecord, sameSnapshot: boolean): ChangeEvent[] {
  const prior = previous ? changeEventsForReview(previous) : [];
  if (previous && sameSnapshot) return prior;
  const current = parseReview(incoming.data);
  if (!current) return prior;
  const paths = changedFilePaths(previous ? parseReview(previous.data) : null, current);
  if (!paths.length) return prior;
  const last = prior.at(-1);
  if (last && !last.reviewedAt) return [...prior.slice(0, -1), { ...last, updatedAt: incoming.createdAt,
    changeCount: last.changeCount + 1, paths: [...new Set([...last.paths, ...paths])], snapshotHash: incoming.snapshotHash }];
  return [...prior, { id: crypto.randomUUID(), startedAt: incoming.createdAt, updatedAt: incoming.createdAt,
    changeCount: 1, paths, snapshotHash: incoming.snapshotHash }];
}

import type { Project, ReviewRecord } from './projectStore';
import type { Route } from './routes';

export type LastOpenedReview = { projectId: string; reviewId: string; tab: 'topics' | 'changes' | 'commits' };
const STORAGE_KEY = 'ming-last-opened-review-v1';

export function parseLastOpenedReview(value: string | null): LastOpenedReview | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const item = parsed as Partial<LastOpenedReview>;
    if (typeof item.projectId !== 'string' || !item.projectId || typeof item.reviewId !== 'string' || !item.reviewId ||
      !['topics', 'changes', 'commits'].includes(item.tab ?? '')) return null;
    return { projectId: item.projectId, reviewId: item.reviewId, tab: item.tab! };
  } catch { return null; }
}

export function loadLastOpenedReview(): LastOpenedReview | null {
  try { return parseLastOpenedReview(localStorage.getItem(STORAGE_KEY)); }
  catch { return null; }
}

export function rememberOpenedReview(route: Extract<Route, { kind: 'review' }>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectId: route.projectId, reviewId: route.reviewId, tab: route.page }));
    window.dispatchEvent(new Event('ming:last-review-changed'));
  } catch { /* Browser storage is optional; the current review remains open. */ }
}

export function clearLastOpenedReview(projectId: string, reviewId?: string): void {
  try {
    const current = loadLastOpenedReview();
    if (!current || current.projectId !== projectId || (reviewId && current.reviewId !== reviewId)) return;
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event('ming:last-review-changed'));
  } catch { /* Browser storage is optional. */ }
}

export function resolveLastOpenedReview(last: LastOpenedReview | null, projects: Project[], reviews: Record<string, ReviewRecord[]>):
  { project: Project; review: ReviewRecord; tab: LastOpenedReview['tab'] } | null {
  if (!last) return null;
  const project = projects.find(item => item.id === last.projectId);
  const review = reviews[last.projectId]?.find(item => item.id === last.reviewId);
  return project && review ? { project, review, tab: last.tab } : null;
}

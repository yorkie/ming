import type { ReviewSeverity } from './aiReviewTypes';

export function reviewSeverity(value: unknown): ReviewSeverity | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

export type PriorAssessment = { id: string; outcome: 'still-present' | 'possibly-fixed' | 'unclear'; reason: string };
export function parseReviewComments(content: string): { comments: unknown[]; recommendation?: string; recommendationSeverity?: ReviewSeverity; priorFindings?: PriorAssessment[] } {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Array.isArray((value as { comments?: unknown }).comments)) {
    throw new Error('Review response must contain a comments array.');
  }
  const recommendation = (value as { recommendation?: unknown }).recommendation;
  const recommendationSeverity = reviewSeverity((value as { recommendationSeverity?: unknown }).recommendationSeverity);
  const priorFindings = (value as { priorFindings?: unknown }).priorFindings;
  return { comments: (value as { comments: unknown[] }).comments,
    ...(Array.isArray(priorFindings) ? { priorFindings: priorFindings.filter((item): item is PriorAssessment => !!item && typeof item === 'object' &&
      typeof item.id === 'string' && ['still-present', 'possibly-fixed', 'unclear'].includes(item.outcome) &&
      typeof item.reason === 'string').map(item => ({ ...item, reason: item.reason.slice(0, 500) })) } : {}),
    ...(typeof recommendation === 'string' && recommendation.trim() ? { recommendation: recommendation.trim() } : {}),
    ...(recommendationSeverity ? { recommendationSeverity } : {}) };
}

export function parseReviewComments(content: string): { comments: unknown[]; recommendation?: string } {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !Array.isArray((value as { comments?: unknown }).comments)) {
    throw new Error('Review response must contain a comments array.');
  }
  const recommendation = (value as { recommendation?: unknown }).recommendation;
  return { comments: (value as { comments: unknown[] }).comments,
    ...(typeof recommendation === 'string' && recommendation.trim() ? { recommendation: recommendation.trim() } : {}) };
}

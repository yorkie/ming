import type { ReviewComment, TopicReview } from './aiReviewTypes';
import { historicalComments, visibleTopics } from './reviewContinuity';

export type TopicConversationRun = {
  id: string;
  createdAt?: number;
  comments: ReviewComment[];
  recommendations: string[];
  severities: (ReviewComment['severity'] | null)[];
  latest: boolean;
};

export function topicConversationRuns(review: TopicReview, topicId: string): TopicConversationRun[] {
  const aliases = visibleTopics(review).aliases;
  const belongs = (id: string) => (aliases[id] ?? id) === topicId;
  const seen = new Set<string>();
  const runs: TopicConversationRun[] = [];
  let lastRecommendations = '';
  for (const [index, revision] of (review.revisions ?? []).entries()) {
    const comments = (revision.comments ?? []).filter(comment => belongs(comment.topicId) && !seen.has(comment.id));
    comments.forEach(comment => seen.add(comment.id));
    const key = Object.keys(revision.recommendations ?? {}).find(belongs);
    const recommendations = key ? revision.recommendations?.[key] ?? [] : [];
    const signature = JSON.stringify(recommendations);
    if (!comments.length && !key && (!recommendations.length || signature === lastRecommendations)) continue;
    lastRecommendations = signature;
    runs.push({ id: `revision-${index}`, createdAt: revision.commentsCreatedAt ?? revision.createdAt, comments, recommendations, severities: [], latest: false });
  }
  const legacy = historicalComments(review).filter(comment => comment.topicId === topicId && !seen.has(comment.id)
    && !(review.comments ?? []).some(current => current.id === comment.id));
  if (legacy.length) {
    legacy.forEach(comment => seen.add(comment.id));
    runs.push({ id: 'earlier-comments', comments: legacy, recommendations: [], severities: [], latest: false });
  }
  const current = (review.comments ?? []).filter(comment => belongs(comment.topicId) && !seen.has(comment.id));
  const currentKey = Object.keys(review.recommendations ?? {}).find(belongs);
  const recommendations = currentKey ? review.recommendations?.[currentKey] ?? [] : [];
  if (current.length || currentKey) runs.push({
    id: 'current', createdAt: review.commentsCreatedAt, comments: current,
    recommendations, severities: currentKey ? review.recommendationSeverities?.[currentKey] ?? [] : [], latest: true,
  });
  return runs;
}

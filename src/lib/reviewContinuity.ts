import type { ReviewComment, Topic, TopicArtifact, TopicReview } from './aiReviewTypes';
import type { Review } from './reviewTypes';
import { matchTopics } from './topicMatching';

function storedComments(review: TopicReview): ReviewComment[] {
  return [...new Map([...(review.revisions ?? []).flatMap(revision => revision.comments ?? []),
    ...(review.previousComments ?? []), ...(review.comments ?? [])]
    .map(comment => [comment.id, comment])).values()];
}

export function topicFilePaths(topic: Topic, review: Review | null): string[] {
  return [...new Set(topic.unitIds.flatMap(id => {
    const file = /^f(\d+)/.exec(id);
    const path = file ? review?.files[Number(file[1])]?.path : undefined;
    return path ? [path] : [];
  }))].sort();
}

export function visibleTopics(review: TopicReview): { topics: Topic[]; outdatedSources: Record<string, string>; aliases: Record<string, string> } {
  const topics = [...review.artifact.topics];
  const outdatedSources = { ...review.outdatedTopics };
  const known = new Set(topics.map(topic => topic.id));
  const commentTopicIds = new Set(storedComments(review).map(comment => comment.topicId));
  for (const revision of [...(review.revisions ?? [])].reverse()) {
    for (const topic of revision.artifact.topics) {
      if (known.has(topic.id) || !commentTopicIds.has(topic.id)) continue;
      topics.push(topic);
      known.add(topic.id);
      outdatedSources[topic.id] = revision.sourceData ?? '';
    }
  }
  const aliases: Record<string, string> = {};
  const active = topics.filter(topic => !(topic.id in outdatedSources));
  const archived = topics.filter(topic => topic.id in outdatedSources);
  const parse = (data?: string): Review | null => {
    try { return data ? JSON.parse(data) as Review : null; } catch { return null; }
  };
  const pairs = matchTopics(archived, archived.map(topic => topicFilePaths(topic, parse(outdatedSources[topic.id]))),
    active, active.map(topic => topicFilePaths(topic, parse(review.sourceData))));
  for (const [activeIndex, archivedIndex] of pairs) aliases[archived[archivedIndex].id] = active[activeIndex].id;
  return { topics: topics.filter(topic => !(topic.id in aliases)), outdatedSources, aliases };
}

export function historicalComments(review: TopicReview): ReviewComment[] {
  const { aliases } = visibleTopics(review);
  return storedComments(review).map(comment => aliases[comment.topicId]
    ? { ...comment, topicId: aliases[comment.topicId] } : comment);
}

export function commentResolved(review: TopicReview, id: string): boolean {
  const manual = review.commentDecisions?.[id] ?? [...(review.revisions ?? [])].reverse()
    .find(revision => revision.commentDecisions?.[id])?.commentDecisions?.[id];
  return manual ? manual === 'resolved' : review.priorAssessments?.[id]?.outcome === 'resolved';
}

export function unresolvedHistoricalComments(review: TopicReview): ReviewComment[] {
  return historicalComments(review).filter(comment => !commentResolved(review, comment.id));
}

export function unresolvedTopicComments(review: TopicReview, topicId: string): { current: ReviewComment[]; historical: ReviewComment[] } {
  const open = (comment: ReviewComment) => comment.topicId === topicId && !commentResolved(review, comment.id);
  const currentIds = new Set((review.comments ?? []).map(comment => comment.id));
  return { current: (review.comments ?? []).filter(open), historical: unresolvedHistoricalComments(review).filter(comment => !currentIds.has(comment.id) && comment.topicId === topicId) };
}

export function activeTopicArtifact(review: TopicReview): TopicArtifact {
  return { ...review.artifact, topics: review.artifact.topics.filter(topic => !review.outdatedTopics || !(topic.id in review.outdatedTopics)) };
}

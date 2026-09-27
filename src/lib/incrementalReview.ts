import type { ReviewComment, Topic, TopicArtifact, TopicReview } from './aiReviewTypes';
import type { Review } from './reviewTypes';
import { historicalComments, topicFilePaths, visibleTopics } from './reviewContinuity';
import { matchTopics } from './topicMatching';

function parseReview(data?: string): Review | null {
  try { return data ? JSON.parse(data) as Review : null; } catch { return null; }
}

function content(topic: Topic, review: Review | null): string {
  return topic.unitIds.map(id => {
    const match = /^f(\d+)(?:h(\d+))?$/.exec(id);
    const file = match ? review?.files[Number(match[1])] : undefined;
    const hunk = match?.[2] === undefined ? null : file?.hunks[Number(match[2])];
    return JSON.stringify([file?.path, file?.status, hunk?.lines.map(line => [line.kind, line.text])]);
  }).sort().join('\n');
}

export function nextTopicReview(previous: TopicReview | undefined, artifact: TopicArtifact, currentData: string, full: boolean): TopicReview {
  const oldData = parseReview(previous?.sourceData);
  const newData = parseReview(currentData);
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const visible = previous ? visibleTopics(previous) : { topics: [], outdatedSources: {}, aliases: {} };
  const oldTopics = visible.topics;
  const oldSources = oldTopics.map(topic => parseReview(visible.outdatedSources[topic.id]) ?? oldData);
  const oldPaths = oldTopics.map((topic, index) => topicFilePaths(topic, oldSources[index]));
  const newPaths = artifact.topics.map(topic => topicFilePaths(topic, newData));
  const matches = previous && !full ? matchTopics(oldTopics, oldPaths, artifact.topics, newPaths) : new Map<number, number>();
  let nextId = Math.max(0, ...oldTopics.map(topic => Number(/^topic-(\d+)$/.exec(topic.id)?.[1] ?? 0))) + 1;
  const reviewed: TopicReview['reviewed'] = {};
  const outdatedTopics: Record<string, string> = {};
  const topics = artifact.topics.map((topic, index) => {
    if (!previous) return topic;
    if (full) return { ...topic, id: `topic-${nextId++}` };
    const oldIndex = matches.get(index);
    const chosen = oldIndex === undefined ? null : oldTopics[oldIndex];
    if (!chosen) return { ...topic, id: topic.id === 'uncategorized' ? topic.id : `topic-${nextId++}` };
    used.add(chosen.id);
    idMap.set(chosen.id, chosen.id);
    const oldSource = oldSources[oldIndex!];
    if (content(chosen, oldSource) === content(topic, newData) &&
      JSON.stringify(chosen.checks) === JSON.stringify(topic.checks) && previous.reviewed[chosen.id])
      reviewed[chosen.id] = previous.reviewed[chosen.id];
    return { ...topic, id: chosen.id };
  });
  if (previous) for (const old of oldTopics) {
    if (used.has(old.id)) continue;
    const archivedId = topics.some(topic => topic.id === old.id) ? `topic-${nextId++}` : old.id;
    if (archivedId !== old.id) idMap.set(old.id, archivedId);
    topics.push({ ...old, id: archivedId });
    const source = visible.outdatedSources[old.id] ?? previous.sourceData;
    outdatedTopics[archivedId] = source ?? '';
  }
  // The old anchors are historical evidence. Do not put them on the new diff.
  const previousComments: ReviewComment[] = (previous ? historicalComments(previous) : [])
    .map(comment => ({ ...comment, topicId: idMap.get(comment.topicId) ?? comment.topicId }));
  return {
    artifact: { ...artifact, topics }, outdatedTopics, reviewed, createdAt: Date.now(), sourceData: currentData,
    comments: [], previousComments, recommendations: {}, recommendationSeverities: {},
    commentDecisions: previous?.commentDecisions ?? {}, priorAssessments: previous?.priorAssessments ?? {},
    revisions: previous ? [...(previous.revisions ?? []), {
      artifact: previous.artifact, sourceData: previous.sourceData, reviewed: previous.reviewed,
      comments: previous.comments, recommendations: previous.recommendations,
      commentDecisions: previous.commentDecisions, createdAt: previous.createdAt,
      commentsCreatedAt: previous.commentsCreatedAt,
    }] : [],
  };
}

import type { ReviewComment, Topic, TopicArtifact, TopicReview } from './aiReviewTypes';
import type { Review } from './reviewTypes';

function parseReview(data?: string): Review | null {
  try { return data ? JSON.parse(data) as Review : null; } catch { return null; }
}

function paths(topic: Topic, review: Review | null): string[] {
  return [...new Set(topic.unitIds.flatMap(id => {
    const file = /^f(\d+)/.exec(id);
    const path = file ? review?.files[Number(file[1])]?.path : undefined;
    return path ? [path] : [];
  }))].sort();
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
  const oldTopics = previous?.artifact.topics ?? [];
  const oldPaths = oldTopics.map(topic => paths(topic, oldData));
  let nextId = Math.max(0, ...oldTopics.map(topic => Number(/^topic-(\d+)$/.exec(topic.id)?.[1] ?? 0))) + 1;
  const reviewed: TopicReview['reviewed'] = {};
  const topics = artifact.topics.map(topic => {
    if (full || !previous) return topic;
    const candidatePaths = paths(topic, newData);
    const candidateTitle = topic.title.trim().toLocaleLowerCase();
    const matches = oldTopics.map((old, index) => ({ old, index })).filter(({ old, index }) =>
      !used.has(old.id) && old.id !== 'uncategorized' &&
      candidatePaths.length > 0 && candidatePaths.join('\0') === oldPaths[index].join('\0'));
    const chosen = matches.length === 1 ? matches[0].old
      : matches.find(({ old }) => old.title.trim().toLocaleLowerCase() === candidateTitle)?.old;
    if (!chosen) return { ...topic, id: topic.id === 'uncategorized' ? topic.id : `topic-${nextId++}` };
    used.add(chosen.id);
    idMap.set(chosen.id, chosen.id);
    if (content(chosen, oldData) === content(topic, newData) &&
      JSON.stringify(chosen.checks) === JSON.stringify(topic.checks) && previous.reviewed[chosen.id])
      reviewed[chosen.id] = previous.reviewed[chosen.id];
    return { ...topic, id: chosen.id };
  });
  // The old anchors are historical evidence. Do not put them on the new diff.
  const previousComments: ReviewComment[] = full ? [] : [...new Map([...(previous?.previousComments ?? []), ...(previous?.comments ?? [])]
    .filter(comment => previous?.commentDecisions?.[comment.id] !== 'resolved').map(comment => [comment.id, comment])).values()]
    .map(comment => ({ ...comment, topicId: idMap.get(comment.topicId) ?? comment.topicId }));
  return {
    artifact: { ...artifact, topics }, reviewed, createdAt: Date.now(), sourceData: currentData,
    comments: [], previousComments, recommendations: {}, recommendationSeverities: {},
    commentDecisions: full ? {} : previous?.commentDecisions ?? {},
    revisions: previous ? [...(previous.revisions ?? []), {
      artifact: previous.artifact, sourceData: previous.sourceData, reviewed: previous.reviewed,
      comments: previous.comments, recommendations: previous.recommendations,
      commentDecisions: previous.commentDecisions, createdAt: previous.createdAt,
    }] : [],
  };
}

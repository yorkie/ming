import type { ReviewComment, TopicReview } from './aiReviewTypes';
import type { Review } from './reviewTypes';

export type EarlierConversation = { comment: ReviewComment; path: string; lineText: string; createdAt?: number };
export type PlacedComments = { inline: ReviewComment[]; outdated: EarlierConversation[] };

function parseSource(source?: string): Review | null {
  if (!source) return null;
  try { const value = JSON.parse(source) as Review; return Array.isArray(value.files) ? value : null; }
  catch { return null; }
}

function originalSource(review: TopicReview, comment: ReviewComment): { data: Review | null; createdAt?: number; trusted: boolean } {
  for (const revision of review.revisions ?? []) {
    if (!revision.comments?.some(item => item.id === comment.id)) continue;
    const data = parseSource(revision.sourceData);
    if (data) return { data, createdAt: revision.commentsCreatedAt ?? revision.createdAt, trusted: true };
    break;
  }
  const archived = parseSource(review.outdatedTopics?.[comment.topicId]);
  if (archived) return { data: archived, trusted: true };
  return { data: parseSource(review.sourceData), trusted: false };
}

export function placeEarlierComments(review: TopicReview, comments: ReviewComment[], current: Review, forceOutdated = false): PlacedComments {
  const inline: ReviewComment[] = [];
  const outdated: EarlierConversation[] = [];
  for (const comment of comments) {
    const source = originalSource(review, comment);
    const originalFile = source.data?.files[comment.fileIndex];
    const originalLine = originalFile?.hunks[comment.hunkIndex]?.lines.find(line => comment.side === 'LEFT'
      ? line.kind === 'delete' && line.oldNumber === comment.lineNumber
      : line.kind !== 'delete' && line.newNumber === comment.lineNumber);
    const path = source.trusted ? originalFile?.path ?? '' : '';
    const lineText = source.trusted ? originalLine?.text ?? '' : '';
    const matches: ReviewComment[] = [];
    if (!forceOutdated && source.trusted && path && originalLine && lineText.trim()) {
      current.files.forEach((file, fileIndex) => {
        if (file.path !== path) return;
        file.hunks.forEach((hunk, hunkIndex) => hunk.lines.forEach(line => {
          if (line.text !== lineText || (comment.side === 'LEFT' ? line.kind !== 'delete' : line.kind === 'delete')) return;
          const lineNumber = comment.side === 'LEFT' ? line.oldNumber : line.newNumber;
          if (lineNumber !== null) matches.push({ ...comment, fileIndex, hunkIndex, lineNumber });
        }));
      });
    }
    if (matches.length === 1) inline.push(matches[0]!);
    else outdated.push({ comment, path, lineText, createdAt: source.createdAt });
  }
  return { inline, outdated };
}

import type { ReviewComment } from './aiReviewTypes';
import type { Review } from './reviewTypes';

export function reviewCommentsText(comments: ReviewComment[], review: Review, chinese: boolean): string {
  return comments.map(comment => {
    const path = review.files[comment.fileIndex]?.path ?? `file #${comment.fileIndex + 1}`;
    const location = `${path}:${comment.lineNumber} (${comment.side === 'LEFT' ? 'old' : 'new'} line)`;
    return `- ${comment.severity ? `[${comment.severity}] ` : ''}${location}: ${comment.body}${comment.suggestion ? `\n  ${chinese ? '建议代码' : 'Suggested code'}: ${comment.suggestion}` : ''}`;
  }).join('\n');
}

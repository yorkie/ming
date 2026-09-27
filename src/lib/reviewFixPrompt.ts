import type { ReviewComment, Topic } from './aiReviewTypes';
import type { Review } from './reviewTypes';

export function reviewFixPrompt(topic: Topic, conclusions: string[], comments: ReviewComment[], review: Review, chinese: boolean,
  historicalComments: ReviewComment[] = []): string {
  const findings = comments.map(comment => {
    const path = review.files[comment.fileIndex]?.path ?? `file #${comment.fileIndex + 1}`;
    const location = `${path}:${comment.lineNumber} (${comment.side === 'LEFT' ? 'old' : 'new'} line)`;
    return `- ${comment.severity ? `[${comment.severity}] ` : ''}${location}: ${comment.body}${comment.suggestion ? `\n  ${chinese ? '建议代码' : 'Suggested code'}: ${comment.suggestion}` : ''}`;
  });
  const historicalFindings = historicalComments.map(comment => `- ${comment.severity ? `[${comment.severity}] ` : ''}${comment.body}`);
  return chinese
    ? [`请检查并修复以下代码评审发现。先核对每条意见与当前代码是否一致，只修改确认的问题，并运行相关测试。不要直接照搬建议代码。`,
      `主题：${topic.title}`, conclusions.length ? `评审结论：\n${conclusions.join('\n')}` : '',
      findings.length ? `行级评论：\n${findings.join('\n')}` : '',
      historicalFindings.length ? `尚未解决的历史评论（位置可能已变化）：\n${historicalFindings.join('\n')}` : ''].filter(Boolean).join('\n\n')
    : [`Review and fix the findings below. Verify each finding against the current code, change only confirmed issues, and run relevant tests. Do not apply suggested code blindly.`,
      `Topic: ${topic.title}`, conclusions.length ? `Review conclusion:\n${conclusions.join('\n')}` : '',
      findings.length ? `Inline comments:\n${findings.join('\n')}` : '',
      historicalFindings.length ? `Unresolved historical comments (locations may have changed):\n${historicalFindings.join('\n')}` : ''].filter(Boolean).join('\n\n');
}

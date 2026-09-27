import type { ReviewComment, Topic } from './aiReviewTypes';
import type { Review } from './reviewTypes';

export function reviewFixPrompt(topic: Topic, conclusions: string[], comments: ReviewComment[], review: Review, chinese: boolean): string {
  const findings = comments.map(comment => {
    const path = review.files[comment.fileIndex]?.path ?? `file #${comment.fileIndex + 1}`;
    const location = `${path}:${comment.lineNumber} (${comment.side === 'LEFT' ? 'old' : 'new'} line)`;
    return `- ${comment.severity ? `[${comment.severity}] ` : ''}${location}: ${comment.body}${comment.suggestion ? `\n  ${chinese ? '建议代码' : 'Suggested code'}: ${comment.suggestion}` : ''}`;
  });
  return chinese
    ? [`请检查并修复以下代码评审发现。先核对每条意见与当前代码是否一致，只修改确认的问题，并运行相关测试。不要直接照搬建议代码。`,
      `主题：${topic.title}`, `评审结论：\n${conclusions.join('\n')}`,
      findings.length ? `行级评论：\n${findings.join('\n')}` : '本主题没有行级评论。'].join('\n\n')
    : [`Review and fix the findings below. Verify each finding against the current code, change only confirmed issues, and run relevant tests. Do not apply suggested code blindly.`,
      `Topic: ${topic.title}`, `Review conclusion:\n${conclusions.join('\n')}`,
      findings.length ? `Inline comments:\n${findings.join('\n')}` : 'This topic has no inline comments.'].join('\n\n');
}

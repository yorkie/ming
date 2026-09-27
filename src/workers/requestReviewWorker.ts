import init, { advance_task, start_task_with_languages } from '../wasm/ming_core.js';
import { readDeepSeekStream } from '../lib/deepSeekStream';
import { chatCompletionRequestError } from '../lib/deepSeekError';
import { chatCompletionBody, type CopilotConnection } from '../lib/copilotProvider';
import { cachedPromptTokens } from '../lib/chatUsage';
import type { AiRequestUsage, ReviewComment, ReviewCommentArtifact, ReviewSeverity, TopicArtifact } from '../lib/aiReviewTypes';
import type { Review } from '../lib/reviewTypes';
import type { AiActivityKind } from '../lib/aiActivity';
import { addReviewPromptContext, splitReviewPrompt } from '../lib/reviewPromptChunks';
import { parseReviewComments, type PriorAssessment } from '../lib/reviewResponse';
import { assessPreviousFindings, filterNewReviewComments, priorFindingsPrompt, repeatedPriorFindingIds } from '../lib/reviewCarryover';
import { runConcurrentReviews } from '../lib/concurrentReview';

type Request = { review: Review; artifact: TopicArtifact; previousComments?: ReviewComment[]; connection: CopilotConnection; reviewLanguage: 'en' | 'zh-CN'; concurrency?: number };
type Progress = { completed: number; total: number };
type Command = { model: string; prompt: string; maxOutputTokens: number; timeoutMs: number; maxAttempts: number };
type Transition = { state: string | null; command: Command | null; artifact: ReviewCommentArtifact | null; progress: Progress };
class TruncatedReviewError extends Error {}
class MalformedReviewError extends Error {}
const tokenCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
let activityId = 0;
let completedTopics = 0;
function activity(kind: AiActivityKind, title: string, detail?: string) { self.postMessage({ type: 'activity', event: { id: ++activityId, at: Date.now(), kind, title, detail } }); }
function progress(value: Progress, message: string) { self.postMessage({ type: 'progress', completed: completedTopics, total: value.total, message }); }
async function ask(command: Command, connection: CopilotConnection, group: number, total: number, topic: string, checks: string[], zh: boolean): Promise<string> {
  const providerName = connection.provider === 'openai' ? 'OpenAI' : 'DeepSeek';
  let retryReason: 'length' | 'json' | null = null;
  for (let attempt = 1; attempt <= command.maxAttempts; attempt++) {
    const label = zh ? `第 ${group}/${total} 个主题 · ${topic}` : `Topic ${group}/${total} · ${topic}`;
    activity(attempt === 1 ? 'request' : 'retry', zh ? `正在按检查清单评审「${topic}」` : `Reviewing ${topic} against its checklist`,
      `${zh ? `第 ${group}/${total} 个主题` : `Topic ${group}/${total}`} · ${checks.length} ${zh ? '项检查' : 'checks'}${checks.length ? ` · ${checks.join(' · ').slice(0, 400)}` : ''}`);
    progress({ completed: group - 1, total }, zh ? `正在评审「${topic}」…` : `Reviewing ${topic}…`);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resetTimeout = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => controller.abort(), command.timeoutMs); };
    resetTimeout();
    let httpStatus: number | null = null;
    let reported = false;
    let received = 0;
    let lastReported = 0;
    const report = (status: AiRequestUsage['status'], usage?: Record<string, unknown>, model = command.model) => {
      self.postMessage({ type: 'usage', usage: { model, group, attempt, status, httpStatus,
        promptTokens: tokenCount(usage?.prompt_tokens), completionTokens: tokenCount(usage?.completion_tokens),
        totalTokens: tokenCount(usage?.total_tokens), cachedPromptTokens: cachedPromptTokens(usage) } satisfies AiRequestUsage });
      reported = true;
    };
    try {
      const response = await fetch(connection.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chatCompletionBody(connection.provider, { model: command.model, stream: true, stream_options: { include_usage: true },
          response_format: { type: 'json_object' }, max_tokens: attempt > 2 ? Math.max(command.maxOutputTokens, 16_000) : attempt > 1 ? Math.max(command.maxOutputTokens, 8_000) : command.maxOutputTokens,
          messages: [{ role: 'system', content: 'You are a careful code reviewer. Return one valid JSON object only. Its comments property must be an array. Keep each finding concise.' },
            { role: 'user', content: attempt > 1 ? `${command.prompt}\n\n${retryReason === 'json'
              ? 'Your previous response was invalid JSON. Return only a complete JSON object with a comments array. Escape quotes and newlines inside strings. Omit optional suggestions if needed.'
              : attempt > 2 ? 'The response was cut off again. Return at most 2 confirmed findings. Each body must be one short sentence. Omit all suggestions and keep the recommendation to one sentence.' : 'Your previous response was cut off. Return at most 8 highest priority findings, with short bodies and no optional suggestion unless necessary.'} Keep the entire JSON response compact.` : command.prompt }] })),
      });
      httpStatus = response.status;
      if ((response.status === 429 || response.status >= 500) && attempt < command.maxAttempts) { report('error'); activity('retry', zh ? '服务暂时不可用，正在重试。' : 'The service is temporarily unavailable; retrying.', `HTTP ${response.status}`); await new Promise(resolve => setTimeout(resolve, 500 * attempt)); continue; }
      if (!response.ok) throw await chatCompletionRequestError(response, 'review', connection.provider === 'openai' ? 'OpenAI' : 'DeepSeek');
      if (!response.body) throw new Error(`${providerName} returned no response stream.`);
      const result = await readDeepSeekStream(response.body, characters => { received = characters; resetTimeout();
        if (Date.now() - lastReported > 500) { progress({ completed: group - 1, total }, zh ? `正在评审「${topic}」，已接收 ${received.toLocaleString()} 字…` : `Reviewing ${topic}; ${received.toLocaleString()} response characters received…`); lastReported = Date.now(); }
      });
      if (result.finishReason === 'length' && attempt < command.maxAttempts) { report('error', result.usage, result.model);
        retryReason = 'length';
        activity('retry', zh ? `「${topic}」的回复被长度上限截断，正在缩短结果后重试。` : `The response for ${topic} was cut off; retrying with a shorter result.`, label); continue; }
      if (result.finishReason !== 'stop' || !result.content) throw result.finishReason === 'length'
        ? new TruncatedReviewError(`${providerName} truncated the review of ${topic} after ${command.maxAttempts} attempts.`)
        : new Error(`${providerName} did not finish the review response (${result.finishReason ?? 'missing'}).`);
      try { parseReviewComments(result.content); }
      catch (cause) {
        report('error', result.usage, result.model);
        if (attempt < command.maxAttempts) { retryReason = 'json';
          activity('retry', zh ? `「${topic}」的回复不是有效 JSON，正在重新请求这一段。` : `The response for ${topic} was invalid JSON; retrying this section.`, cause instanceof Error ? cause.message : String(cause));
          continue;
        }
        throw new MalformedReviewError(`${providerName} returned invalid review JSON for ${topic}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      report('success', result.usage, result.model);
      activity('validation', zh ? `收到「${topic}」的评审结果，正在核对评论对应的差异行。` : `Received the review of ${topic}; checking comment anchors.`, zh ? `${received.toLocaleString()} 字` : `${received.toLocaleString()} characters`);
      return result.content;
    } catch (cause) {
      if (!reported) report('error');
      if (attempt === command.maxAttempts) throw cause;
      activity('retry', zh ? `评审「${topic}」时遇到错误，正在重试。` : `Reviewing ${topic} failed; retrying.`, cause instanceof Error ? cause.message : String(cause));
    } finally { if (timer) clearTimeout(timer); }
  }
  throw new Error(`${providerName} did not finish the review.`);
}
async function reviewInChunks(command: Command, connection: CopilotConnection, group: number, total: number, topic: string, checks: string[], zh: boolean, depth = 0): Promise<{ comments: unknown[]; recommendations: string[]; recommendationSeverities: (ReviewSeverity | null)[]; priorFindings: PriorAssessment[]; sections: number }> {
  const largeInput = depth === 0 && command.prompt.length > 24_000;
  try {
    if (largeInput) throw new TruncatedReviewError('The topic diff is large.');
    const response = await ask(command, connection, group, total, topic, checks, zh);
    const parsed = parseReviewComments(response);
    return { comments: parsed.comments, priorFindings: parsed.priorFindings ?? [], sections: 1, recommendations: parsed.recommendation ? [parsed.recommendation] : [],
      recommendationSeverities: parsed.recommendation ? [parsed.recommendationSeverity ?? null] : [] };
  } catch (cause) {
    if (!(cause instanceof TruncatedReviewError || cause instanceof MalformedReviewError)) throw cause;
    if (depth >= 6) throw new Error(`The AI provider could not return valid review JSON for the smallest section of ${topic}; no comments were saved for this task.`);
    const chunks = splitReviewPrompt(command.prompt, depth === 0 ? 12_000 : Math.max(1_500, Math.floor(command.prompt.length / 2)), true);
    if (chunks.length < 2) throw new Error(`The AI provider could not review the smallest diff section for ${topic}: ${cause.message}`);
    activity('retry', largeInput
      ? zh ? `「${topic}」的差异较大，分 ${chunks.length} 段评审。` : `The diff for ${topic} is large; reviewing ${chunks.length} smaller sections.`
      : cause instanceof MalformedReviewError
        ? zh ? `「${topic}」的回复格式仍有误，改为分 ${chunks.length} 段评审。` : `The response for ${topic} is still invalid JSON; reviewing ${chunks.length} smaller sections.`
        : zh ? `「${topic}」的回复仍被截断，改为分 ${chunks.length} 段评审。` : `The response for ${topic} is still truncated; reviewing ${chunks.length} smaller sections.`);
    const comments: unknown[] = [];
    const recommendations: string[] = [];
    const recommendationSeverities: (ReviewSeverity | null)[] = [];
    const priorFindings: PriorAssessment[] = [];
    let sections = 0;
    for (const [index, prompt] of chunks.entries()) {
      activity('request', zh ? `评审「${topic}」的第 ${index + 1}/${chunks.length} 段差异。` : `Reviewing section ${index + 1}/${chunks.length} of ${topic}.`);
      progress({ completed: group - 1, total }, zh ? `正在评审「${topic}」的第 ${index + 1}/${chunks.length} 段…` : `Reviewing section ${index + 1}/${chunks.length} of ${topic}…`);
      const result = await reviewInChunks({ ...command, prompt }, connection, group, total, topic, checks, zh, depth + 1);
      comments.push(...result.comments);
      recommendations.push(...result.recommendations);
      recommendationSeverities.push(...result.recommendationSeverities);
      priorFindings.push(...result.priorFindings);
      sections += result.sections;
      activity('validation', zh ? `第 ${index + 1}/${chunks.length} 段已完成，提出 ${result.comments.length} 条候选意见。` : `Section ${index + 1}/${chunks.length} complete with ${result.comments.length} proposed findings.`);
    }
    return { comments, recommendations, recommendationSeverities, priorFindings, sections };
  }
}
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    await init();
    activityId = 0;
    completedTopics = 0;
    const { review, artifact, connection, reviewLanguage } = event.data;
    const previousComments = event.data.previousComments ?? [];
    const concurrency = Number.isInteger(event.data.concurrency) && (event.data.concurrency ?? 0) >= 1 && (event.data.concurrency ?? 0) <= 8 ? event.data.concurrency! : 4;
    const zh = reviewLanguage === 'zh-CN';
    activity('phase', zh ? `开始按检查清单逐项评审 ${artifact.topics.length} 个主题。` : `Starting checklist review of ${artifact.topics.length} topics.`);
    const total = artifact.topics.length;
    let completed = 0;
    let commentCount = 0;
    progress({ completed, total }, zh ? `正在并行评审 ${Math.min(concurrency, total)} 个主题…` : `Reviewing ${Math.min(concurrency, total)} topics in parallel…`);
    await runConcurrentReviews(artifact.topics, concurrency, async (topic, index) => {
          const transition = JSON.parse(start_task_with_languages('request-review', JSON.stringify({ review, artifact: { ...artifact, topics: [topic] } }), connection.model, reviewLanguage, reviewLanguage)) as Transition;
          if (!transition.command || !transition.state) throw new Error(`Could not start review of ${topic.title}.`);
          const previous = previousComments.filter(comment => comment.topicId === topic.id);
          if (previous.length) transition.command.prompt = addReviewPromptContext(transition.command.prompt,
            priorFindingsPrompt(previous));
          const response = await reviewInChunks(transition.command, connection, index + 1, total, topic.title, topic.checks, zh);
          const newComments = filterNewReviewComments(response.comments, previous);
          activity('finding', zh ? `「${topic.title}」提出 ${newComments.length} 条新候选意见，核对 ${previous.length} 条未解决的旧意见。` : `${newComments.length} new proposed findings for ${topic.title}; checked ${previous.length} unresolved earlier findings.`);
          const result = JSON.parse(advance_task(transition.state, JSON.stringify({ comments: newComments.slice(0, 20) }))) as Transition;
          if (!result.artifact) throw new Error(`Could not validate review of ${topic.title}.`);
          completed++;
          completedTopics = completed;
          commentCount += result.artifact.comments.length;
          const recommendations = response.recommendations.length ? response.recommendations
            : [result.artifact.comments.length
              ? zh ? `请先核查本主题的 ${result.artifact.comments.length} 条行级评论，再决定是否标记为已评审。` : `Check the ${result.artifact.comments.length} inline comments before marking this topic reviewed.`
              : zh ? '本次未发现可定位到差异行的问题；仍请人工核对检查清单。' : 'No issue anchored to a diff line was found; verify the checklist manually.'];
          const recommendationSeverities = response.recommendations.length ? response.recommendationSeverities : [null];
          const assessments = assessPreviousFindings(previous, response.priorFindings, response.sections,
            repeatedPriorFindingIds(response.comments, previous));
          self.postMessage({ type: 'topic-complete', topicId: topic.id, artifact: result.artifact, recommendations, recommendationSeverities, assessments });
          activity('done', zh ? `已完成「${topic.title}」的评审，确认 ${result.artifact.comments.length} 条评论。` : `Finished ${topic.title} with ${result.artifact.comments.length} validated comments.`);
          progress({ completed, total }, zh ? `已完成 ${completed}/${total} 个主题。` : `Reviewed ${completed}/${total} topics.`);
    });
    activity('done', zh ? `评审完成，共生成 ${commentCount} 条评论。` : `Review complete with ${commentCount} comments.`);
    self.postMessage({ type: 'done', commentCount });
  } catch (cause) { const message = cause instanceof Error ? cause.message : String(cause);
    activity('error', event.data.reviewLanguage === 'zh-CN' ? '代码评审失败' : 'Review failed', message);
    self.postMessage({ type: 'error', message }); }
};

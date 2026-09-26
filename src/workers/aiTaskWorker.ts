import init, { advance_task, split_current_topic_batch, start_task_with_languages } from '../wasm/ming_core.js';
import type { AiRequestUsage, ReviewTitleArtifact, TopicArtifact } from '../lib/aiReviewTypes';
import { readDeepSeekStream, readDeepSeekToolStream } from '../lib/deepSeekStream';
import { deepSeekRequestError } from '../lib/deepSeekError';
import { describeBatchTopics, describeGlobalPlan, describeToolCall, describeToolResult, findingFromCall, type AiActivityKind } from '../lib/aiActivity';

type Request = { taskKind?: 'topic-review' | 'review-title'; reviewJson: string; model: string; apiKey: string; summaryLanguage: 'en' | 'zh-CN'; reviewLanguage: 'en' | 'zh-CN'; uiLanguage?: 'en' | 'zh-CN' };
type Progress = { completed: number; total: number; currentFiles: number; currentUnits: number };
type Transition = { state: string | null; command: { provider: 'deepseek'; model: string; prompt: string; maxOutputTokens: number; timeoutMs: number; maxAttempts: number; messages?: unknown[]; tools?: unknown[] } | null; artifact: TopicArtifact | ReviewTitleArtifact | null; progress: Progress };

function update(message: string, progress: Progress) { self.postMessage({ type: 'progress', message, completed: progress.completed, total: progress.total }); }
let activityId = 0;
function activity(kind: AiActivityKind, title: string, detail?: string) {
  self.postMessage({ type: 'activity', event: { id: ++activityId, at: Date.now(), kind, title, detail } });
}

function tokenCount(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }

async function generate(command: NonNullable<Transition['command']>, apiKey: string, group: number, progress: Progress, zh: boolean, taskKind: 'topic-review' | 'review-title'): Promise<string | null> {
  for (let attempt = 1; attempt <= command.maxAttempts; attempt++) {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const resetTimeout = () => { if (timeout) clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), command.timeoutMs); };
    resetTimeout();
    const label = taskKind === 'review-title' ? (zh ? '生成评审标题' : 'Generating review title') : zh ? `第 ${group}/${progress.total} 组 · ${progress.currentFiles} 个文件 · ${progress.currentUnits} 处改动` : `Group ${group} of ${progress.total} · ${progress.currentFiles} ${progress.currentFiles === 1 ? 'file' : 'files'} · ${progress.currentUnits} changes`;
    if (taskKind === 'topic-review') activity(attempt === 1 ? 'request' : 'retry', zh ? `我正在阅读第 ${group}/${progress.total} 组改动，寻找共同的修改意图。` : `I'm reviewing group ${group} of ${progress.total} to find related changes.`, label);
    update(taskKind === 'review-title' ? (zh ? '我正在为这次评审拟一个标题…' : "I'm drafting a title for this review…") : zh ? `我正在阅读第 ${group}/${progress.total} 组改动，寻找共同的修改意图…` : `I'm reviewing group ${group} of ${progress.total} to find related changes…`, progress);
    let received = 0;
    let lastReported = 0;
    const waiting = () => received
      ? zh ? `我正在整理第 ${group}/${progress.total} 组的主题，已接收 ${received.toLocaleString()} 字…` : `I'm organizing group ${group} of ${progress.total}; ${received.toLocaleString()} response characters received…`
      : zh ? `我正在等待第 ${group}/${progress.total} 组的分析结果…` : `I'm waiting for the analysis of group ${group} of ${progress.total}…`;
    const ticker = setInterval(() => update(waiting(), progress), 1_000);
    let reported = false;
    const report = (status: AiRequestUsage['status'], httpStatus: number | null, usage?: Record<string, unknown>, model = command.model) => {
      const entry: AiRequestUsage = { model, group, attempt, status, httpStatus,
        promptTokens: tokenCount(usage?.prompt_tokens), completionTokens: tokenCount(usage?.completion_tokens),
        totalTokens: tokenCount(usage?.total_tokens), cachedPromptTokens: tokenCount(usage?.prompt_cache_hit_tokens) };
      self.postMessage({ type: 'usage', usage: entry });
      reported = true;
    };
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: command.model, stream: true, stream_options: { include_usage: true }, response_format: { type: 'json_object' },
          max_tokens: command.maxOutputTokens,
          messages: [{ role: 'system', content: 'You assist a human code reviewer. Return valid JSON only.' },
            { role: 'user', content: command.prompt }] }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < command.maxAttempts) {
        report('error', response.status);
        activity('retry', zh ? '服务暂时没有完成这一组，我会再试一次。' : "The service didn't finish this group; I'll try again.", `HTTP ${response.status}`);
        update(zh ? '服务暂时没有完成这一组，我会再试一次…' : "The service didn't finish this group; I'll try again…", progress);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
      if (!response.ok) { report('error', response.status); throw await deepSeekRequestError(response, 'topic'); }
      if (!response.body) throw new Error('DeepSeek returned no response stream.');
      const result = await readDeepSeekStream(response.body, characters => {
        received = characters;
        resetTimeout();
        if (Date.now() - lastReported >= 500) { update(waiting(), progress); lastReported = Date.now(); }
      });
      if (result.finishReason === 'length' && taskKind === 'topic-review') {
        report('error', response.status, result.usage, result.model);
        activity('retry', zh ? '这一组内容太多，我会拆小后继续整理。' : "This group is too large, so I'll split it and continue.", label);
        update(zh ? '这一组内容太多，我正在拆小后继续整理…' : "This group is too large; I'm splitting it before continuing…", progress);
        return null;
      }
      if (result.finishReason !== 'stop' || !result.content) {
        report('error', response.status, result.usage, result.model);
        throw new Error(`DeepSeek did not complete the ${taskKind === 'review-title' ? 'title' : 'topic'} response (finish reason: ${result.finishReason ?? 'missing'}).`);
      }
      report('success', response.status, result.usage, result.model);
      if (taskKind === 'topic-review') activity('validation', zh ? '我拿到了这一组的建议，正在核对有没有遗漏改动。' : "I have this group's proposed topics; I'm checking for missing changes.");
      update(zh ? '我正在核对这一组的主题和改动归属…' : "I'm checking this group's topics and change assignments…", progress);
      return result.content;
    } catch (error) {
      if (!reported) report('error', null);
      throw error;
    } finally { if (timeout) clearTimeout(timeout); clearInterval(ticker); }
  }
  throw new Error('DeepSeek did not return a topic response.');
}

async function generateGlobal(command: NonNullable<Transition['command']>, apiKey: string, group: number, progress: Progress, zh: boolean): Promise<string> {
  for (let attempt = 1; attempt <= command.maxAttempts; attempt++) {
    activity(attempt === 1 ? 'request' : 'retry', zh ? '我在继续核对主题之间的关系。' : "I'm continuing to check how these topics relate.", zh ? `第 ${group} 轮 · ${command.model}` : `Turn ${group} · ${command.model}`);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const resetTimeout = () => { if (timeout) clearTimeout(timeout); timeout = setTimeout(() => controller.abort(), command.timeoutMs); };
    resetTimeout();
    let received = 0;
    let lastReported = 0;
    const waiting = () => received
      ? zh ? `我正在核对跨组主题，已接收 ${received.toLocaleString()} 字的分析结果…` : `I'm checking topics across groups; ${received.toLocaleString()} response characters received…`
      : zh ? '我正在比对相似主题，并检查实现与测试是否放在一起…' : "I'm comparing related topics and checking whether implementation and tests belong together…";
    const ticker = setInterval(() => update(waiting(), progress), 1_000);
    update(waiting(), progress);
    let httpStatus: number | null = null;
    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: command.model, stream: true, stream_options: { include_usage: true }, max_tokens: command.maxOutputTokens,
          messages: command.messages, tools: command.tools, tool_choice: 'auto' }),
      });
      httpStatus = response.status;
      if ((response.status === 429 || response.status >= 500) && attempt < command.maxAttempts) {
        activity('retry', zh ? '服务暂时没有回应，我会继续尝试。' : "The service hasn't responded yet; I'll try again.", `HTTP ${response.status}`);
        self.postMessage({ type: 'usage', usage: { model: command.model, group, attempt, status: 'error', httpStatus: response.status,
          promptTokens: null, completionTokens: null, totalTokens: null, cachedPromptTokens: null } satisfies AiRequestUsage });
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
      if (!response.ok) throw await deepSeekRequestError(response, 'global topic');
      if (!response.body) throw new Error('DeepSeek returned no global topic stream.');
      const result = await readDeepSeekToolStream(response.body, characters => {
        received = characters;
        resetTimeout();
        if (Date.now() - lastReported >= 500) { update(waiting(), progress); lastReported = Date.now(); }
      });
      if (!['stop', 'tool_calls', 'length'].includes(result.finishReason ?? '')) throw new Error(`DeepSeek did not finish global topic review (reason: ${result.finishReason ?? 'missing'}).`);
      self.postMessage({ type: 'usage', usage: { model: result.model ?? command.model, group, attempt, status: 'success', httpStatus: response.status,
        promptTokens: tokenCount(result.usage?.prompt_tokens), completionTokens: tokenCount(result.usage?.completion_tokens),
        totalTokens: tokenCount(result.usage?.total_tokens), cachedPromptTokens: tokenCount(result.usage?.prompt_cache_hit_tokens) } satisfies AiRequestUsage });
      const message = { content: result.content || null, tool_calls: result.toolCalls.length ? result.toolCalls : undefined,
        reasoning_content: result.reasoningContent || undefined };
      return result.finishReason === 'length' ? JSON.stringify({ ...message, tool_calls: undefined, truncated: true }) : JSON.stringify(message);
    } catch (cause) {
      self.postMessage({ type: 'usage', usage: { model: command.model, group, attempt, status: 'error', httpStatus,
        promptTokens: null, completionTokens: null, totalTokens: null, cachedPromptTokens: null } satisfies AiRequestUsage });
      throw cause;
    } finally { if (timeout) clearTimeout(timeout); clearInterval(ticker); }
  }
  throw new Error('DeepSeek did not complete global topic review.');
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const zh = event.data.uiLanguage === 'zh-CN';
  const taskKind = event.data.taskKind ?? 'topic-review';
  try {
    activityId = 0;
    if (taskKind === 'topic-review') activity('phase', zh ? '我先整理这次扫描到的改动。' : "I'll start by organizing the changes in this scan.");
    update(zh ? '正在加载 AI 评审框架…' : 'Loading the AI review harness…', { completed: 0, total: 0, currentFiles: 0, currentUnits: 0 });
    await init();
    update(zh ? '正在规划改动分组…' : 'Planning change groups…', { completed: 0, total: 0, currentFiles: 0, currentUnits: 0 });
    let transition = JSON.parse(start_task_with_languages(taskKind, event.data.reviewJson, event.data.model, event.data.summaryLanguage, event.data.reviewLanguage)) as Transition;
    let step = 0;
    let globalTurn = 0;
    if (taskKind === 'topic-review') activity('phase', zh ? `这些改动分成了 ${transition.progress.total} 组，我会先逐组找出修改意图。` : `I've split the changes into ${transition.progress.total} groups and will review each group's purpose.`);
    while (transition.command && transition.state) {
      if (transition.command.messages) {
        if (globalTurn === 0) activity('phase', zh ? '我会再横向检查这些主题，确认相似改动及对应测试没有被拆开。' : "I'll compare topics across groups so related changes and tests stay together.");
        const response = await generateGlobal(transition.command, event.data.apiKey, ++globalTurn, transition.progress, zh);
        const reply = JSON.parse(response) as { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]; truncated?: boolean };
        transition = JSON.parse(advance_task(transition.state, response)) as Transition;
        if (reply.truncated) activity('retry', zh ? '整理结果太长了，我会要求只保留必要的调整。' : "The proposed plan is too long; I'll ask for only the necessary changes.");
        else if (reply.tool_calls?.length) {
          const messages = transition.command?.messages as { role?: string; tool_call_id?: string; content?: string }[] | undefined;
          for (const call of reply.tool_calls) {
            activity('tool', describeToolCall(call, zh), describeToolResult(call, messages, zh));
            const finding = findingFromCall(call);
            if (finding && messages?.some(message => message.role === 'tool' && message.tool_call_id === call.id && message.content?.includes('"saved":true'))) activity('finding', zh ? '我记录了一条跨批次的关联，后面整理主题时会用到。' : "I've noted a connection between batches for the final pass.", finding);
          }
        } else if (transition.command) {
          const messages = transition.command.messages as { role?: string; content?: string }[] | undefined;
          const feedback = messages?.at(-1)?.content;
          activity('retry', zh ? '这个整理方案还没通过检查，我会根据具体问题再修正。' : "This plan didn't pass validation; I'll correct the specific issue.", feedback?.replace(/^Your edit plan was rejected: /, '').replace(/\. Return a corrected JSON edit plan.*$/, ''));
        } else {
          const count = (transition.artifact as TopicArtifact | null)?.topics.length ?? 0;
          activity('validation', zh ? '重叠的主题已经整理好，所有改动也都保留了归属。' : "I've reconciled overlapping topics and kept every change assigned.", [describeGlobalPlan(reply.content ?? '', zh), zh ? `最终 ${count} 个主题` : `${count} final topics`].filter(Boolean).join(' · '));
        }
        continue;
      }
      const content = await generate(transition.command, event.data.apiKey, step + 1, transition.progress, zh, taskKind);
      if (content === null) {
        transition = JSON.parse(split_current_topic_batch(transition.state)) as Transition;
        activity('phase', zh ? '我把过大的改动组拆开，接着逐组处理。' : "I've split the oversized group and will continue in smaller parts.", zh ? `现在共 ${transition.progress.total} 组` : `${transition.progress.total} groups now`);
        continue;
      }
      const proposed = taskKind === 'topic-review' ? describeBatchTopics(content, zh) : null;
      if (proposed) activity('finding', zh ? '这一组的主要改动意图已经比较清楚了。' : "This group's main changes are becoming clear.", proposed);
      step++;
      transition = JSON.parse(advance_task(transition.state, content)) as Transition;
      if (taskKind === 'topic-review') {
        const groupTotal = transition.command?.messages ? transition.progress.total - 1 : transition.progress.total;
        const next = transition.command?.messages ? 'global' : transition.command ? 'batch' : 'done';
        update(zh ? `${next === 'global' ? '我正在对照所有组，整理重复或割裂的主题…' : next === 'batch' ? '这一组检查完了，我接着看下一组…' : '我正在完成最后的检查…'}` : next === 'global' ? "I'm comparing all groups for overlapping or separated topics…" : next === 'batch' ? "I've checked this group and am moving to the next…" : "I'm finishing the final checks…", transition.progress);
        activity('validation', zh ? `第 ${step}/${groupTotal} 组检查完了，改动都有对应的主题。` : `I've checked group ${step} of ${groupTotal}; each change has a topic.`);
      }
    }
    if (!transition.artifact) throw new Error('The AI task did not produce a result.');
    if (taskKind === 'topic-review') activity('done', zh ? '主题已经整理完成，可以开始逐项评审了。' : "The topics are ready for review.", zh ? `共 ${(transition.artifact as TopicArtifact).topics.length} 个主题` : `${(transition.artifact as TopicArtifact).topics.length} topics`);
    self.postMessage({ type: 'done', artifact: transition.artifact });
  } catch (error) {
    activity('error', zh ? '这次没有完成主题整理，我会保留过程供你查看。' : "I couldn't finish organizing the topics; the work log is available below.", error instanceof Error ? error.message : String(error));
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

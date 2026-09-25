import init, { advance_task, start_task_with_languages } from '../wasm/ming_core.js';
import type { AiRequestUsage, ReviewTitleArtifact, TopicArtifact } from '../lib/aiReviewTypes';

type Request = { taskKind?: 'topic-review' | 'review-title'; reviewJson: string; model: string; apiKey: string; summaryLanguage: 'en' | 'zh-CN'; reviewLanguage: 'en' | 'zh-CN'; uiLanguage?: 'en' | 'zh-CN' };
type Progress = { completed: number; total: number; currentFiles: number };
type Transition = { state: string | null; command: { provider: 'deepseek'; model: string; prompt: string; maxOutputTokens: number; timeoutMs: number; maxAttempts: number } | null; artifact: TopicArtifact | ReviewTitleArtifact | null; progress: Progress };

function update(message: string, progress: Progress) { self.postMessage({ type: 'progress', message, completed: progress.completed, total: progress.total }); }

function tokenCount(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }

async function generate(command: NonNullable<Transition['command']>, apiKey: string, group: number, progress: Progress, zh: boolean, taskKind: 'topic-review' | 'review-title'): Promise<string> {
  for (let attempt = 1; attempt <= command.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), command.timeoutMs);
    const started = Date.now();
    const label = taskKind === 'review-title' ? (zh ? '生成评审标题' : 'Generating review title') : zh ? `第 ${group}/${progress.total} 组 · ${progress.currentFiles} 个文件` : `Group ${group} of ${progress.total} · ${progress.currentFiles} ${progress.currentFiles === 1 ? 'file' : 'files'}`;
    update(zh ? `${label} · 正在请求 DeepSeek${attempt > 1 ? `（第 ${attempt} 次）` : ''}…` : `${label} · requesting DeepSeek${attempt > 1 ? ` (attempt ${attempt})` : ''}…`, progress);
    const ticker = setInterval(() => update(zh ? `${label} · 等待 DeepSeek（${Math.floor((Date.now() - started) / 1000)} 秒）…` : `${label} · waiting for DeepSeek (${Math.floor((Date.now() - started) / 1000)}s)…`, progress), 5_000);
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
        body: JSON.stringify({ model: command.model, stream: false, response_format: { type: 'json_object' },
          max_tokens: command.maxOutputTokens,
          messages: [{ role: 'system', content: 'You assist a human code reviewer. Return valid JSON only.' },
            { role: 'user', content: command.prompt }] }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < command.maxAttempts) {
        report('error', response.status);
        update(zh ? `${label} · DeepSeek 返回 ${response.status}，正在重试…` : `${label} · DeepSeek returned ${response.status}; retrying…`, progress);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        continue;
      }
      if (!response.ok) { report('error', response.status); throw new Error(`DeepSeek request failed (${response.status}).`); }
      const payload = await response.json() as { model?: string; usage?: Record<string, unknown>; choices?: { finish_reason?: string; message?: { content?: string } }[] };
      const choice = payload.choices?.[0];
      if (choice?.finish_reason !== 'stop' || !choice.message?.content) {
        report('error', response.status, payload.usage, payload.model);
        throw new Error('DeepSeek returned an incomplete topic response.');
      }
      report('success', response.status, payload.usage, payload.model);
      update(zh ? `${label} · 已收到响应，正在验证结果…` : `${label} · response received; validating result…`, progress);
      return choice.message.content;
    } catch (error) {
      if (!reported) report('error', null);
      throw error;
    } finally { clearTimeout(timeout); clearInterval(ticker); }
  }
  throw new Error('DeepSeek did not return a topic response.');
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const zh = event.data.uiLanguage === 'zh-CN';
  const taskKind = event.data.taskKind ?? 'topic-review';
  try {
    update(zh ? '正在加载 AI 评审框架…' : 'Loading the AI review harness…', { completed: 0, total: 0, currentFiles: 0 });
    await init();
    update(zh ? '正在规划改动分组…' : 'Planning change groups…', { completed: 0, total: 0, currentFiles: 0 });
    let transition = JSON.parse(start_task_with_languages(taskKind, event.data.reviewJson, event.data.model, event.data.summaryLanguage, event.data.reviewLanguage)) as Transition;
    let step = 0;
    while (transition.command && transition.state) {
      step++;
      const content = await generate(transition.command, event.data.apiKey, step, transition.progress, zh, taskKind);
      transition = JSON.parse(advance_task(transition.state, content)) as Transition;
      if (taskKind === 'topic-review') update(zh ? `已验证第 ${step}/${transition.progress.total} 组。${transition.progress.completed === transition.progress.total ? '正在合并主题…' : '正在准备下一组…'}` : `Validated group ${step} of ${transition.progress.total}. ${transition.progress.completed === transition.progress.total ? 'Combining topics…' : 'Preparing the next group…'}`, transition.progress);
    }
    if (!transition.artifact) throw new Error('The AI task did not produce a result.');
    self.postMessage({ type: 'done', artifact: transition.artifact });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

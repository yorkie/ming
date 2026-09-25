import init, { advance_task, start_task } from '../wasm/ming_core.js';
import type { AiRequestUsage, TopicArtifact } from '../lib/aiReviewTypes';

type Request = { reviewJson: string; model: string; apiKey: string };
type Progress = { completed: number; total: number; currentFiles: number };
type Transition = { state: string | null; command: { provider: 'deepseek'; model: string; prompt: string; maxOutputTokens: number; timeoutMs: number; maxAttempts: number } | null; artifact: TopicArtifact | null; progress: Progress };

function update(message: string, progress: Progress) { self.postMessage({ type: 'progress', message, completed: progress.completed, total: progress.total }); }

function tokenCount(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }

async function generate(command: NonNullable<Transition['command']>, apiKey: string, group: number, progress: Progress): Promise<string> {
  for (let attempt = 1; attempt <= command.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), command.timeoutMs);
    const started = Date.now();
    const label = `Group ${group} of ${progress.total} · ${progress.currentFiles} ${progress.currentFiles === 1 ? 'file' : 'files'}`;
    update(`${label} · requesting DeepSeek${attempt > 1 ? ` (attempt ${attempt})` : ''}…`, progress);
    const ticker = setInterval(() => update(`${label} · waiting for DeepSeek (${Math.floor((Date.now() - started) / 1000)}s)…`, progress), 5_000);
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
          messages: [{ role: 'system', content: 'You organize code diffs for a human reviewer. Return valid JSON only.' },
            { role: 'user', content: command.prompt }] }),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < command.maxAttempts) {
        report('error', response.status);
        update(`${label} · DeepSeek returned ${response.status}; retrying…`, progress);
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
      update(`${label} · response received; validating topics…`, progress);
      return choice.message.content;
    } catch (error) {
      if (!reported) report('error', null);
      throw error;
    } finally { clearTimeout(timeout); clearInterval(ticker); }
  }
  throw new Error('DeepSeek did not return a topic response.');
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    update('Loading the AI review harness…', { completed: 0, total: 0, currentFiles: 0 });
    await init();
    update('Planning change groups…', { completed: 0, total: 0, currentFiles: 0 });
    let transition = JSON.parse(start_task('topic-review', event.data.reviewJson, event.data.model)) as Transition;
    let step = 0;
    while (transition.command && transition.state) {
      step++;
      const content = await generate(transition.command, event.data.apiKey, step, transition.progress);
      transition = JSON.parse(advance_task(transition.state, content)) as Transition;
      update(`Validated group ${step} of ${transition.progress.total}. ${transition.progress.completed === transition.progress.total ? 'Combining topics…' : 'Preparing the next group…'}`, transition.progress);
    }
    if (!transition.artifact) throw new Error('The topic task did not produce a review.');
    self.postMessage({ type: 'done', artifact: transition.artifact });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

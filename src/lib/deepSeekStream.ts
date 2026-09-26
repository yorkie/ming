export type DeepSeekStreamResult = {
  content: string;
  finishReason: string | null;
  model: string | undefined;
  usage: Record<string, unknown> | undefined;
};

export type DeepSeekToolStreamResult = DeepSeekStreamResult & {
  reasoningContent: string;
  toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
};

type StreamChunk = { model?: string; usage?: Record<string, unknown> | null; choices?: { delta?: {
  content?: string | null; reasoning_content?: string | null; tool_calls?: { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
}; finish_reason?: string | null }[] };

async function readSse(body: ReadableStream<Uint8Array>, onChunk: (chunk: StreamChunk) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let done = false;
  const event = (raw: string) => {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    onChunk(JSON.parse(data) as StreamChunk);
  };
  const drain = () => {
    let boundary: number;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      event(pending.slice(0, boundary));
      pending = pending.slice(boundary + 2);
    }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      pending = (pending + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, '\n');
      drain();
    }
    pending += decoder.decode();
    drain();
    if (pending.trim()) event(pending);
  } finally { reader.releaseLock(); }
  if (!done) throw new Error('DeepSeek stream ended before completion.');
}

export async function readDeepSeekStream(body: ReadableStream<Uint8Array>, onContent: (characters: number) => void): Promise<DeepSeekStreamResult> {
  let content = '';
  let finishReason: string | null = null;
  let model: string | undefined;
  let usage: Record<string, unknown> | undefined;
  await readSse(body, chunk => {
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) { content += choice.delta.content; onContent(content.length); }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  });
  return { content, finishReason, model, usage };
}

export async function readDeepSeekToolStream(body: ReadableStream<Uint8Array>, onProgress: (characters: number) => void): Promise<DeepSeekToolStreamResult> {
  let content = '';
  let reasoningContent = '';
  let finishReason: string | null = null;
  let model: string | undefined;
  let usage: Record<string, unknown> | undefined;
  const calls = new Map<number, { id: string; type: 'function'; function: { name: string; arguments: string } }>();
  await readSse(body, chunk => {
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) content += choice.delta.content;
    if (choice?.delta?.reasoning_content) reasoningContent += choice.delta.reasoning_content;
    for (const delta of choice?.delta?.tool_calls ?? []) {
      const call = calls.get(delta.index) ?? { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
      if (delta.id) call.id = delta.id;
      if (delta.function?.name) call.function.name += delta.function.name;
      if (delta.function?.arguments) call.function.arguments += delta.function.arguments;
      calls.set(delta.index, call);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    onProgress(content.length + reasoningContent.length + [...calls.values()].reduce((total, call) => total + call.function.arguments.length, 0));
  });
  return { content, reasoningContent, toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call), finishReason, model, usage };
}

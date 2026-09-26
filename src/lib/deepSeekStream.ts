export type DeepSeekStreamResult = {
  content: string;
  finishReason: string | null;
  model: string | undefined;
  usage: Record<string, unknown> | undefined;
};

export async function readDeepSeekStream(body: ReadableStream<Uint8Array>, onContent: (characters: number) => void): Promise<DeepSeekStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let content = '';
  let finishReason: string | null = null;
  let model: string | undefined;
  let usage: Record<string, unknown> | undefined;
  let done = false;
  const event = (raw: string) => {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (data === '[DONE]') { done = true; return; }
    const chunk = JSON.parse(data) as { model?: string; usage?: Record<string, unknown> | null; choices?: { delta?: { content?: string }; finish_reason?: string | null }[] };
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    const choice = chunk.choices?.[0];
    if (choice?.delta?.content) { content += choice.delta.content; onContent(content.length); }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
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
  return { content, finishReason, model, usage };
}

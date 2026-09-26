import { strict as assert } from 'node:assert';
import { localizeAiProgress } from '../src/lib/aiProgress';
import { readDeepSeekStream, readDeepSeekToolStream } from '../src/lib/deepSeekStream';
import { deepSeekRequestError } from '../src/lib/deepSeekError';
import { buildAiStory, describeToolCall, describeToolResult, findingFromCall, formatWorkDuration } from '../src/lib/aiActivity';

const waiting = 'Group 3 of 3 · 4 files · waiting for DeepSeek (10s)…';
assert.equal(localizeAiProgress(waiting, 'zh-CN'), '第 3/3 组 · 4 个文件 · 等待 DeepSeek（10 秒）…');
assert.equal(localizeAiProgress(waiting, 'en'), waiting);
assert.equal(localizeAiProgress('Group 1 of 2 · 1 file · requesting DeepSeek (attempt 2)…', 'zh-CN'),
  '第 1/2 组 · 1 个文件 · 正在请求 DeepSeek（第 2 次）…');
assert.equal(localizeAiProgress('Validated group 2 of 2. Combining topics…', 'zh-CN'), '已验证第 2/2 组。正在合并主题…');
assert.equal(localizeAiProgress('Validated group 2 of 2. Reconciling topics across groups…', 'zh-CN'), '已验证第 2/2 组。正在全局整理主题…');
assert.equal(localizeAiProgress('Reconciling topics · request 3…', 'zh-CN'), '正在全局整理主题 · 第 3 次请求…');
assert.equal(localizeAiProgress('Reconciling topics · waiting (15s)…', 'zh-CN'), '正在全局整理主题 · 已等待 15 秒…');
assert.equal(localizeAiProgress('正在等待 DeepSeek…', 'zh-CN'), '正在等待 DeepSeek…');
assert.equal(localizeAiProgress('Group 2 of 5 · 8 files · 11 changes · received 1,024 characters (18s)…', 'zh-CN'),
  '第 2/5 组 · 8 个文件 · 11 处改动 · 已接收 1,024 字，耗时 18 秒…');
assert.equal(localizeAiProgress('Group 2 of 5 · 8 files · 11 changes · output limit reached; splitting this group…', 'zh-CN'),
  '第 2/5 组 · 8 个文件 · 11 处改动 · 输出达到上限，正在拆分这一组…');
const encoded = new TextEncoder().encode('data: {"model":"deepseek-flash","choices":[{"delta":{"content":"你好"},"finish_reason":null}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\r\n\r\ndata: [DONE]\r\n\r\n');
const chunks = [encoded.slice(0, 68), encoded.slice(68, 91), encoded.slice(91, -1), encoded.slice(-1)];
const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
const counts: number[] = [];
assert.deepEqual(await readDeepSeekStream(stream, count => counts.push(count)), {
  content: '你好!', finishReason: 'stop', model: 'deepseek-flash', usage: { total_tokens: 12 },
});
assert.deepEqual(counts, [2, 3]);
const truncated = new ReadableStream<Uint8Array>({ start(controller) {
  controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'));
  controller.close();
} });
assert.equal((await readDeepSeekStream(truncated, () => {})).finishReason, 'length');
assert.match((await deepSeekRequestError(new Response(JSON.stringify({ error: { message: 'context length exceeded' } }), { status: 400 }), 'global topic')).message,
  /global topic request failed \(400\): context length exceeded/);
assert.equal((await deepSeekRequestError(new Response('unavailable', { status: 503 }), 'topic')).message,
  'DeepSeek topic request failed (503).');
const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n')); controller.close(); } });
await assert.rejects(readDeepSeekStream(interrupted, () => {}), /ended before completion/);
const toolEvents = [
  'data: {"model":"deepseek-flash","choices":[{"delta":{"reasoning_content":"checking","tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_changes","arguments":"{\\"ids\\":["}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"f0h0\\"]}"}}]},"finish_reason":"tool_calls"}]}',
  'data: {"usage":{"total_tokens":20},"choices":[]}',
  'data: [DONE]',
].join('\n\n') + '\n\n';
const toolBytes = new TextEncoder().encode(toolEvents);
const toolStream = new ReadableStream<Uint8Array>({ start(controller) {
  controller.enqueue(toolBytes.slice(0, 113)); controller.enqueue(toolBytes.slice(113, 194)); controller.enqueue(toolBytes.slice(194)); controller.close();
} });
const toolProgress: number[] = [];
const toolResult = await readDeepSeekToolStream(toolStream, count => toolProgress.push(count));
assert.equal(toolResult.finishReason, 'tool_calls');
assert.equal(toolResult.reasoningContent, 'checking');
assert.deepEqual(toolResult.toolCalls, [{ id: 'call-1', type: 'function', function: { name: 'read_changes', arguments: '{"ids":["f0h0"]}' } }]);
assert.equal(toolResult.usage?.total_tokens, 20);
assert.ok(toolProgress.some(count => count > 8));
const readCall = { id: 'call-1', function: { name: 'read_changes', arguments: '{"ids":["f0h0","f1h0"]}' } };
assert.equal(describeToolCall(readCall, true), '读取改动 · f0h0, f1h0');
assert.equal(describeToolResult(readCall, [{ role: 'tool', tool_call_id: 'call-1', content: '{"units":[{"path":"src/a.ts"},{"path":"src/b.ts"}]}' }], true), '读取 2 处改动 · src/a.ts, src/b.ts');
const noteCall = { id: 'call-2', function: { name: 'remember_findings', arguments: '{"note":"Tests belong with the implementation."}' } };
assert.equal(findingFromCall(noteCall), 'Tests belong with the implementation.');
assert.equal(describeToolResult(noteCall, [{ role: 'tool', tool_call_id: 'call-2', content: '{"saved":true}' }], false), 'Finding saved for later reconciliation');
assert.equal(describeToolResult(readCall, [{ role: 'tool', tool_call_id: 'call-1', content: '{"error":"unknown unit ID"}' }], false), 'Tool error: unknown unit ID');
const story = buildAiStory([
  { id: 1, at: 1, kind: 'phase', title: 'Checking related topics' },
  { id: 2, at: 2, kind: 'request', title: 'Turn 1' },
  { id: 3, at: 3, kind: 'tool', title: 'Read changes' },
  { id: 4, at: 4, kind: 'request', title: 'Turn 2' },
  { id: 5, at: 5, kind: 'tool', title: 'Search changes' },
  { id: 6, at: 6, kind: 'finding', title: 'Related implementation and test' },
], false);
assert.equal(story.length, 3);
assert.equal(story[1].kind, 'tools');
assert.equal(story[1].tools?.length, 2);
assert.equal(story[2].title, 'Related implementation and test');
assert.equal(formatWorkDuration(330_000, false), '5m 30s');
assert.equal(formatWorkDuration(330_000, true), '5分30秒');
console.log('AI progress localization test passed');

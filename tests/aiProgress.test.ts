import { strict as assert } from 'node:assert';
import { localizeAiProgress } from '../src/lib/aiProgress';
import { readDeepSeekStream } from '../src/lib/deepSeekStream';

const waiting = 'Group 3 of 3 · 4 files · waiting for DeepSeek (10s)…';
assert.equal(localizeAiProgress(waiting, 'zh-CN'), '第 3/3 组 · 4 个文件 · 等待 DeepSeek（10 秒）…');
assert.equal(localizeAiProgress(waiting, 'en'), waiting);
assert.equal(localizeAiProgress('Group 1 of 2 · 1 file · requesting DeepSeek (attempt 2)…', 'zh-CN'),
  '第 1/2 组 · 1 个文件 · 正在请求 DeepSeek（第 2 次）…');
assert.equal(localizeAiProgress('Validated group 2 of 2. Combining topics…', 'zh-CN'), '已验证第 2/2 组。正在合并主题…');
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
const interrupted = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n')); controller.close(); } });
await assert.rejects(readDeepSeekStream(interrupted, () => {}), /ended before completion/);
console.log('AI progress localization test passed');

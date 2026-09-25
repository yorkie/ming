import { strict as assert } from 'node:assert';
import { localizeAiProgress } from '../src/lib/aiProgress';

const waiting = 'Group 3 of 3 · 4 files · waiting for DeepSeek (10s)…';
assert.equal(localizeAiProgress(waiting, 'zh-CN'), '第 3/3 组 · 4 个文件 · 等待 DeepSeek（10 秒）…');
assert.equal(localizeAiProgress(waiting, 'en'), waiting);
assert.equal(localizeAiProgress('Group 1 of 2 · 1 file · requesting DeepSeek (attempt 2)…', 'zh-CN'),
  '第 1/2 组 · 1 个文件 · 正在请求 DeepSeek（第 2 次）…');
assert.equal(localizeAiProgress('Validated group 2 of 2. Combining topics…', 'zh-CN'), '已验证第 2/2 组。正在合并主题…');
assert.equal(localizeAiProgress('正在等待 DeepSeek…', 'zh-CN'), '正在等待 DeepSeek…');
console.log('AI progress localization test passed');

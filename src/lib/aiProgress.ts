import type { Language } from './i18n';

/** Translate progress from an already-running worker, including older workers. */
export function localizeAiProgress(message: string, language: Language): string {
  if (language !== 'zh-CN') return message;
  const simple: Record<string, string> = {
    'Loading the AI review harness…': '正在加载 AI 评审框架…',
    'Planning change groups…': '正在规划改动分组…',
    'Preparing topic review…': '正在准备主题评审…',
  };
  if (simple[message]) return simple[message];

  const group = /^Group (\d+) of (\d+) · (\d+) files?(?: · (\d+) changes)? · (.+)$/.exec(message);
  if (group) {
    const label = `第 ${group[1]}/${group[2]} 组 · ${group[3]} 个文件${group[4] ? ` · ${group[4]} 处改动` : ''}`;
    const action = group[5];
    const waiting = /^waiting for DeepSeek \((\d+)s\)…$/.exec(action);
    if (waiting) return `${label} · 等待 DeepSeek（${waiting[1]} 秒）…`;
    const first = /^waiting for first response \((\d+)s\)…$/.exec(action);
    if (first) return `${label} · 等待首段响应（${first[1]} 秒）…`;
    const received = /^received ([\d,]+) characters \((\d+)s\)…$/.exec(action);
    if (received) return `${label} · 已接收 ${received[1]} 字，耗时 ${received[2]} 秒…`;
    const requesting = /^requesting DeepSeek(?: \(attempt (\d+)\))?…$/.exec(action);
    if (requesting) return `${label} · 正在请求 DeepSeek${requesting[1] ? `（第 ${requesting[1]} 次）` : ''}…`;
    const retrying = /^DeepSeek returned (\d+); retrying…$/.exec(action);
    if (retrying) return `${label} · DeepSeek 返回 ${retrying[1]}，正在重试…`;
    if (action === 'output limit reached; splitting this group…') return `${label} · 输出达到上限，正在拆分这一组…`;
    if (action === 'response received; validating topics…') return `${label} · 已收到响应，正在验证主题…`;
    if (action === 'response received; validating result…') return `${label} · 已收到响应，正在验证结果…`;
  }

  const validated = /^Validated group (\d+) of (\d+)\. (Combining topics…|Preparing the next group…)$/.exec(message);
  if (validated) return `已验证第 ${validated[1]}/${validated[2]} 组。${validated[3] === 'Combining topics…' ? '正在合并主题…' : '正在准备下一组…'}`;
  return message;
}

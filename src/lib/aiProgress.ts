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

  const group = /^Group (\d+) of (\d+) · (\d+) files? · (.+)$/.exec(message);
  if (group) {
    const label = `第 ${group[1]}/${group[2]} 组 · ${group[3]} 个文件`;
    const action = group[4];
    const waiting = /^waiting for DeepSeek \((\d+)s\)…$/.exec(action);
    if (waiting) return `${label} · 等待 DeepSeek（${waiting[1]} 秒）…`;
    const requesting = /^requesting DeepSeek(?: \(attempt (\d+)\))?…$/.exec(action);
    if (requesting) return `${label} · 正在请求 DeepSeek${requesting[1] ? `（第 ${requesting[1]} 次）` : ''}…`;
    const retrying = /^DeepSeek returned (\d+); retrying…$/.exec(action);
    if (retrying) return `${label} · DeepSeek 返回 ${retrying[1]}，正在重试…`;
    if (action === 'response received; validating topics…') return `${label} · 已收到响应，正在验证主题…`;
  }

  const validated = /^Validated group (\d+) of (\d+)\. (Combining topics…|Preparing the next group…)$/.exec(message);
  if (validated) return `已验证第 ${validated[1]}/${validated[2]} 组。${validated[3] === 'Combining topics…' ? '正在合并主题…' : '正在准备下一组…'}`;
  return message;
}

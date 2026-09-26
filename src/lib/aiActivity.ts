export type AiActivityKind = 'phase' | 'request' | 'tool' | 'finding' | 'validation' | 'retry' | 'done' | 'error' | 'canceled';

export type AiActivity = {
  id: number;
  at: number;
  kind: AiActivityKind;
  title: string;
  detail?: string;
};

export type AiStoryEntry = {
  id: number;
  kind: Exclude<AiActivityKind, 'request' | 'tool'> | 'tools';
  title: string;
  detail?: string;
  tools?: AiActivity[];
};

export function formatWorkDuration(milliseconds: number, zh: boolean): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (zh) return `${hours ? `${hours}小时` : ''}${hours || minutes ? `${minutes}分` : ''}${seconds}秒`;
  return `${hours ? `${hours}h ` : ''}${hours || minutes ? `${minutes}m ` : ''}${seconds}s`;
}

export function buildAiStory(activity: AiActivity[], zh: boolean): AiStoryEntry[] {
  const story: AiStoryEntry[] = [];
  for (const entry of activity) {
    if (entry.kind === 'request') continue;
    if (entry.kind === 'tool') {
      const previous = story.at(-1);
      if (previous?.kind === 'tools') previous.tools!.push(entry);
      else story.push({ id: entry.id, kind: 'tools', title: zh ? '我在查阅具体改动，核对主题之间的关系。' : "I'm checking the changes behind these topics.", tools: [entry] });
      continue;
    }
    story.push({ id: entry.id, kind: entry.kind, title: entry.title, detail: entry.detail });
  }
  return story;
}

type ToolCall = { id?: string; function?: { name?: string; arguments?: string } };
type ToolMessage = { role?: string; tool_call_id?: string; content?: string };

function parsed(value: string | undefined): Record<string, unknown> {
  try { const result: unknown = JSON.parse(value ?? '{}'); return result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {}; }
  catch { return {}; }
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function count(value: unknown): number { return Array.isArray(value) ? value.length : 0; }
function short(value: string, max = 180): string { return value.length > max ? `${value.slice(0, max)}…` : value; }

export function describeToolCall(call: ToolCall, zh: boolean): string {
  const args = parsed(call.function?.arguments);
  switch (call.function?.name) {
    case 'list_topics': return zh ? '查看现有主题与改动归属' : 'Inspect existing topics and assignments';
    case 'list_changes': return zh ? `列出改动 · 起点 ${args.offset ?? 0}，每页 ${args.limit ?? '默认'}` : `List changes · offset ${args.offset ?? 0}, limit ${args.limit ?? 'default'}`;
    case 'search_changes': return zh ? `搜索改动 · ${short(String(args.query ?? ''))}` : `Search changes · ${short(String(args.query ?? ''))}`;
    case 'read_changes': return zh ? `读取改动 · ${strings(args.ids).join(', ') || '未指定 ID'}` : `Read changes · ${strings(args.ids).join(', ') || 'no IDs'}`;
    case 'remember_findings': return zh ? '保存跨批次发现' : 'Save cross-batch finding';
    default: return zh ? `调用工具 · ${short(call.function?.name ?? 'unknown')}` : `Call tool · ${short(call.function?.name ?? 'unknown')}`;
  }
}

export function describeToolResult(call: ToolCall, messages: ToolMessage[] | undefined, zh: boolean): string {
  const message = messages?.find(item => item.role === 'tool' && item.tool_call_id === call.id);
  if (!message) return zh ? '工具已执行' : 'Tool executed';
  const result = parsed(message.content);
  if (typeof result.error === 'string') return zh ? `工具返回错误：${short(result.error)}` : `Tool error: ${short(result.error)}`;
  switch (call.function?.name) {
    case 'list_topics': return zh ? `返回 ${count(result.topics)} 个主题` : `Returned ${count(result.topics)} topics`;
    case 'list_changes': {
      const more = typeof result.total === 'number' && typeof result.offset === 'number' && result.offset + count(result.units) < result.total;
      return zh ? `返回 ${count(result.units)} 处改动${more ? '，还有下一页' : ''}` : `Returned ${count(result.units)} changes${more ? '; more available' : ''}`;
    }
    case 'search_changes': return zh ? `找到 ${count(result.matches)} 条匹配` : `Found ${count(result.matches)} matches`;
    case 'read_changes': {
      const units = Array.isArray(result.units) ? result.units as Record<string, unknown>[] : [];
      const paths = units.map(unit => typeof unit.path === 'string' ? unit.path : '').filter(Boolean);
      return zh ? `读取 ${units.length} 处改动${paths.length ? ` · ${short(paths.join(', '))}` : ''}` : `Read ${units.length} changes${paths.length ? ` · ${short(paths.join(', '))}` : ''}`;
    }
    case 'remember_findings': return result.saved === true ? zh ? '发现已保存，供后续整理使用' : 'Finding saved for later reconciliation' : zh ? '发现未保存' : 'Finding was not saved';
    default: return zh ? '工具已返回结果' : 'Tool returned a result';
  }
}

export function findingFromCall(call: ToolCall): string | null {
  if (call.function?.name !== 'remember_findings') return null;
  const note = parsed(call.function.arguments).note;
  return typeof note === 'string' && note.trim() ? short(note.trim(), 500) : null;
}

export function describeBatchTopics(content: string, zh: boolean): string | null {
  const topics = parsed(content).topics;
  if (!Array.isArray(topics)) return null;
  const titles = topics.map(item => item && typeof item === 'object' && typeof item.title === 'string' ? item.title.trim() : '').filter(Boolean);
  return zh ? `提出 ${titles.length} 个主题：${short(titles.join('、'), 300)}` : `Proposed ${titles.length} topics: ${short(titles.join('; '), 300)}`;
}

export function describeGlobalPlan(content: string, zh: boolean): string | null {
  const plan = parsed(content);
  if (!['merges', 'moves', 'newTopics', 'rewrites'].some(key => Array.isArray(plan[key]))) return null;
  const moved = Array.isArray(plan.moves) ? plan.moves.reduce((total, item) => total + (item && typeof item === 'object' ? strings(item.unitIds).length : 0), 0) : 0;
  return zh ? `合并 ${count(plan.merges)} 组主题，移动 ${moved} 处改动，新建 ${count(plan.newTopics)} 个主题，改写 ${count(plan.rewrites)} 个主题` : `${count(plan.merges)} merges, ${moved} changes moved, ${count(plan.newTopics)} new topics, ${count(plan.rewrites)} rewrites`;
}

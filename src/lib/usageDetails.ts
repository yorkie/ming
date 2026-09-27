import type { AiUsageRecord, Project } from './projectStore';
import { shortId } from './routes';

export type UsageSortKey = 'createdAt' | 'project' | 'task' | 'model' | 'status' |
  'promptTokens' | 'completionTokens' | 'cachedPromptTokens' | 'totalTokens';
export type UsageSortDirection = 'asc' | 'desc';
type TextKey = 'project' | 'task' | 'model' | 'status';

export function usageProjectNames(records: AiUsageRecord[], projects: Pick<Project, 'id' | 'name'>[]): Map<string, string> {
  const names = new Map(records.map(record => [record.projectId, record.projectName]));
  for (const project of projects) names.set(project.id, project.name);
  const counts = new Map<string, number>();
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1);
  const ids = [...names.keys()];
  return new Map([...names].map(([id, name]) => [id, counts.get(name)! > 1 ? `${name} · ${shortId(id, ids)}` : name]));
}

export function sortUsageRows(rows: AiUsageRecord[], key: UsageSortKey, direction: UsageSortDirection,
  textValue: (row: AiUsageRecord, key: TextKey) => string, locale?: string): AiUsageRecord[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const value = (row: AiUsageRecord): number | string | null => {
    if (key === 'project' || key === 'task' || key === 'model' || key === 'status') return textValue(row, key);
    return row[key];
  };
  return rows.slice().sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left === null || right === null) return left === right ? b.createdAt - a.createdAt || a.id.localeCompare(b.id) : left === null ? 1 : -1;
    const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return (direction === 'asc' ? order : -order) || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
}

export function usagePage(rows: AiUsageRecord[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);
  const start = (currentPage - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: currentPage, pageCount,
    first: rows.length ? start + 1 : 0, last: Math.min(start + pageSize, rows.length), total: rows.length };
}

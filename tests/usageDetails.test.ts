import { strict as assert } from 'node:assert';
import type { AiUsageRecord } from '../src/lib/projectStore';
import { sortUsageRows, usagePage, usageProjectNames } from '../src/lib/usageDetails';

function row(id: string, createdAt: number, projectName: string, promptTokens: number | null): AiUsageRecord {
  return { id, projectId: id, projectName, reviewId: 'review', createdAt, task: 'review-title',
    provider: 'deepseek', model: 'deepseek-flash', group: 0, attempt: 1, status: 'success', httpStatus: 200,
    promptTokens, completionTokens: 1, totalTokens: promptTokens === null ? null : promptTokens + 1, cachedPromptTokens: 0 };
}
const rows = [row('a', 100, 'Project 10', 20), row('b', 300, 'Project 2', null), row('c', 200, 'Project 1', 5)];
const label = (record: AiUsageRecord) => record.projectName;

const names = usageProjectNames([row('project-1', 1, 'ink', 1), row('project-2', 2, 'ink', 1), row('project-3', 3, 'ming', 1)], []);
assert.equal(names.get('project-1'), 'ink · project-1');
assert.equal(names.get('project-2'), 'ink · project-2');
assert.equal(names.get('project-3'), 'ming');

assert.deepEqual(sortUsageRows(rows, 'createdAt', 'desc', label).map(record => record.id), ['b', 'c', 'a']);
assert.deepEqual(sortUsageRows(rows, 'project', 'asc', label).map(record => record.id), ['c', 'b', 'a']);
assert.deepEqual(sortUsageRows(rows, 'promptTokens', 'desc', label).map(record => record.id), ['a', 'c', 'b']);
assert.deepEqual(sortUsageRows(rows, 'promptTokens', 'asc', label).map(record => record.id), ['c', 'a', 'b']);
assert.deepEqual(rows.map(record => record.id), ['a', 'b', 'c']);

const sorted = sortUsageRows(rows, 'createdAt', 'desc', label);
assert.deepEqual(usagePage(sorted, 1, 2), { rows: sorted.slice(0, 2), page: 1, pageCount: 2, first: 1, last: 2, total: 3 });
assert.deepEqual(usagePage(sorted, 2, 2), { rows: sorted.slice(2), page: 2, pageCount: 2, first: 3, last: 3, total: 3 });
assert.equal(usagePage(sorted, 9, 2).page, 2);
assert.deepEqual(usagePage([], 1, 20), { rows: [], page: 1, pageCount: 1, first: 0, last: 0, total: 0 });
console.log('Usage details sorting and pagination test passed');

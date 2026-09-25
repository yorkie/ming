import { strict as assert } from 'node:assert';
import { parseRoute, resolveId, routeUrl, shortId, type Route } from '../src/lib/routes';

const routes: Route[] = [
  { kind: 'home' },
  { kind: 'global-settings' },
  { kind: 'global-settings', section: 'appearance' },
  { kind: 'global-settings', section: 'files' },
  { kind: 'global-settings', section: 'reviews' },
  { kind: 'global-settings', section: 'copilot' },
  { kind: 'project', projectId: 'project 1', page: 'reviews' },
  { kind: 'project', projectId: 'project 1', page: 'files' },
  { kind: 'project', projectId: 'project 1', page: 'files', path: 'docs/Project guide #1.md' },
  { kind: 'project', projectId: 'project 1', page: 'branches' },
  { kind: 'project', projectId: 'project 1', page: 'settings' },
  { kind: 'review', projectId: 'project 1', reviewId: 'review/1', page: 'changes' },
  { kind: 'review', projectId: 'project 1', reviewId: 'review/1', page: 'commits' },
];
for (const route of routes) assert.deepEqual(parseRoute(routeUrl(route)), route);
assert.deepEqual(parseRoute(''), { kind: 'home' });
assert.deepEqual(parseRoute('/settings/'), { kind: 'global-settings' });
assert.deepEqual(parseRoute('/projects/?id=project-1'), { kind: 'project', projectId: 'project-1', page: 'files' });
assert.equal(parseRoute('/settings/?section=unknown'), null);
assert.equal(parseRoute('/projects/?id=project-1&page=unknown'), null);
assert.equal(parseRoute('/projects/?id=project-1&page=files&review=review-1'), null);
assert.equal(parseRoute('/projects/?id=project-1&page=reviews&review=review-1&tab=unknown'), null);
assert.equal(parseRoute('#/projects/project-1'), null);
assert.equal(routeUrl(routes[8]).includes('#'), false);
const ids = ['12345678-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
assert.equal(shortId(ids[0], ids), '12345678-a');
assert.equal(resolveId('12345678-a', ids), ids[0]);
assert.equal(resolveId(ids[0], ids), ids[0]);
assert.equal(resolveId('12345678', ids), null);
console.log('Route test passed');

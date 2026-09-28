import { strict as assert } from 'node:assert';
import { parseRoute, resolveId, routeUrl, shortId, type Route } from '../src/lib/routes';

const routes: Route[] = [
  { kind: 'home' },
  { kind: 'global-settings' },
  { kind: 'global-settings', section: 'usage' },
  { kind: 'global-settings', section: 'appearance' },
  { kind: 'global-settings', section: 'files' },
  { kind: 'global-settings', section: 'reviews' },
  { kind: 'global-settings', section: 'copilot' },
  { kind: 'global-settings', section: 'github' },
  { kind: 'project', projectId: 'project 1', page: 'reviews' },
  { kind: 'project', projectId: 'project 1', page: 'files' },
  { kind: 'project', projectId: 'project 1', page: 'files', path: 'docs/Project guide #1.md' },
  { kind: 'project', projectId: 'project 1', page: 'files', path: '/src/main.ts' },
  { kind: 'project', projectId: 'project 1', page: 'files', path: 'a//b' },
  { kind: 'project', projectId: 'project 1', page: 'files', path: 'src/' },
  { kind: 'project', projectId: 'project 1', page: 'branches' },
  { kind: 'project', projectId: 'project 1', page: 'settings' },
  { kind: 'review', projectId: 'project 1', reviewId: 'review/1', page: 'changes' },
  { kind: 'review', projectId: 'project 1', reviewId: 'review/1', page: 'commits' },
  { kind: 'review', projectId: 'f0be1b37', reviewId: '016f2202', page: 'topics' },
];
for (const route of routes) assert.deepEqual(parseRoute(routeUrl(route)), route);
assert.deepEqual(parseRoute(''), { kind: 'home' });
assert.equal(routeUrl({ kind: 'global-settings' }), '/console/');
assert.deepEqual(parseRoute('/console/'), { kind: 'global-settings' });
assert.deepEqual(parseRoute('/settings/'), { kind: 'global-settings' });
assert.deepEqual(parseRoute('/settings/reviews'), { kind: 'global-settings', section: 'reviews' });
assert.equal(routeUrl(routes.at(-1)!), '/projects/f0be1b37/reviews/016f2202/topics');
assert.deepEqual(parseRoute('/projects/project-1'), { kind: 'project', projectId: 'project-1', page: 'files' });
assert.equal(parseRoute('/console/unknown'), null);
assert.equal(parseRoute('/projects/project-1/unknown'), null);
assert.equal(parseRoute('/projects/project-1/github'), null);
assert.equal(parseRoute('/projects/project-1/branches/extra'), null);
assert.equal(parseRoute('/projects/project-1/reviews/review-1/unknown'), null);
assert.equal(parseRoute('/projects/?id=project-1&page=reviews'), null);
assert.equal(parseRoute('#/projects/project-1'), null);
assert.equal(routeUrl(routes[9]).includes('#'), false);
const ids = ['12345678-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '12345678-bbbb-bbbb-bbbb-bbbbbbbbbbbb'];
assert.equal(shortId(ids[0], ids), '12345678-a');
assert.equal(resolveId('12345678-a', ids), ids[0]);
assert.equal(resolveId(ids[0], ids), ids[0]);
assert.equal(resolveId('12345678', ids), null);
console.log('Route test passed');

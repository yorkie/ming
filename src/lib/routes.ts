export type Route =
  | { kind: 'home' }
  | { kind: 'global-settings'; section?: GlobalSettingsSection }
  | { kind: 'project'; projectId: string; page: 'files' | 'reviews' | 'branches' | 'settings'; path?: string }
  | { kind: 'review'; projectId: string; reviewId: string; page: 'changes' | 'commits' };

export type GlobalSettingsSection = 'appearance' | 'files' | 'reviews' | 'copilot';

export function shortId(id: string, ids: string[]): string {
  let length = Math.min(8, id.length);
  while (length < id.length && ids.some(other => other !== id && other.startsWith(id.slice(0, length)))) length++;
  return id.slice(0, length);
}

export function resolveId(value: string, ids: string[]): string | null {
  if (ids.includes(value)) return value;
  const matches = ids.filter(id => id.startsWith(value));
  return matches.length === 1 ? matches[0] : null;
}

export function routeUrl(route: Route): string {
  if (route.kind === 'home') return '/';
  if (route.kind === 'global-settings') return `/settings/${route.section ? `?section=${encodeURIComponent(route.section)}` : ''}`;
  const params = new URLSearchParams({ id: route.projectId });
  if (route.kind === 'project') {
    params.set('page', route.page);
    if (route.page === 'files' && route.path) params.set('path', route.path);
  } else {
    params.set('page', 'reviews');
    params.set('review', route.reviewId);
    params.set('tab', route.page);
  }
  return `/projects/?${params}`;
}

export function parseRoute(url: string): Route | null {
  let parsed: URL;
  try { parsed = new URL(url, 'https://ming.local/'); } catch { return null; }
  if (parsed.hash) return null;
  const pathname = parsed.pathname.replace(/\/index\.html$/, '/');
  if (pathname === '/') return { kind: 'home' };
  if (pathname === '/settings/' || pathname === '/settings') {
    const section = parsed.searchParams.get('section');
    if (!section) return { kind: 'global-settings' };
    if (['appearance', 'files', 'reviews', 'copilot'].includes(section)) return { kind: 'global-settings', section: section as GlobalSettingsSection };
    return null;
  }
  if (pathname !== '/projects/' && pathname !== '/projects') return null;
  const projectId = parsed.searchParams.get('id');
  if (!projectId) return null;
  const page = parsed.searchParams.get('page') ?? 'files';
  if (!['files', 'reviews', 'branches', 'settings'].includes(page)) return null;
  const reviewId = parsed.searchParams.get('review');
  if (reviewId) {
    const tab = parsed.searchParams.get('tab') ?? 'changes';
    if (page !== 'reviews' || !['changes', 'commits'].includes(tab)) return null;
    return { kind: 'review', projectId, reviewId, page: tab as 'changes' | 'commits' };
  }
  const path = parsed.searchParams.get('path');
  if (path && page !== 'files') return null;
  return { kind: 'project', projectId, page: page as 'files' | 'reviews' | 'branches' | 'settings', ...(path ? { path } : {}) };
}

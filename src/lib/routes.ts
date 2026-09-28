export type Route =
  | { kind: 'home' }
  | { kind: 'global-settings'; section?: GlobalSettingsSection }
  | { kind: 'project'; projectId: string; page: 'files' | 'reviews' | 'branches' | 'settings'; path?: string }
  | { kind: 'review'; projectId: string; reviewId: string; page: 'topics' | 'changes' | 'commits' };

export type GlobalSettingsSection = 'usage' | 'appearance' | 'files' | 'reviews' | 'copilot' | 'github';

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
  if (route.kind === 'global-settings') return `/console/${route.section ? encodeURIComponent(route.section) : ''}`;
  const base = `/projects/${encodeURIComponent(route.projectId)}`;
  if (route.kind === 'project') {
    const filePath = route.page === 'files' && route.path
      ? `/${route.path.split('/').map(encodeURIComponent).join('/')}` : '';
    return `${base}/${route.page}${filePath}`;
  }
  return `${base}/reviews/${encodeURIComponent(route.reviewId)}/${route.page}`;
}

export function parseRoute(url: string): Route | null {
  let parsed: URL;
  try { parsed = new URL(url, 'https://ming.local/'); } catch { return null; }
  if (parsed.hash) return null;
  const pathname = parsed.pathname.replace(/\/index\.html$/, '/');
  if (pathname === '/') return { kind: 'home' };
  const parts = pathname.slice(1).split('/');
  // A trailing slash is a delimiter for pages, but part of a file path.
  if (parts.at(-1) === '' && !(parts[0] === 'projects' && parts[2] === 'files' && parts.length > 3)) parts.pop();
  if (parts[0] === 'console' || parts[0] === 'settings') {
    if (parts.length === 1) return { kind: 'global-settings' };
    if (parts.length === 2 && ['usage', 'appearance', 'files', 'reviews', 'copilot', 'github'].includes(parts[1]))
      return { kind: 'global-settings', section: parts[1] as GlobalSettingsSection };
    return null;
  }
  if (parts[0] !== 'projects' || parts.length < 2) return null;
  let projectId: string;
  try { projectId = decodeURIComponent(parts[1]); } catch { return null; }
  if (!projectId) return null;
  if (parts.length === 2) return { kind: 'project', projectId, page: 'files' };
  const page = parts[2];
  if (page === 'reviews' && parts.length >= 4) {
    if (parts.length !== 5 || !['topics', 'changes', 'commits'].includes(parts[4])) return null;
    try { return { kind: 'review', projectId, reviewId: decodeURIComponent(parts[3]), page: parts[4] as 'topics' | 'changes' | 'commits' }; }
    catch { return null; }
  }
  if (page === 'files' && parts.length > 3) {
    try { return { kind: 'project', projectId, page, path: parts.slice(3).map(decodeURIComponent).join('/') }; }
    catch { return null; }
  }
  if (parts.length === 3 && ['files', 'reviews', 'branches', 'settings'].includes(page))
    return { kind: 'project', projectId, page: page as 'files' | 'reviews' | 'branches' | 'settings' };
  return null;
}

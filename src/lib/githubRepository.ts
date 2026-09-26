export type GitHubRepository = { owner: string; repo: string; url: string };

export function parseGitHubRepository(input: string): GitHubRepository | null {
  const value = input.trim();
  if (/^[^/:@?#\s]+\/[^/:@?#\s]+$/.test(value)) return parseGitHubRepository(`https://github.com/${value}`);
  const scp = /^git@github\.com:([^/?#]+)\/([^/?#]+?)(?:\.git)?$/.exec(value);
  let owner: string;
  let repo: string;
  if (scp) {
    [, owner, repo] = scp;
  } else {
    let url: URL;
    try { url = new URL(value); } catch { return null; }
    if (!['https:', 'ssh:', 'git:'].includes(url.protocol) || url.hostname.toLowerCase() !== 'github.com' || url.search || url.hash) return null;
    if (url.username && !(url.protocol === 'ssh:' && url.username === 'git') || url.password) return null;
    const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
    if (parts.length !== 2) return null;
    [owner, repo] = parts;
    repo = repo.replace(/\.git$/, '');
  }
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) || !/^[a-z\d_.-]+$/i.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

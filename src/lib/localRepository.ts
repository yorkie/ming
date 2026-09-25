import git from 'isomorphic-git';
import { Buffer } from 'buffer';
import { createTwoFilesPatch } from 'diff';

// isomorphic-git expects Node-style buffers and a small fs.promises interface.
Object.assign(globalThis, { Buffer });

type FsError = Error & { code: string };
function fsError(code: string, path: string): FsError {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

class BrowserRepositoryFs {
  private cache = new Map<string, FileSystemHandle>();
  constructor(private root: FileSystemDirectoryHandle) { this.cache.set('/', root); }

  private async handle(path: string): Promise<FileSystemHandle> {
    const parts = path.split('/').filter(part => part && part !== '.');
    if (parts.some(part => part === '..')) throw fsError('EINVAL', path);
    let current: FileSystemHandle = this.root;
    let prefix = '';
    for (const part of parts) {
      if (current.kind !== 'directory') throw fsError('ENOTDIR', path);
      const directory = current as FileSystemDirectoryHandle;
      prefix += `/${part}`;
      let next = this.cache.get(prefix);
      if (!next) {
        try { next = await directory.getFileHandle(part); }
        catch {
          try { next = await directory.getDirectoryHandle(part); }
          catch { throw fsError('ENOENT', path); }
        }
        this.cache.set(prefix, next);
      }
      current = next!;
    }
    return current;
  }

  promises = {
    readFile: async (path: string, options?: string | { encoding?: string }): Promise<Buffer | string> => {
      const handle = await this.handle(path);
      if (handle.kind !== 'file') throw fsError('EISDIR', path);
      const bytes = Buffer.from(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer());
      const encoding = typeof options === 'string' ? options : options?.encoding;
      return encoding ? bytes.toString(encoding as 'utf8') : bytes;
    },
    readdir: async (path: string): Promise<string[]> => {
      const handle = await this.handle(path);
      if (handle.kind !== 'directory') throw fsError('ENOTDIR', path);
      const names: string[] = [];
      for await (const child of (handle as FileSystemDirectoryHandle).values()) names.push(child.name);
      return names;
    },
    stat: async (path: string) => this.stat(path),
    lstat: async (path: string) => this.stat(path),
    readlink: async (path: string): Promise<string> => { throw fsError('EINVAL', path); },
    // Review is read-only. These reject if a Git operation unexpectedly tries to mutate a repository.
    writeFile: async (): Promise<never> => { throw fsError('EROFS', '/'); },
    unlink: async (): Promise<never> => { throw fsError('EROFS', '/'); },
    mkdir: async (): Promise<never> => { throw fsError('EROFS', '/'); },
    rmdir: async (): Promise<never> => { throw fsError('EROFS', '/'); },
    symlink: async (): Promise<never> => { throw fsError('EROFS', '/'); },
  };

  private async stat(path: string) {
    const handle = await this.handle(path);
    const file = handle.kind === 'file' ? await (handle as FileSystemFileHandle).getFile() : null;
    const mtimeMs = file?.lastModified ?? 0;
    return {
      type: handle.kind,
      mode: handle.kind === 'directory' ? 0o40755 : 0o100644,
      size: file?.size ?? 0,
      mtimeMs,
      ctimeMs: mtimeMs,
      mtime: new Date(mtimeMs),
      ctime: new Date(mtimeMs),
      dev: 0,
      ino: 0,
      uid: 0,
      gid: 0,
      isFile: () => handle.kind === 'file',
      isDirectory: () => handle.kind === 'directory',
      isSymbolicLink: () => false,
    };
  }
}

export function createRepositoryIgnoreChecker(root: FileSystemDirectoryHandle): (path: string) => Promise<boolean> {
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.isIgnored>[0]['fs'];
  return path => git.isIgnored({ fs: gitFs, dir: '/', filepath: path });
}

export async function validateGitRepository(root: FileSystemDirectoryHandle): Promise<void> {
  try {
    const gitdir = await root.getDirectoryHandle('.git');
    await gitdir.getFileHandle('HEAD');
  } catch {
    throw new Error('Select a Git repository root containing a .git directory. Worktrees with a .git file are not supported yet.');
  }
}

export type RepositoryInfo = { currentBranch: string | null; branches: string[]; headOid: string | null; latestCommit: CommitSummary | null };

export async function inspectRepository(root: FileSystemDirectoryHandle): Promise<RepositoryInfo> {
  await validateGitRepository(root);
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.currentBranch>[0]['fs'];
  const [currentBranch, branches, headOid] = await Promise.all([
    git.currentBranch({ fs: gitFs, dir: '/', fullname: false }).catch(() => null),
    git.listBranches({ fs: gitFs, dir: '/' }).catch(() => []),
    git.resolveRef({ fs: gitFs, dir: '/', ref: 'HEAD' }).catch(() => null),
  ]);
  const latestCommit = headOid ? await git.readCommit({ fs: gitFs, dir: '/', oid: headOid }).then(({ commit }) => ({
    oid: headOid,
    title: commit.message.split('\n')[0],
    author: commit.author.name,
    timestamp: commit.author.timestamp,
  })).catch(() => null) : null;
  return { currentBranch: currentBranch ?? null, branches, headOid, latestCommit };
}

export type CommitSummary = {
  oid: string;
  title: string;
  author: string;
  timestamp: number;
};

export type CommitHistory = {
  localRef: string;
  remoteRef: string | null;
  localOnly: CommitSummary[];
  remoteOnly: CommitSummary[];
  limit: number;
};

export async function readCommitHistory(root: FileSystemDirectoryHandle, localRef = 'HEAD', branch: string | null = null): Promise<CommitHistory> {
  await validateGitRepository(root);
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.log>[0]['fs'];
  const dir = '/';
  const limit = 150;
  const summarize = (entry: Awaited<ReturnType<typeof git.log>>[number]): CommitSummary => ({
    oid: entry.oid,
    title: entry.commit.message.split('\n')[0],
    author: entry.commit.author.name,
    timestamp: entry.commit.author.timestamp,
  });
  const currentBranch = branch ?? await git.currentBranch({ fs: gitFs, dir, fullname: false });
  if (!currentBranch) return { localRef, remoteRef: null, localOnly: [], remoteOnly: [], limit };
  const remote = await git.getConfig({ fs: gitFs, dir, path: `branch.${currentBranch}.remote` });
  const merge = await git.getConfig({ fs: gitFs, dir, path: `branch.${currentBranch}.merge` });
  if (!remote || !merge?.startsWith('refs/heads/')) {
    return { localRef, remoteRef: null, localOnly: [], remoteOnly: [], limit };
  }
  const remoteRef = `refs/remotes/${remote}/${merge.slice('refs/heads/'.length)}`;
  const remoteOid = await git.resolveRef({ fs: gitFs, dir, ref: remoteRef }).catch(() => null);
  if (!remoteOid) return { localRef, remoteRef: null, localOnly: [], remoteOnly: [], limit };
  const localOid = await git.resolveRef({ fs: gitFs, dir, ref: localRef });
  const mergeBases = await git.findMergeBase({ fs: gitFs, dir, oids: [localOid, remoteOid] });
  const common = new Set(mergeBases);
  const exclusive = async (ref: string) => {
    const entries = await git.log({ fs: gitFs, dir, ref, depth: limit + 1 });
    const baseIndex = entries.findIndex(entry => common.has(entry.oid));
    return entries.slice(0, baseIndex < 0 ? limit : Math.min(baseIndex, limit)).map(summarize);
  };
  const [localOnly, remoteOnly] = await Promise.all([exclusive(localOid), exclusive(remoteOid)]);
  return { localRef, remoteRef: `${remote}/${merge.slice('refs/heads/'.length)}`, localOnly, remoteOnly, limit };
}

export type MarkdownSnapshot = { before: string; after: string };

export async function readMarkdownSnapshot(root: FileSystemDirectoryHandle, ref: string, path: string): Promise<{ snapshot: MarkdownSnapshot; patch: string }> {
  await validateGitRepository(root);
  if (!/\.md$/i.test(path)) throw new Error('Rich diff is available for Markdown files only.');
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.readBlob>[0]['fs'];
  const oid = await git.resolveRef({ fs: gitFs, dir: '/', ref }).catch(() => null);
  if (ref !== 'HEAD' && !oid) throw new Error(`Comparison ref not found: ${ref}`);
  // An unborn HEAD points to a branch name without a commit. Treat its tree as empty,
  // just as readLocalRepository does when creating the original Review.
  const oldBlob = oid ? await git.readBlob({ fs: gitFs, dir: '/', oid, filepath: path }).catch(() => null) : null;
  const newBlob = await fs.promises.readFile(`/${path}`).catch(() => null);
  const beforeBytes = oldBlob?.blob ?? new Uint8Array();
  const afterBytes = newBlob ? new Uint8Array(newBlob as Buffer) : new Uint8Array();
  if (beforeBytes.length + afterBytes.length > 1_000_000) throw new Error('Markdown file is too large for Rich diff.');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const snapshot = { before: decoder.decode(beforeBytes), after: decoder.decode(afterBytes) };
  const header = `diff --git a/${path} b/${path}\n${!oldBlob ? 'new file mode 100644\n' : ''}${!newBlob ? 'deleted file mode 100644\n' : ''}`;
  return { snapshot, patch: header + createTwoFilesPatch(`a/${path}`, `b/${path}`, snapshot.before, snapshot.after, '', '', { context: 3 }) };
}

export async function readLocalRepository(root: FileSystemDirectoryHandle, ref = 'HEAD', onProgress?: (message: string) => void, onMarkdown?: (path: string, snapshot: MarkdownSnapshot) => void): Promise<string> {
  await validateGitRepository(root);

  const fs = new BrowserRepositoryFs(root);
  const dir = '/';
  // BrowserRepositoryFs implements the read-only fs.promises methods isomorphic-git uses.
  const gitFs = fs as unknown as Parameters<typeof git.statusMatrix>[0]['fs'];
  const headOid = await git.resolveRef({ fs: gitFs, dir, ref }).catch(() => null);
  if (ref !== 'HEAD' && !headOid) throw new Error(`Comparison ref not found: ${ref}`);
  // isomorphic-git otherwise rewrites .git/index to refresh stat data.
  const matrix = await git.statusMatrix({ fs: gitFs, dir, ref, refresh: false });
  const changed = matrix.filter(([, head, workdir]) => head !== workdir);
  onProgress?.(`Found ${changed.length} changed files. Generating diffs…`);
  if (changed.length > 200) throw new Error(`This repository has ${changed.length} changed files. A scan can handle up to 200 files.`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const patches: string[] = [];

  for (const [index, [path, head, workdir]] of changed.entries()) {
    if (index > 0 && index % 10 === 0) onProgress?.(`Processed ${index} of ${changed.length} files…`);
    if (path.startsWith('.git/')) continue;
    let oldBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let newBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    if (head && headOid) {
      const result = await git.readBlob({ fs: gitFs, dir, oid: headOid, filepath: path });
      oldBytes = result.blob;
    }
    if (workdir) {
      const result = await fs.promises.readFile(`/${path}`);
      newBytes = new Uint8Array(result as Buffer);
    }
    let binary = oldBytes.length > 2_000_000 || newBytes.length > 2_000_000 || oldBytes.includes(0) || newBytes.includes(0);
    let oldText = '';
    let newText = '';
    if (!binary) {
      try { oldText = decoder.decode(oldBytes); newText = decoder.decode(newBytes); }
      catch { binary = true; }
    }
    if (!binary && /\.md$/i.test(path) && oldText.length + newText.length <= 1_000_000) {
      onMarkdown?.(path, { before: oldText, after: newText });
    }
    const header = `diff --git a/${path} b/${path}\n${!head ? 'new file mode 100644\n' : ''}${!workdir ? 'deleted file mode 100644\n' : ''}`;
    if (binary) {
      patches.push(`${header}Binary files a/${path} and b/${path} differ\n`);
    } else {
      patches.push(header + createTwoFilesPatch(`a/${path}`, `b/${path}`, oldText, newText, '', '', { context: 3 }));
    }
  }
  return patches.join('');
}

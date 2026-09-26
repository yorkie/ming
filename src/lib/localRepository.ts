import git from 'isomorphic-git';
import { Buffer } from 'buffer';
import { createTwoFilesPatch } from 'diff';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { PackedGitObjects } from './packedGitObjects';

// isomorphic-git expects Node-style buffers and a small fs.promises interface.
Object.assign(globalThis, { Buffer });

type FsError = Error & { code: string };
type RepositoryIoStats = {
  handleCalls: number; handleMs: number;
  getFileCalls: number; getFileMs: number;
  directoryCalls: number; directoryMs: number;
  readCalls: number; readMs: number; readBytes: number;
  packReadCalls: number; packReadMs: number; packReadBytes: number;
  packRangeReads: number; packRangeBytes: number; packIndexBytes: number; packObjects: number; packDeltas: number;
};
function fsError(code: string, path: string): FsError {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

class BrowserRepositoryFs {
  private cache = new Map<string, FileSystemHandle>();
  private fileSnapshots = new Map<string, File>();
  private packNames?: string[];
  private packedObjects?: PackedGitObjects;
  private ignoreFiles = new Map<string, Buffer | null>();
  private io: RepositoryIoStats = { handleCalls: 0, handleMs: 0, getFileCalls: 0, getFileMs: 0,
    directoryCalls: 0, directoryMs: 0, readCalls: 0, readMs: 0, readBytes: 0,
    packReadCalls: 0, packReadMs: 0, packReadBytes: 0,
    packRangeReads: 0, packRangeBytes: 0, packIndexBytes: 0, packObjects: 0, packDeltas: 0 };
  constructor(private root: FileSystemDirectoryHandle, private onDirectory?: (path: string) => void, private skipGitAtRoot = false, packRanges = false) {
    this.cache.set('/', root);
    if (packRanges) this.packedObjects = new PackedGitObjects(root);
  }

  private async getFile(handle: FileSystemFileHandle): Promise<File> {
    const started = performance.now();
    try { return await handle.getFile(); }
    finally { this.io.getFileCalls++; this.io.getFileMs += performance.now() - started; }
  }

  stats(): RepositoryIoStats { return { ...this.io,
    packRangeReads: this.packedObjects?.rangeReads ?? 0,
    packRangeBytes: this.packedObjects?.rangeBytes ?? 0,
    packIndexBytes: this.packedObjects?.indexBytes ?? 0,
    packObjects: this.packedObjects?.objects ?? 0,
    packDeltas: this.packedObjects?.deltas ?? 0 };
  }

  async packedBlob(oid: string): Promise<Uint8Array | null> {
    const object = await this.packedObjects?.object(oid);
    return object?.type === 'blob' ? object.content : null;
  }

  async file(path: string): Promise<File> {
    const handle = await this.handle(path);
    if (handle.kind !== 'file') throw fsError('EISDIR', path);
    return this.getFile(handle as FileSystemFileHandle);
  }

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
        const started = performance.now();
        try {
          try { next = await directory.getFileHandle(part); }
          catch {
            try { next = await directory.getDirectoryHandle(part); }
            catch { throw fsError('ENOENT', path); }
          }
        } finally { this.io.handleCalls++; this.io.handleMs += performance.now() - started; }
        this.cache.set(prefix, next);
      }
      current = next!;
    }
    return current;
  }

  promises = {
    readFile: async (path: string, options?: string | { encoding?: string }): Promise<Buffer | string> => {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      const ignoreConfig = this.skipGitAtRoot && (path.endsWith('/.gitignore') || path === '/.git/info/exclude');
      let bytes = ignoreConfig ? this.ignoreFiles.get(path) : undefined;
      if (bytes === null) throw fsError('ENOENT', path);
      if (!bytes) {
        // An OID has the same bytes whether stored loose or packed. Resolve
        // indexed objects before probing a usually absent loose-object path.
        const oid = /^\/\.git\/objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/.exec(path);
        if (oid && this.packedObjects) {
          const packed = await this.packedObjects.looseObject(oid[1] + oid[2]);
          if (packed) {
            bytes = Buffer.from(packed);
            return encoding ? bytes.toString(encoding as 'utf8') : bytes;
          }
        }
        try {
          const snapshot = this.fileSnapshots.get(path);
          if (snapshot) this.fileSnapshots.delete(path);
          const file = snapshot ?? await this.file(path);
          const started = performance.now();
          bytes = Buffer.from(await file.arrayBuffer());
          const elapsed = performance.now() - started;
          this.io.readCalls++; this.io.readMs += elapsed; this.io.readBytes += bytes.length;
          if (path.startsWith('/.git/objects/pack/') && path.endsWith('.pack')) {
            this.io.packReadCalls++; this.io.packReadMs += elapsed; this.io.packReadBytes += bytes.length;
          }
          if (ignoreConfig) this.ignoreFiles.set(path, bytes);
        } catch (error) {
          if (ignoreConfig && (error as FsError).code === 'ENOENT') this.ignoreFiles.set(path, null);
          throw error;
        }
      }
      return encoding ? bytes.toString(encoding as 'utf8') : bytes;
    },
    readdir: async (path: string): Promise<string[]> => {
      // isomorphic-git lists this directory before every packed-object lookup.
      // Its contents are stable for the lifetime of one read-only scan.
      if (path === '/.git/objects/pack' && this.packNames) return this.packNames;
      const handle = await this.handle(path);
      if (handle.kind !== 'directory') throw fsError('ENOTDIR', path);
      if (path !== '/.git' && !path.startsWith('/.git/')) this.onDirectory?.(path === '/' ? '.' : path.replace(/^\//, ''));
      const names: string[] = [];
      const started = performance.now();
      try {
        for await (const child of (handle as FileSystemDirectoryHandle).values()) {
          if (this.skipGitAtRoot && path === '/' && child.name === '.git') continue;
          // values() already supplied the handle. Reuse it when Git later stats
          // or reads this entry instead of resolving every path through the API.
          this.cache.set(`${path === '/' ? '' : path}/${child.name}`, child);
          names.push(child.name);
        }
      } finally { this.io.directoryCalls++; this.io.directoryMs += performance.now() - started; }
      if (path === '/.git/objects/pack') this.packNames = names;
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
    const file = handle.kind === 'file' ? await this.getFile(handle as FileSystemFileHandle) : null;
    if (file && path !== '/.git' && !path.startsWith('/.git/')) this.fileSnapshots.set(path, file);
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

  clearFileSnapshots() { this.fileSnapshots.clear(); }
  takeFileSnapshot(path: string): File | undefined {
    const file = this.fileSnapshots.get(path);
    this.fileSnapshots.delete(path);
    return file;
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

export async function resolveComparisonRef(root: FileSystemDirectoryHandle, configuredRef: string, branch: string | null): Promise<string> {
  if (configuredRef !== 'HEAD' || !branch) return configuredRef;
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.getConfig>[0]['fs'];
  const remote = await git.getConfig({ fs: gitFs, dir: '/', path: `branch.${branch}.remote` });
  const merge = await git.getConfig({ fs: gitFs, dir: '/', path: `branch.${branch}.merge` });
  const upstream = remote && remote !== '.' && merge?.startsWith('refs/heads/')
    ? `${remote}/${merge.slice('refs/heads/'.length)}` : null;
  const candidates = [...new Set([upstream, `origin/${branch}`].filter((ref): ref is string => !!ref))];
  for (const candidate of candidates) {
    if (await git.resolveRef({ fs: gitFs, dir: '/', ref: `refs/remotes/${candidate}` }).catch(() => null)) return candidate;
  }
  throw new Error(`No local remote-tracking ref for ${branch}. Fetch its remote branch, or choose a comparison ref in project settings.`);
}

export async function resolveComparisonOid(root: FileSystemDirectoryHandle, ref: string): Promise<string | null> {
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.resolveRef>[0]['fs'];
  return git.resolveRef({ fs: gitFs, dir: '/', ref }).catch(() => null);
}

export type CommitSummary = {
  oid: string;
  title: string;
  author: string;
  timestamp: number;
};

/** Latest first-parent commit that changed each entry in the current Git tree. */
export async function readEntryCommits(root: FileSystemDirectoryHandle, path: string, names: string[], headOid: string | null): Promise<Record<string, CommitSummary | null>> {
  const result: Record<string, CommitSummary | null> = Object.fromEntries(names.map(name => [name, null]));
  if (!headOid || !names.length) return result;
  const fs = new BrowserRepositoryFs(root);
  const gitFs = fs as unknown as Parameters<typeof git.readTree>[0]['fs'];
  const tree = async (oid: string) => {
    try { return new Map((await git.readTree({ fs: gitFs, dir: '/', oid, ...(path ? { filepath: path } : {}) })).tree.map(entry => [entry.path, entry.oid])); }
    catch { return new Map<string, string>(); }
  };
  const pending = new Set(names);
  const headTree = await tree(headOid);
  for (const name of names) if (!headTree.has(name)) pending.delete(name);
  let oid: string | undefined = headOid;
  let depth = 0;
  while (oid && pending.size && depth++ < 500) {
    const currentOid: string = oid;
    const { commit } = await git.readCommit({ fs: gitFs, dir: '/', oid: currentOid });
    const parentOid: string | undefined = commit.parent[0];
    const [current, parent] = await Promise.all([tree(currentOid), parentOid ? tree(parentOid) : Promise.resolve(new Map<string, string>())]);
    for (const name of pending) {
      if (current.get(name) !== headTree.get(name)) continue;
      if (current.get(name) === parent.get(name)) continue;
      result[name] = { oid: currentOid, title: commit.message.split('\n')[0], author: commit.author.name, timestamp: commit.author.timestamp };
      pending.delete(name);
    }
    oid = parentOid;
  }
  return result;
}

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

export type ScanOptions = {
  filepaths?: string[];
  packRanges?: boolean;
  // Allows the read-only benchmark to compare walker scheduling policies.
  walkConcurrency?: number;
  onPatch?: (patch: string) => void;
  collectPatch?: boolean;
  onTiming?: (timing: { statusMs: number; diffMs: number; checked: number; changed: number; io: RepositoryIoStats }) => void;
};

async function fileDigest(file: File): Promise<string> {
  const hash = sha256.create();
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
    }
  } finally { reader.releaseLock(); }
  return bytesToHex(hash.digest());
}

async function largeFileDigests(file: File): Promise<{ oid: string; fingerprint: string }> {
  const oidHash = sha1.create();
  const fingerprintHash = sha256.create();
  oidHash.update(new TextEncoder().encode(`blob ${file.size}\0`));
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      oidHash.update(value);
      fingerprintHash.update(value);
    }
  } finally { reader.releaseLock(); }
  return { oid: bytesToHex(oidHash.digest()), fingerprint: bytesToHex(fingerprintHash.digest()) };
}

type ChangedEntry = { path: string; oldOid: string | null; workdir: boolean; stage: boolean; fingerprint?: string; content?: Uint8Array };

async function changedEntries(fs: BrowserRepositoryFs, ref: string, cache: object, options: ScanOptions): Promise<{ entries: ChangedEntry[]; checked: number }> {
  const gitFs = fs as unknown as Parameters<typeof git.walk>[0]['fs'];
  const headerEncoder = new TextEncoder();
  const autocrlf = await git.getConfig({ fs: gitFs, dir: '/', path: 'core.autocrlf' });
  // This limit applies to every nested directory. Large values multiply into
  // thousands of pending walks on deep repositories and delay the whole scan.
  const walkConcurrency = options.walkConcurrency !== undefined && Number.isFinite(options.walkConcurrency)
    ? Math.max(1, Math.floor(options.walkConcurrency)) : 2;
  let activeReads = 0;
  const waiting: Array<{ weight: number; resolve: () => void }> = [];
  const withReadSlot = async <T>(weight: number, read: () => Promise<T>): Promise<T> => {
    if (activeReads + weight > 16 || waiting.length) await new Promise<void>(resolve => waiting.push({ weight, resolve }));
    else activeReads += weight;
    try { return await read(); }
    finally {
      activeReads -= weight;
      while (waiting.length && activeReads + waiting[0].weight <= 16) {
        const next = waiting.shift()!;
        activeReads += next.weight;
        next.resolve();
      }
    }
  };
  let checked = 0;
  const relevant = (path: string) => !options.filepaths?.length || path === '.' || options.filepaths.some(base =>
    path === base || path.startsWith(`${base}/`) || base.startsWith(`${path}/`));
  const entries = await git.walk({ fs: gitFs, dir: '/', cache, trees: [git.TREE({ ref }), git.WORKDIR({ refresh: false }), git.STAGE()],
    iterate: async (walk, children) => {
      const paths = [...children];
      const results: unknown[] = new Array(paths.length);
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(walkConcurrency, paths.length) }, async () => {
        while (next < paths.length) {
          const index = next++;
          results[index] = await walk(paths[index]);
        }
      }));
      return results;
    },
    map: async (path, [head, workdir, stage]) => {
      if (path === '.git' || path.startsWith('.git/') || !relevant(path)) return null;
      const [headType, workdirType, stageType] = await Promise.all([head?.type(), workdir?.type(), stage?.type()]);
      if (!head && !stage && workdir && await git.isIgnored({ fs: gitFs, dir: '/', filepath: workdirType === 'tree' ? `${path}/` : path })) return null;
      if (headType === 'commit' || stageType === 'commit') return null;
      if (![headType, workdirType, stageType].includes('blob')) return;
      if (workdirType === 'special') return;
      checked++;
      const headOid = headType === 'blob' ? await head!.oid() : null;
      if (!headOid && workdirType !== 'blob') return;
      let fingerprint: string | undefined;
      let changedContent: Uint8Array | undefined;
      if (headOid && workdirType === 'blob') {
        const workdirStat = await workdir!.stat();
        const workdirOid = await withReadSlot((workdirStat?.size ?? 0) > 2_000_000 ? 16 : 1, async () => {
          if ((workdirStat?.size ?? 0) > 2_000_000 && autocrlf !== 'true') {
            const file = fs.takeFileSnapshot(`/${path}`) ?? await fs.file(`/${path}`);
            const digests = await largeFileDigests(file);
            fingerprint = digests.fingerprint;
            return digests.oid;
          }
          const content = await workdir!.content();
          if (!content) return null;
          if (autocrlf !== 'true') changedContent = content;
          const header = headerEncoder.encode(`blob ${content.length}\0`);
          const object = new Uint8Array(header.length + content.length);
          object.set(header);
          object.set(content, header.length);
          return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-1', object)));
        });
        if (workdirOid === headOid) return;
      }
      return { path, oldOid: headOid, workdir: workdirType === 'blob', stage: stageType === 'blob', fingerprint,
        content: changedContent } satisfies ChangedEntry;
    } });
  return { entries: entries as ChangedEntry[], checked };
}

export async function readLocalRepository(root: FileSystemDirectoryHandle, ref = 'HEAD', onProgress?: (message: string) => void, onMarkdown?: (path: string, snapshot: MarkdownSnapshot) => void, options: ScanOptions = {}): Promise<string> {
  const started = performance.now();
  await validateGitRepository(root);

  let scannedDirectories = 0;
  let lastProgress = 0;
  const fs = new BrowserRepositoryFs(root, path => {
    scannedDirectories++;
    if (scannedDirectories > 10_000) throw new Error(`Scan stopped after 10,000 directories near ${path}. Add generated or unrelated directories to .gitignore, then scan again.`);
    const now = Date.now();
    if (scannedDirectories === 1 || now - lastProgress >= 100) {
      onProgress?.(`Scanning directory: ${path === '.' ? root.name : path} (${scannedDirectories} checked)…`);
      lastProgress = now;
    }
  }, true, options.packRanges ?? true);
  const dir = '/';
  // BrowserRepositoryFs implements the read-only fs.promises methods isomorphic-git uses.
  const gitFs = fs as unknown as Parameters<typeof git.readBlob>[0]['fs'];
  const gitCache = {};
  const headOid = await git.resolveRef({ fs: gitFs, dir, ref }).catch(() => null);
  if (ref !== 'HEAD' && !headOid) throw new Error(`Comparison ref not found: ${ref}`);
  const { entries: changed, checked } = await changedEntries(fs, ref, gitCache, options);
  fs.clearFileSnapshots();
  const statusReady = performance.now();
  const trackedCount = changed.filter(({ oldOid, stage }) => oldOid || stage).length;
  onProgress?.(`Found ${trackedCount} Git tree changes and ${changed.length - trackedCount} untracked files. Generating diffs…`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const patches: string[] = [];

  for (const [index, { path, oldOid, workdir, fingerprint, content }] of changed.entries()) {
    if (index === 0 || index === changed.length - 1 || Date.now() - lastProgress >= 100) {
      onProgress?.(`Generating diff ${index + 1} of ${changed.length}: ${path}`);
      lastProgress = Date.now();
    }
    if (path.startsWith('.git/')) continue;
    let oldBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    let newBytes: Uint8Array<ArrayBufferLike> = new Uint8Array();
    const workFile = workdir && !content ? await fs.file(`/${path}`) : null;
    const largeWorkFile = !!workFile && workFile.size > 2_000_000;
    if (oldOid && !largeWorkFile) {
      oldBytes = await fs.packedBlob(oldOid)
        ?? (await git.readBlob({ fs: gitFs, dir, oid: oldOid, cache: gitCache })).blob;
    }
    if (content) newBytes = content;
    else if (workdir && !largeWorkFile) {
      newBytes = new Uint8Array(await workFile!.arrayBuffer());
    }
    let binary = largeWorkFile || oldBytes.length > 2_000_000 || newBytes.length > 2_000_000 || oldBytes.includes(0) || newBytes.includes(0);
    let oldText = '';
    let newText = '';
    if (!binary) {
      try { oldText = decoder.decode(oldBytes); newText = decoder.decode(newBytes); }
      catch { binary = true; }
    }
    if (!binary && /\.md$/i.test(path) && oldText.length + newText.length <= 1_000_000) {
      onMarkdown?.(path, { before: oldText, after: newText });
    }
    const header = `diff --git a/${path} b/${path}\n${!oldOid ? 'new file mode 100644\n' : ''}${!workdir ? 'deleted file mode 100644\n' : ''}`;
    if (binary) {
      const oldId = oldOid ?? '';
      const newId = fingerprint ?? (largeWorkFile ? await fileDigest(workFile!) : bytesToHex(sha256(newBytes)));
      const patch = `${header}Ming-Binary-Fingerprint: git:${oldId}:sha256:${newId}\nBinary files a/${path} and b/${path} differ\n`;
      if (options.collectPatch !== false) patches.push(patch);
      options.onPatch?.(patch);
    } else {
      const patch = header + createTwoFilesPatch(`a/${path}`, `b/${path}`, oldText, newText, '', '', { context: 3 });
      if (options.collectPatch !== false) patches.push(patch);
      options.onPatch?.(patch);
    }
  }
  options.onTiming?.({ statusMs: statusReady - started, diffMs: performance.now() - statusReady, checked, changed: changed.length, io: fs.stats() });
  return patches.join('');
}

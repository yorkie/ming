import { createRepositoryIgnoreChecker } from './localRepository';

export type ProjectFileEntry = { name: string; kind: 'directory' | 'file' };
export type ProjectFileContent = { text: string | null; reason: 'large' | 'binary' | null; size: number };
export type ProjectDirectory = { kind: 'directory'; path: string; entries: ProjectFileEntry[]; readme: { name: string; content: ProjectFileContent } | null };
export type ProjectFile = { kind: 'file'; path: string; name: string; content: ProjectFileContent };
export type ProjectPath = ProjectDirectory | ProjectFile;

export function resolveProjectAssetPath(markdownPath: string, source: string): string | null {
  if (!source || source.startsWith('//') || source.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(source) || source.includes('\\')) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(source.split(/[?#]/, 1)[0]); }
  catch { return null; }
  const parts = decoded.startsWith('/') ? [] : markdownPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else if (part === '.git' || part.includes('\0')) return null;
    else parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}

function segments(path: string): string[] {
  if (!path) return [];
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part === '.git')) throw new Error('Invalid project path.');
  return parts;
}

async function readText(handle: FileSystemFileHandle, maxTextBytes: number): Promise<ProjectFileContent> {
  const file = await handle.getFile();
  if (file.size > maxTextBytes) return { text: null, reason: 'large', size: file.size };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return { text: null, reason: 'binary', size: file.size };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), reason: null, size: file.size }; }
  catch { return { text: null, reason: 'binary', size: file.size }; }
}

export async function readProjectPath(root: FileSystemDirectoryHandle, path = '', maxTextBytes = 500_000): Promise<ProjectPath> {
  const parts = segments(path);
  const isIgnored = createRepositoryIgnoreChecker(root);
  let directory = root;
  for (const [index, part] of parts.slice(0, -1).entries()) {
    if (await isIgnored(`${parts.slice(0, index + 1).join('/')}/`)) throw new Error(`File or folder not found: ${path}`);
    try { directory = await directory.getDirectoryHandle(part); }
    catch { throw new Error(`Folder not found: ${path}`); }
  }
  if (parts.length) {
    const name = parts[parts.length - 1];
    try { directory = await directory.getDirectoryHandle(name); }
    catch {
      if (name !== '.gitignore' && await isIgnored(path)) throw new Error(`File or folder not found: ${path}`);
      let handle: FileSystemFileHandle;
      try { handle = await directory.getFileHandle(name); }
      catch { throw new Error(`File or folder not found: ${path}`); }
      return { kind: 'file', path, name, content: await readText(handle, maxTextBytes) };
    }
    if (await isIgnored(`${path}/`)) throw new Error(`File or folder not found: ${path}`);
  }
  const handles: FileSystemHandle[] = [];
  for await (const handle of directory.values()) if (handle.name !== '.git') handles.push(handle);
  const checked = await Promise.all(handles.map(async handle => {
    if (handle.name === '.gitignore') return { name: handle.name, kind: handle.kind } as ProjectFileEntry;
    const entryPath = path ? `${path}/${handle.name}` : handle.name;
    return await isIgnored(handle.kind === 'directory' ? `${entryPath}/` : entryPath) ? null : { name: handle.name, kind: handle.kind } as ProjectFileEntry;
  }));
  const entries = checked.filter((entry): entry is ProjectFileEntry => entry !== null);
  entries.sort((a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name, 'en', { numeric: true }));
  const readmeName = entries.find(entry => entry.kind === 'file' && entry.name === 'README.md')?.name
    ?? entries.find(entry => entry.kind === 'file' && /^readme\.(md|markdown)$/i.test(entry.name))?.name;
  const readme = readmeName ? { name: readmeName, content: await readText(await directory.getFileHandle(readmeName), maxTextBytes) } : null;
  return { kind: 'directory', path, entries, readme };
}

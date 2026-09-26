import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { open, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { readLocalRepository } from '../src/lib/localRepository';

const rootPath = resolve(process.argv[2] ?? '.');
const ref = process.argv[3] ?? 'HEAD';
const filepaths = process.argv[4] ? [process.argv[4]] : undefined;
const walkConcurrency = process.env.MING_BENCH_WALK ? Number(process.env.MING_BENCH_WALK) : undefined;
const directoryDelayMs = Number(process.env.MING_BENCH_DIRECTORY_DELAY_MS ?? 0);
const packRanges = process.env.MING_BENCH_PACK_RANGES !== '0';
const counters = { getFile: 0, fileHandleLookups: 0, directoryHandleLookups: 0, fileBytes: 0, fileReads: 0, directories: 0, patches: 0, patchBytes: 0 };
const readsByPath = new Map<string, { count: number; bytes: number }>();
const patchHash = createHash('sha256');
const directoriesByTopLevel = new Map<string, number>();
const directoryCounts = new Map<string, number>();
function countRead(path: string, bytes: number) {
  counters.fileReads++;
  counters.fileBytes += bytes;
  const previous = readsByPath.get(path) ?? { count: 0, bytes: 0 };
  readsByPath.set(path, { count: previous.count + 1, bytes: previous.bytes + bytes });
}
function file(path: string): FileSystemFileHandle {
  return {
    kind: 'file', name: basename(path),
    async getFile() {
      counters.getFile++;
      const info = await stat(path);
      return {
        size: info.size,
        lastModified: info.mtimeMs,
        async arrayBuffer() {
          const bytes = await readFile(path);
          countRead(path, bytes.length);
          return Uint8Array.from(bytes).buffer;
        },
        stream() {
          countRead(path, info.size);
          return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
        },
        slice(start = 0, end = info.size) {
          return { async arrayBuffer() {
            const length = Math.max(0, end - start);
            const buffer = Buffer.allocUnsafe(length);
            const handle = await open(path, 'r');
            try {
              const { bytesRead } = await handle.read(buffer, 0, length, start);
              countRead(path, bytesRead);
              return Uint8Array.from(buffer.subarray(0, bytesRead)).buffer;
            } finally { await handle.close(); }
          } } as Blob;
        },
      } as File;
    },
  } as FileSystemFileHandle;
}
function directory(path: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory', name: basename(path),
    async getFileHandle(name: string) {
      counters.fileHandleLookups++;
      const next = join(path, name);
      if (!(await stat(next)).isFile()) throw new Error('not a file');
      return file(next);
    },
    async getDirectoryHandle(name: string) {
      counters.directoryHandleLookups++;
      const next = join(path, name);
      if (!(await stat(next)).isDirectory()) throw new Error('not a directory');
      return directory(next);
    },
    async *values() {
      counters.directories++;
      if (directoryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, directoryDelayMs));
      directoryCounts.set(path, (directoryCounts.get(path) ?? 0) + 1);
      const top = path === rootPath ? '.' : path.slice(rootPath.length + 1).split('/')[0];
      directoriesByTopLevel.set(top, (directoriesByTopLevel.get(top) ?? 0) + 1);
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const next = join(path, entry.name);
        // Follow symlinks as getDirectoryHandle/getFileHandle do in this mock.
        yield (entry.isSymbolicLink() ? (await stat(next)).isDirectory() : entry.isDirectory()) ? directory(next) : file(next);
      }
    },
  } as FileSystemDirectoryHandle;
}

async function main() {
  let peakRss = 0;
  let lastProgress = performance.now();
  const started = performance.now();
  const memoryTimer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
  try {
    await readLocalRepository(directory(rootPath), ref, message => {
      const now = performance.now();
      if (now - lastProgress >= 5_000) {
        console.log(JSON.stringify({ elapsedMs: Math.round(now - started), progress: message }));
        lastProgress = now;
      }
    }, undefined, {
      filepaths,
      packRanges,
      walkConcurrency,
      collectPatch: false,
      onPatch: patch => { counters.patches++; counters.patchBytes += patch.length; patchHash.update(patch); },
      onTiming: timing => console.log(JSON.stringify({ timing, walkConcurrency: walkConcurrency ?? 1, counters })),
    });
  } finally { clearInterval(memoryTimer); }
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  const largestReads = [...readsByPath].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 10);
  console.log(JSON.stringify({ totalMs: Math.round(performance.now() - started), peakRss, patchHash: patchHash.digest('hex'), counters, largestReads,
    directoriesByTopLevel: Object.fromEntries([...directoriesByTopLevel].sort((a, b) => b[1] - a[1])) }));
  console.log(JSON.stringify({ frequentDirectories: [...directoryCounts].sort((a, b) => b[1] - a[1]).slice(0, 12) }));
  console.log(JSON.stringify({ frequentReads: [...readsByPath].sort((a, b) => b[1].count - a[1].count).slice(0, 20) }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

import { sha1 } from '@noble/hashes/legacy.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type ObjectType = 'commit' | 'tree' | 'blob' | 'tag';
type DecodedObject = { type: ObjectType; content: Uint8Array };
type Pack = { file: File; name: string; offsets: Map<number, PackEntry> };
type PackEntry = { pack: Pack; offset: number; end: number };

class UnsupportedPackDelta extends Error {}

const encoder = new TextEncoder();
const objectTypes: Record<number, ObjectType> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

function wrappedObject(object: DecodedObject): Uint8Array {
  const header = encoder.encode(`${object.type} ${object.content.length}\0`);
  const wrapped = new Uint8Array(header.length + object.content.length);
  wrapped.set(header);
  wrapped.set(object.content, header.length);
  return wrapped;
}

function readDeltaVarint(bytes: Uint8Array, cursor: { value: number }): number {
  let result = 0;
  let shift = 0;
  while (true) {
    if (cursor.value >= bytes.length || shift > 49) throw new Error('Invalid Git pack delta length');
    const byte = bytes[cursor.value++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return result;
    shift += 7;
  }
}

function applyDelta(delta: Uint8Array, base: Uint8Array): Uint8Array {
  const cursor = { value: 0 };
  const sourceLength = readDeltaVarint(delta, cursor);
  const targetLength = readDeltaVarint(delta, cursor);
  if (sourceLength !== base.length || targetLength > 256_000_000) throw new Error('Invalid Git pack delta size');
  const result = new Uint8Array(targetLength);
  let written = 0;
  while (cursor.value < delta.length) {
    const instruction = delta[cursor.value++];
    if (instruction & 0x80) {
      let offset = 0;
      let length = 0;
      for (let i = 0; i < 4; i++) if (instruction & (1 << i)) offset += delta[cursor.value++] * 2 ** (8 * i);
      for (let i = 0; i < 3; i++) if (instruction & (1 << (i + 4))) length += delta[cursor.value++] * 2 ** (8 * i);
      if (!length) length = 0x10000;
      if (offset + length > base.length || written + length > result.length) throw new Error('Invalid Git pack delta copy');
      result.set(base.subarray(offset, offset + length), written);
      written += length;
    } else if (instruction) {
      if (cursor.value + instruction > delta.length || written + instruction > result.length) throw new Error('Invalid Git pack delta insert');
      result.set(delta.subarray(cursor.value, cursor.value + instruction), written);
      cursor.value += instruction;
      written += instruction;
    } else throw new Error('Invalid Git pack delta instruction');
  }
  if (written !== result.length) throw new Error('Incomplete Git pack delta');
  return result;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads only the packed objects requested by isomorphic-git. Every returned
 * object is checked against its requested SHA-1 before it is exposed as a
 * synthetic loose object; isomorphic-git checks the loose object again.
 */
export class PackedGitObjects {
  private entries?: Map<string, PackEntry>;
  private loading?: Promise<Map<string, PackEntry>>;
  private decoded = new Map<string, DecodedObject>();
  rangeBytes = 0;
  rangeReads = 0;
  indexBytes = 0;
  objects = 0;
  deltas = 0;

  constructor(private root: FileSystemDirectoryHandle) {}

  private async indexes(): Promise<Map<string, PackEntry>> {
    if (this.entries) return this.entries;
    if (this.loading) return this.loading;
    this.loading = this.loadIndexes();
    try { return this.entries = await this.loading; }
    finally { this.loading = undefined; }
  }

  private async loadIndexes(): Promise<Map<string, PackEntry>> {
    const objects = await (await this.root.getDirectoryHandle('.git')).getDirectoryHandle('objects');
    let directory: FileSystemDirectoryHandle;
    try { directory = await objects.getDirectoryHandle('pack'); }
    catch (error) {
      if ((error as DOMException).name === 'NotFoundError' || (error as { code?: string }).code === 'ENOENT') return new Map();
      throw error;
    }
    const handles = new Map<string, FileSystemFileHandle>();
    for await (const handle of directory.values()) if (handle.kind === 'file') handles.set(handle.name, handle as FileSystemFileHandle);
    const entries = new Map<string, PackEntry>();
    for (const [name, handle] of handles) {
      if (!name.endsWith('.idx')) continue;
      const packHandle = handles.get(name.slice(0, -4) + '.pack');
      if (!packHandle) continue;
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      this.indexBytes += bytes.length;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (bytes.length < 1064 || view.getUint32(0) !== 0xff744f63 || view.getUint32(4) !== 2) continue;
      const count = view.getUint32(8 + 255 * 4);
      const oidStart = 8 + 1024;
      const offsetStart = oidStart + count * 24;
      const largeStart = offsetStart + count * 4;
      if (largeStart + 40 > bytes.length) throw new Error('Truncated Git pack index');
      const pack: Pack = { file: await packHandle.getFile(), name: name.slice(0, -4) + '.pack', offsets: new Map() };
      const offsets: Array<{ oid: string; offset: number }> = [];
      for (let i = 0; i < count; i++) {
        const oid = bytesToHex(bytes.subarray(oidStart + i * 20, oidStart + (i + 1) * 20));
        const raw = view.getUint32(offsetStart + i * 4);
        const offset = raw & 0x80000000
          ? Number(view.getBigUint64(largeStart + (raw & 0x7fffffff) * 8))
          : raw;
        if (!Number.isSafeInteger(offset) || offset < 12 || offset >= pack.file.size - 20) throw new Error('Invalid Git pack offset');
        offsets.push({ oid, offset });
      }
      offsets.sort((a, b) => a.offset - b.offset);
      for (let i = 0; i < offsets.length; i++) {
        const entry = offsets[i];
        const packed = { pack, offset: entry.offset, end: offsets[i + 1]?.offset ?? pack.file.size - 20 };
        entries.set(entry.oid, packed);
        pack.offsets.set(entry.offset, packed);
      }
    }
    return entries;
  }

  private async at(entry: PackEntry, depth: number): Promise<DecodedObject> {
    if (depth > 64) throw new Error('Git pack delta chain is too deep');
    const key = `${entry.pack.name}:${entry.offset}`;
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const bytes = new Uint8Array(await entry.pack.file.slice(entry.offset, entry.end).arrayBuffer());
    this.rangeBytes += bytes.length;
    this.rangeReads++;
    this.objects++;
    let position = 0;
    let byte = bytes[position++];
    const typeNumber = (byte >> 4) & 7;
    let size = byte & 0x0f;
    let shift = 4;
    while (byte & 0x80) {
      byte = bytes[position++];
      size += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    }
    let base: DecodedObject | undefined;
    if (typeNumber === 6) {
      this.deltas++;
      byte = bytes[position++];
      let distance = byte & 0x7f;
      while (byte & 0x80) {
        byte = bytes[position++];
        distance = (distance + 1) * 128 + (byte & 0x7f);
      }
      const baseOffset = entry.offset - distance;
      const baseEntry = entry.pack.offsets.get(baseOffset);
      if (!baseEntry) throw new Error('Missing Git pack delta base');
      base = await this.at(baseEntry, depth + 1);
    } else if (typeNumber === 7) {
      this.deltas++;
      const baseOid = bytesToHex(bytes.subarray(position, position + 20));
      position += 20;
      const baseEntry = (await this.indexes()).get(baseOid);
      // Git also permits a ref-delta to use a loose object. Let isomorphic-git
      // handle that uncommon layout with its regular packed-object reader.
      if (!baseEntry) throw new UnsupportedPackDelta('Git pack reference delta base is outside indexed packs');
      base = await this.at(baseEntry, depth + 1);
    }
    if (position >= bytes.length) throw new Error('Truncated Git pack object');
    const inflated = await inflate(bytes.subarray(position));
    if (inflated.length !== size) throw new Error('Git pack object length mismatch');
    const type = base?.type ?? objectTypes[typeNumber];
    if (!type) throw new Error('Unsupported Git pack object type');
    const result = { type, content: base ? applyDelta(inflated, base.content) : inflated };
    this.decoded.set(key, result);
    return result;
  }

  async object(oid: string): Promise<DecodedObject | null> {
    if (!/^[0-9a-f]{40}$/.test(oid) || typeof DecompressionStream === 'undefined') return null;
    const entry = (await this.indexes()).get(oid);
    if (!entry) return null;
    let object: DecodedObject;
    try { object = await this.at(entry, 0); }
    catch (error) {
      if (error instanceof UnsupportedPackDelta) return null;
      throw error;
    }
    const wrapped = wrappedObject(object);
    if (bytesToHex(sha1(wrapped)) !== oid) throw new Error(`Git packed object checksum mismatch: ${oid}`);
    return object;
  }

  async looseObject(oid: string): Promise<Uint8Array | null> {
    if (typeof CompressionStream === 'undefined') return null;
    const object = await this.object(oid);
    return object ? deflate(wrappedObject(object)) : null;
  }
}

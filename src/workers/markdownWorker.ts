import init, { analyze_patch } from '../wasm/ming_core.js';
import { readMarkdownSnapshot } from '../lib/localRepository';

type Request = { directory: FileSystemDirectoryHandle; baseRef: string; path: string };
self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const { snapshot, patch } = await readMarkdownSnapshot(event.data.directory, event.data.baseRef, event.data.path);
    await init();
    const data = JSON.parse(analyze_patch(patch)) as { files: Array<{ status: string; hunks: unknown[] }> };
    self.postMessage({ type: 'done', snapshot, status: data.files[0]?.status, hunks: data.files[0]?.hunks });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

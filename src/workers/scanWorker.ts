import init, { analyze_patch } from '../wasm/ming_core.js';
import { inspectRepository, readLocalRepository, type MarkdownSnapshot } from '../lib/localRepository';

type ScanRequest = { directory: FileSystemDirectoryHandle; baseRef: string };

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  try {
    self.postMessage({ type: 'progress', message: 'Reading repository information…' });
    const gitInfo = await inspectRepository(event.data.directory);
    self.postMessage({ type: 'progress', message: 'Comparing the Git working tree…' });
    const markdown = new Map<string, MarkdownSnapshot>();
    const patch = await readLocalRepository(event.data.directory, event.data.baseRef, message => {
      self.postMessage({ type: 'progress', message });
    }, (path, snapshot) => markdown.set(path, snapshot));
    if (!patch) {
      self.postMessage({ type: 'done', gitInfo, data: null });
      return;
    }
    self.postMessage({ type: 'progress', message: 'Parsing file diffs…' });
    await init();
    const data = JSON.parse(analyze_patch(patch)) as { files: Array<{ path: string; markdown?: MarkdownSnapshot }> };
    for (const file of data.files) file.markdown = markdown.get(file.path);
    self.postMessage({ type: 'done', gitInfo, data: JSON.stringify(data) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

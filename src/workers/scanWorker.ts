import init, { analyze_patch, review_snapshot_hash } from '../wasm/ming_core.js';
import { inspectRepository, readLocalRepository, resolveComparisonRef, type MarkdownSnapshot } from '../lib/localRepository';

type ScanRequest = { directory: FileSystemDirectoryHandle; baseRef: string };

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  try {
    self.postMessage({ type: 'progress', message: 'Reading repository information…' });
    const gitInfo = await inspectRepository(event.data.directory);
    const baseRef = await resolveComparisonRef(event.data.directory, event.data.baseRef, gitInfo.currentBranch);
    self.postMessage({ type: 'progress', message: `Comparing working tree with ${baseRef}…` });
    const markdown = new Map<string, MarkdownSnapshot>();
    const patch = await readLocalRepository(event.data.directory, baseRef, message => {
      self.postMessage({ type: 'progress', message });
    }, (path, snapshot) => markdown.set(path, snapshot));
    if (!patch) {
      self.postMessage({ type: 'done', gitInfo, baseRef, data: null });
      return;
    }
    self.postMessage({ type: 'progress', message: 'Parsing file diffs…' });
    await init();
    const data = JSON.parse(analyze_patch(patch)) as { files: Array<{ path: string; markdown?: MarkdownSnapshot }> };
    for (const file of data.files) file.markdown = markdown.get(file.path);
    const reviewJson = JSON.stringify(data);
    self.postMessage({ type: 'done', gitInfo, baseRef, data: reviewJson, snapshotHash: review_snapshot_hash(reviewJson) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

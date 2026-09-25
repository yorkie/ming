import { readCommitHistory } from '../lib/localRepository';

self.onmessage = async (event: MessageEvent<{ directory: FileSystemDirectoryHandle; localRef?: string; branch?: string | null }>) => {
  try {
    const history = await readCommitHistory(event.data.directory, event.data.localRef, event.data.branch);
    self.postMessage({ type: 'done', history });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

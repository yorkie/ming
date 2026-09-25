import init, { analyze_patch, review_snapshot_hash } from '../wasm/ming_core.js';
import { inspectRepository, readLocalRepository, resolveComparisonRef, type MarkdownSnapshot } from '../lib/localRepository';

type ScanRequest = { directory: FileSystemDirectoryHandle; baseRef: string; uiLanguage?: 'en' | 'zh-CN' };

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const zh = event.data.uiLanguage === 'zh-CN';
  const progress = (message: string) => {
    if (!zh) return message;
    const directory = /^Scanning directory: (.+) \((\d+) checked\)…$/.exec(message);
    if (directory) return `正在扫描目录：${directory[1]}（已检查 ${directory[2]} 个）…`;
    const found = /^Found (\d+) changed files\. Generating diffs…$/.exec(message);
    if (found) return `发现 ${found[1]} 个改动文件，正在生成差异…`;
    const diff = /^Generating diff (\d+) of (\d+): (.+)$/.exec(message);
    if (diff) return `正在生成差异 ${diff[1]}/${diff[2]}：${diff[3]}`;
    return message;
  };
  try {
    self.postMessage({ type: 'progress', message: zh ? '正在读取仓库信息…' : 'Reading repository information…' });
    const gitInfo = await inspectRepository(event.data.directory);
    const baseRef = await resolveComparisonRef(event.data.directory, event.data.baseRef, gitInfo.currentBranch);
    self.postMessage({ type: 'progress', message: zh ? `正在将工作区与 ${baseRef} 比较…` : `Comparing working tree with ${baseRef}…` });
    const markdown = new Map<string, MarkdownSnapshot>();
    const patch = await readLocalRepository(event.data.directory, baseRef, message => {
      self.postMessage({ type: 'progress', message: progress(message) });
    }, (path, snapshot) => markdown.set(path, snapshot));
    if (!patch) {
      self.postMessage({ type: 'done', gitInfo, baseRef, data: null });
      return;
    }
    self.postMessage({ type: 'progress', message: zh ? '正在解析文件差异…' : 'Parsing file diffs…' });
    await init();
    const data = JSON.parse(analyze_patch(patch)) as { files: Array<{ path: string; markdown?: MarkdownSnapshot }> };
    for (const file of data.files) file.markdown = markdown.get(file.path);
    const reviewJson = JSON.stringify(data);
    self.postMessage({ type: 'done', gitInfo, baseRef, data: reviewJson, snapshotHash: review_snapshot_hash(reviewJson) });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

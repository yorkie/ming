import init, { analyze_patch, review_snapshot_hash } from '../wasm/ming_core.js';
import { inspectRepository, readLocalRepository, resolveComparisonOid, resolveComparisonRef, type MarkdownSnapshot } from '../lib/localRepository';
import { canMergePartialReview, mergeScannedReview } from '../lib/mergeScannedReview';
import type { FileChange, Review } from '../lib/reviewTypes';

type ScanRequest = { directory: FileSystemDirectoryHandle; baseRef: string; source?: 'manual' | 'background'; uiLanguage?: 'en' | 'zh-CN'; filepaths?: string[]; previousData?: string | null; expectedHeadOid?: string | null; expectedBaseRef?: string; expectedBaseOid?: string | null; expectedBranch?: string | null; expectedDataPresent?: boolean };

self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const zh = event.data.uiLanguage === 'zh-CN';
  const progress = (message: string) => {
    if (!zh) return message;
    const directory = /^Scanning directory: (.+) \((\d+) checked\)…$/.exec(message);
    if (directory) return `正在扫描目录：${directory[1]}（已检查 ${directory[2]} 个）…`;
    const found = /^Found (\d+) Git tree changes and (\d+) untracked files\. Generating diffs…$/.exec(message);
    if (found) return `发现 ${found[1]} 个 Git 树改动文件和 ${found[2]} 个未跟踪文件，正在生成差异…`;
    const diff = /^Generating diff (\d+) of (\d+): (.+)$/.exec(message);
    if (diff) return `正在生成差异 ${diff[1]}/${diff[2]}：${diff[3]}`;
    return message;
  };
  try {
    const started = performance.now();
    self.postMessage({ type: 'progress', message: zh ? '正在读取仓库信息…' : 'Reading repository information…' });
    const gitInfo = await inspectRepository(event.data.directory);
    const baseRef = await resolveComparisonRef(event.data.directory, event.data.baseRef, gitInfo.currentBranch);
    const baseOid = await resolveComparisonOid(event.data.directory, baseRef);
    const repositoryReady = performance.now();
    const partial = canMergePartialReview({ filepaths: event.data.filepaths, headOid: event.data.expectedHeadOid,
      baseRef: event.data.expectedBaseRef, baseOid: event.data.expectedBaseOid, branch: event.data.expectedBranch,
      hadReview: event.data.expectedDataPresent, previousData: event.data.previousData },
    { headOid: gitInfo.headOid, baseRef, baseOid, branch: gitInfo.currentBranch });
    const filepaths = partial ? event.data.filepaths : undefined;
    self.postMessage({ type: 'progress', message: zh ? `正在将工作区与 ${baseRef} 比较…` : `Comparing working tree with ${baseRef}…` });
    const markdown = new Map<string, MarkdownSnapshot>();
    await init();
    const files: FileChange[] = [];
    let batch: string[] = [];
    let statusMs = 0;
    let diffMs = 0;
    let parseMs = 0;
    let parseDuringScanMs = 0;
    let scanning = true;
    let checked = 0;
    let io: Record<string, number> | undefined;
    const flush = () => {
      if (!batch.length) return;
      const started = performance.now();
      files.push(...(JSON.parse(analyze_patch(batch.join(''))) as Review).files);
      batch = [];
      const elapsed = performance.now() - started;
      parseMs += elapsed;
      if (scanning) parseDuringScanMs += elapsed;
    };
    await readLocalRepository(event.data.directory, baseRef, message => {
      self.postMessage({ type: 'progress', message: progress(message) });
    }, (path, snapshot) => markdown.set(path, snapshot), { filepaths, collectPatch: false, onPatch: patch => {
      batch.push(patch);
      if (batch.length >= 32) flush();
    }, onTiming: timing => { ({ statusMs, diffMs, checked, io } = timing); } });
    scanning = false;
    self.postMessage({ type: 'progress', message: zh ? '正在解析文件差异…' : 'Parsing file diffs…' });
    flush();
    for (const file of files) file.markdown = markdown.get(file.path);
    const previous = partial && event.data.previousData ? JSON.parse(event.data.previousData) as Review : null;
    const data = mergeScannedReview(previous, files, filepaths);
    const processed = performance.now();
    const logTiming = (changed: number, snapshotMs = 0) => {
      const finished = performance.now();
      console.debug(`[Ming scan] ${JSON.stringify({ source: event.data.source ?? 'unknown', mode: filepaths ? 'partial' : 'full',
        checked, changed, repositoryMs: Math.round(repositoryReady - started), statusMs: Math.round(statusMs),
        diffMs: Math.round(diffMs - parseDuringScanMs), parseMs: Math.round(parseMs),
        otherMs: Math.round(processed - repositoryReady - statusMs - diffMs - (parseMs - parseDuringScanMs)),
        snapshotMs: Math.round(snapshotMs), workerMs: Math.round(finished - started),
        io: io && Object.fromEntries(Object.entries(io).map(([key, value]) => [key, Math.round(value)])) })}`);
    };
    if (!data) {
      logTiming(0);
      self.postMessage({ type: 'done', gitInfo, baseRef, baseOid, data: null });
      return;
    }
    const reviewJson = JSON.stringify(data);
    const snapshotHash = review_snapshot_hash(reviewJson);
    logTiming(files.length, performance.now() - processed);
    self.postMessage({ type: 'done', gitInfo, baseRef, baseOid, data: reviewJson, snapshotHash });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};

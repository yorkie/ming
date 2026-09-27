import { loadGlobalSettings } from './globalSettings';
import { language } from './i18n';
import { recordAiUsage, saveReviewTitleIfCurrent, type Project, type ReviewRecord } from './projectStore';
import type { AiRequestUsage, ReviewTitleArtifact } from './aiReviewTypes';
import { aiTaskId, beginAiTask, finishAiTask, updateAiTask } from './aiTasks';

const active = new Map<string, { snapshotHash?: string; worker: Worker }>();

export function generateReviewTitleInBackground(project: Project, review: ReviewRecord): void {
  const settings = loadGlobalSettings();
  const apiKey = settings.copilotDeepSeekApiKey.trim();
  if (!apiKey || review.title) return;
  const previous = active.get(review.id);
  if (previous?.snapshotHash === review.snapshotHash) return;
  if (previous) { previous.worker.terminate(); finishAiTask(aiTaskId('review-title', review.id), 'canceled'); }

  const worker = new Worker(new URL('../workers/aiTaskWorker.ts', import.meta.url), { type: 'module' });
  active.set(review.id, { snapshotHash: review.snapshotHash, worker });
  const taskId = beginAiTask({ kind: 'review-title', projectId: project.id, projectName: project.name,
    reviewId: review.id, detail: language.value === 'zh-CN' ? '正在生成评审标题…' : 'Generating a review title…' });
  const usageWrites: Promise<void>[] = [];
  const finish = async (artifact?: ReviewTitleArtifact, failure?: string) => {
    if (active.get(review.id)?.worker !== worker) return;
    active.delete(review.id);
    worker.terminate();
    await Promise.allSettled(usageWrites);
    if (active.has(review.id)) return;
    if (artifact && await saveReviewTitleIfCurrent(review.id, review.snapshotHash, artifact, review.data)) {
      finishAiTask(taskId, 'done', artifact.title);
      window.dispatchEvent(new CustomEvent('ming:reviews-changed', { detail: { projectId: project.id } }));
    } else finishAiTask(taskId, failure ? 'error' : 'canceled', failure);
  };
  worker.onmessage = (event: MessageEvent<{ type: string; usage?: AiRequestUsage; artifact?: ReviewTitleArtifact; message?: string; completed?: number; total?: number }>) => {
    if (event.data.type === 'usage' && event.data.usage) {
      usageWrites.push(recordAiUsage({ ...event.data.usage, id: crypto.randomUUID(), projectId: project.id,
        projectName: project.name, reviewId: review.id, createdAt: Date.now(), task: 'review-title', provider: 'deepseek' }).catch(() => {}));
    } else if (event.data.type === 'progress') updateAiTask(taskId, { detail: event.data.message ?? '', completed: event.data.completed ?? 0, total: event.data.total ?? 0 });
    else if (event.data.type === 'done') void finish(event.data.artifact);
    else if (event.data.type === 'error') void finish(undefined, event.data.message ?? 'Review title generation failed.');
  };
  worker.onerror = event => { void finish(undefined, event.message || 'Review title worker stopped unexpectedly.'); };
  worker.postMessage({ taskKind: 'review-title', reviewJson: review.data, model: settings.copilotModel,
    apiKey, summaryLanguage: settings.copilotSummaryLanguage, reviewLanguage: settings.copilotReviewLanguage, uiLanguage: language.value });
}

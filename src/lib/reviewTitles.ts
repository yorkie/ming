import { reactive } from 'vue';
import { loadGlobalSettings } from './globalSettings';
import { language } from './i18n';
import { recordAiUsage, saveReviewTitleIfCurrent, type Project, type ReviewRecord } from './projectStore';
import type { AiRequestUsage, ReviewTitleArtifact } from './aiReviewTypes';

const active = new Map<string, { snapshotHash?: string; worker: Worker }>();
export const reviewTitleStatuses = reactive(new Map<string, string>());

export function generateReviewTitleInBackground(project: Project, review: ReviewRecord): void {
  const settings = loadGlobalSettings();
  const apiKey = settings.copilotDeepSeekApiKey.trim();
  if (!apiKey || review.title) return;
  const previous = active.get(review.id);
  if (previous?.snapshotHash === review.snapshotHash) return;
  previous?.worker.terminate();

  const worker = new Worker(new URL('../workers/aiTaskWorker.ts', import.meta.url), { type: 'module' });
  active.set(review.id, { snapshotHash: review.snapshotHash, worker });
  reviewTitleStatuses.set(review.id, project.id);
  const usageWrites: Promise<void>[] = [];
  const finish = async (artifact?: ReviewTitleArtifact) => {
    if (active.get(review.id)?.worker !== worker) return;
    active.delete(review.id);
    reviewTitleStatuses.delete(review.id);
    worker.terminate();
    await Promise.allSettled(usageWrites);
    if (artifact && await saveReviewTitleIfCurrent(review.id, review.snapshotHash, artifact, review.data)) {
      window.dispatchEvent(new CustomEvent('ming:reviews-changed', { detail: { projectId: project.id } }));
    }
  };
  worker.onmessage = (event: MessageEvent<{ type: string; usage?: AiRequestUsage; artifact?: ReviewTitleArtifact }>) => {
    if (event.data.type === 'usage' && event.data.usage) {
      usageWrites.push(recordAiUsage({ ...event.data.usage, id: crypto.randomUUID(), projectId: project.id,
        projectName: project.name, reviewId: review.id, createdAt: Date.now(), task: 'review-title', provider: 'deepseek' }).catch(() => {}));
    } else if (event.data.type === 'done') void finish(event.data.artifact);
    else if (event.data.type === 'error') void finish();
  };
  worker.onerror = () => { void finish(); };
  worker.postMessage({ taskKind: 'review-title', reviewJson: review.data, model: settings.copilotModel,
    apiKey, summaryLanguage: settings.copilotSummaryLanguage, reviewLanguage: settings.copilotReviewLanguage, uiLanguage: language.value });
}

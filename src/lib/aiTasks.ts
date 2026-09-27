import { reactive } from 'vue';
import type { AiActivity } from './aiActivity';

export type AiTaskKind = 'topic-review' | 'request-review' | 'review-title';
export type AiTaskStatus = 'running' | 'done' | 'error' | 'canceled';
export type AiTask = {
  id: string;
  kind: AiTaskKind;
  projectId: string;
  projectName: string;
  reviewId: string;
  status: AiTaskStatus;
  detail: string;
  completed: number;
  total: number;
  activity: AiActivity[];
  startedAt: number;
  finishedAt?: number;
};

export const aiTasks = reactive(new Map<string, AiTask>());
const cancelHandlers = new Map<string, () => void>();

export function aiTaskId(kind: AiTaskKind, reviewId: string) { return `${kind}:${reviewId}`; }
export function isAiTaskRunning(kind: AiTaskKind, reviewId: string) { return aiTasks.get(aiTaskId(kind, reviewId))?.status === 'running'; }
export function beginAiTask(input: Pick<AiTask, 'kind' | 'projectId' | 'projectName' | 'reviewId' | 'detail'>, cancel?: () => void): string {
  const id = aiTaskId(input.kind, input.reviewId);
  const previous = aiTasks.get(id);
  if (previous?.status === 'running') throw new Error('AI task is already running.');
  aiTasks.set(id, { ...input, id, status: 'running', completed: 0, total: 0, activity: [], startedAt: Date.now() });
  if (cancel) cancelHandlers.set(id, cancel);
  else cancelHandlers.delete(id);
  return id;
}
export function updateAiTask(id: string, changes: Partial<Pick<AiTask, 'detail' | 'completed' | 'total' | 'activity'>>) {
  const task = aiTasks.get(id);
  if (task?.status === 'running') aiTasks.set(id, { ...task, ...changes });
}
export function finishAiTask(id: string, status: Exclude<AiTaskStatus, 'running'>, detail?: string) {
  const task = aiTasks.get(id);
  if (!task || task.status !== 'running') return;
  aiTasks.set(id, { ...task, status, detail: detail ?? task.detail, finishedAt: Date.now() });
  cancelHandlers.delete(id);
}
export function cancelAiTask(id: string) { cancelHandlers.get(id)?.(); }
export function dismissAiTask(id: string) {
  if (aiTasks.get(id)?.status === 'running') return;
  aiTasks.delete(id);
  cancelHandlers.delete(id);
}

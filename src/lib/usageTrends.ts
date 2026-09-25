import type { AiUsageRecord } from './projectStore';

const hourMs = 60 * 60 * 1000;

export function hourlyUsage(records: AiUsageRecord[], now: number, hours = 24) {
  const currentHour = Math.floor(now / hourMs) * hourMs;
  const firstHour = currentHour - (hours - 1) * hourMs;
  const buckets = Array.from({ length: hours }, (_, index) => ({
    start: firstHour + index * hourMs,
    prompt: 0,
    completion: 0,
    total: 0,
  }));
  for (const record of records) {
    const index = Math.floor((record.createdAt - firstHour) / hourMs);
    if (index < 0 || index >= hours) continue;
    const bucket = buckets[index]!;
    bucket.prompt += record.promptTokens ?? 0;
    bucket.completion += record.completionTokens ?? 0;
    bucket.total += record.totalTokens ?? 0;
  }
  return buckets;
}

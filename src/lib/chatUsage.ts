export function cachedPromptTokens(usage?: Record<string, unknown>): number | null {
  const details = usage?.prompt_tokens_details;
  const value = usage?.prompt_cache_hit_tokens ?? (details && typeof details === 'object' ? (details as Record<string, unknown>).cached_tokens : undefined);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

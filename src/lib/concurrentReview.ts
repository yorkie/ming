export async function runConcurrentReviews<T>(items: T[], limit: number, review: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  async function consume() {
    while (next < items.length && !failure) {
      const index = next++;
      try { await review(items[index], index); }
      catch (cause) { failure ??= cause; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  if (failure) throw failure;
}

import type { Topic } from './aiReviewTypes';

type Candidate = { oldIndex: number; newIndex: number; score: number };

function normalizedTitle(title: string): string {
  return title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function titleSimilarity(a: string, b: string): number {
  const left = normalizedTitle(a);
  const right = normalizedTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const grams = (value: string) => [...value].slice(0, -1).map((_, index) => [...value].slice(index, index + 2).join(''));
  const first = grams(left);
  const second = grams(right);
  if (!first.length || !second.length) return 0;
  const remaining = new Map<string, number>();
  for (const gram of first) remaining.set(gram, (remaining.get(gram) ?? 0) + 1);
  let common = 0;
  for (const gram of second) {
    const count = remaining.get(gram) ?? 0;
    if (count) { common++; remaining.set(gram, count - 1); }
  }
  return 2 * common / (first.length + second.length);
}

function pathOverlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const common = a.filter(path => b.includes(path)).length;
  return common / Math.min(a.length, b.length);
}

function candidate(old: Topic, oldPaths: string[], current: Topic, currentPaths: string[]): number | null {
  const title = titleSimilarity(old.title, current.title);
  const paths = pathOverlap(oldPaths, currentPaths);
  // A shared file alone cannot establish identity: unrelated changes often touch the same file.
  if (title < 0.52 || (paths === 0 && title < 0.82)) return null;
  if (paths === 0 && title < 1) return null;
  return title + paths * 0.45;
}

/** Match whole topic sets so one changed title cannot consume another topic's identity. */
export function matchTopics(oldTopics: Topic[], oldPaths: string[][], newTopics: Topic[], newPaths: string[][]): Map<number, number> {
  const candidates: Candidate[] = [];
  oldTopics.forEach((old, oldIndex) => newTopics.forEach((current, newIndex) => {
    if (old.id === 'uncategorized' || current.id === 'uncategorized') return;
    const score = candidate(old, oldPaths[oldIndex] ?? [], current, newPaths[newIndex] ?? []);
    if (score !== null) candidates.push({ oldIndex, newIndex, score });
  }));
  candidates.sort((a, b) => b.score - a.score || a.oldIndex - b.oldIndex || a.newIndex - b.newIndex);
  const usedOld = new Set<number>();
  const usedNew = new Set<number>();
  const matches = new Map<number, number>();
  for (const entry of candidates) {
    if (usedOld.has(entry.oldIndex) || usedNew.has(entry.newIndex)) continue;
    const rivalOld = candidates.find(other => other.newIndex === entry.newIndex && other.oldIndex !== entry.oldIndex && !usedOld.has(other.oldIndex));
    const rivalNew = candidates.find(other => other.oldIndex === entry.oldIndex && other.newIndex !== entry.newIndex && !usedNew.has(other.newIndex));
    // Keep ambiguous topics separate; a wrong match would misplace their review history.
    if ((rivalOld && entry.score - rivalOld.score < 0.08) || (rivalNew && entry.score - rivalNew.score < 0.08)) continue;
    matches.set(entry.newIndex, entry.oldIndex);
    usedOld.add(entry.oldIndex);
    usedNew.add(entry.newIndex);
  }
  return matches;
}

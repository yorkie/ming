import type { FileChange, Review } from './reviewTypes';

export function canMergePartialReview(
  expected: { filepaths?: string[]; headOid?: string | null; baseRef?: string; baseOid?: string | null; branch?: string | null; hadReview?: boolean; previousData?: string | null },
  actual: { headOid: string | null; baseRef: string; baseOid: string | null; branch: string | null },
): boolean {
  return !!expected.filepaths?.length && expected.headOid === actual.headOid
    && expected.baseRef === actual.baseRef && expected.baseOid === actual.baseOid && expected.branch === actual.branch
    && (!expected.hadReview || !!expected.previousData);
}

export function mergeScannedReview(previous: Review | null, scanned: FileChange[], filepaths?: string[]): Review | null {
  const affected = (path: string) => filepaths?.some(prefix => path === prefix || path.startsWith(`${prefix}/`)) ?? true;
  const files = filepaths
    ? [...(previous?.files ?? []).filter(file => !affected(file.path)), ...scanned]
    : scanned;
  if (!files.length) return null;
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

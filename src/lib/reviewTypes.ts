import type { MarkdownSnapshot } from './localRepository';

export type Line = { kind: 'add' | 'delete' | 'context'; text: string; oldNumber: number | null; newNumber: number | null };
export type Hunk = { header: string; lines: Line[] };
export type FileChange = { path: string; status: string; additions: number; deletions: number; hunks: Hunk[]; markdown?: MarkdownSnapshot };
export type Review = { files: FileChange[]; additions: number; deletions: number };

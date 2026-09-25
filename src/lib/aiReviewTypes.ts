export type Topic = {
  id: string;
  title: string;
  summary: string;
  checks: string[];
  unitIds: string[];
};

export type TopicArtifact = {
  schemaVersion: 1;
  snapshotHash: string;
  model: string;
  topics: Topic[];
};

export type TopicReview = {
  artifact: TopicArtifact;
  reviewed: Record<string, 'reviewed' | 'needs-work'>;
  createdAt: number;
};

export type AiRequestUsage = {
  model: string;
  group: number;
  attempt: number;
  status: 'success' | 'error';
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedPromptTokens: number | null;
};

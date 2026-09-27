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
export type ReviewTitleArtifact = {
  schemaVersion: 1;
  snapshotHash: string;
  model: string;
  title: string;
};

export type TopicReview = {
  artifact: TopicArtifact;
  reviewed: Record<string, 'reviewed' | 'needs-work'>;
  createdAt: number;
  sourceData?: string;
  comments?: ReviewComment[];
  commentsCreatedAt?: number;
  reviewRunId?: string;
  recommendations?: Record<string, string[]>;
  recommendationSeverities?: Record<string, (ReviewSeverity | null)[]>;
  revisions?: TopicReviewRevision[];
  previousComments?: ReviewComment[];
  priorAssessments?: Record<string, { outcome: 'still-present' | 'possibly-fixed' | 'unclear'; reason: string }>;
  commentDecisions?: Record<string, 'resolved' | 'open'>;
};

export type TopicReviewRevision = {
  artifact: TopicArtifact;
  sourceData?: string;
  reviewed: Record<string, 'reviewed' | 'needs-work'>;
  comments?: ReviewComment[];
  recommendations?: Record<string, string[]>;
  commentDecisions?: Record<string, 'resolved' | 'open'>;
  createdAt: number;
};

export type ReviewSeverity = 'high' | 'medium' | 'low';

export type ReviewComment = {
  id: string;
  topicId: string;
  fileIndex: number;
  hunkIndex: number;
  side: 'LEFT' | 'RIGHT';
  lineNumber: number;
  body: string;
  severity?: ReviewSeverity;
  suggestion?: string | null;
};

export type ReviewCommentArtifact = {
  schemaVersion: 1;
  snapshotHash: string;
  model: string;
  comments: ReviewComment[];
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

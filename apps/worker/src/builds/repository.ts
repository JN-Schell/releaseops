export const buildStatuses = ["queued", "in_progress", "success", "failure", "cancelled"] as const;

export type BuildStatus = (typeof buildStatuses)[number];

export interface BuildRecord {
  projectId: string;
  githubRunId: string;
  commitSha: string;
  branch: string;
  commitMessage: string | null;
  author: string | null;
  status: BuildStatus;
  conclusion: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  url: string | null;
}

export interface StoredDelivery {
  id: string;
  event: string;
  projectId: string;
  payload: unknown;
  status: "received" | "processed" | "failed";
  error: string | null;
}

export interface BuildRepository {
  findDelivery(id: string): Promise<StoredDelivery | null>;
  upsertBuild(build: BuildRecord): Promise<void>;
  markProcessed(id: string, processedAt: Date): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

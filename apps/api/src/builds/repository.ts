import type { BuildStatus } from "@releaseops/shared";

export interface BuildCursor {
  createdAt: Date;
  id: string;
}

export interface BuildListFilter {
  projectId: string;
  branch?: string;
  status?: BuildStatus;
  from?: Date;
  to?: Date;
  cursor?: BuildCursor;
  limit: number;
}

export interface StoredBuildDeployment {
  id: string;
  status: string;
  environmentName: string;
  createdAt: Date;
}

export interface StoredBuild {
  id: string;
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
  createdAt: Date;
  project: { id: string; name: string; slug: string };
  deployments: StoredBuildDeployment[];
}

export interface BuildRepository {
  projectExists(id: string): Promise<boolean>;
  listBuilds(filter: BuildListFilter): Promise<StoredBuild[]>;
  findBuild(id: string): Promise<StoredBuild | null>;
}

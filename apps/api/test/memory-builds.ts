import type { BuildStatus } from "@releaseops/shared";
import type {
  BuildListFilter,
  BuildRepository,
  StoredBuild,
  StoredBuildDeployment,
} from "../src/builds/repository.js";

export interface MemoryBuildRepository extends BuildRepository {
  allowProject(id: string, project?: { name: string; slug: string }): void;
  addBuild(build: StoredBuild): void;
}

export function createMemoryBuildRepository(): MemoryBuildRepository {
  const projects = new Map<string, { id: string; name: string; slug: string }>();
  const builds: StoredBuild[] = [];

  return {
    allowProject(id, project) {
      projects.set(id, {
        id,
        name: project?.name ?? "Payments",
        slug: project?.slug ?? "payments",
      });
    },
    addBuild(build) {
      builds.push(build);
    },
    async projectExists(id) {
      return projects.has(id);
    },
    async listBuilds(filter) {
      return builds
        .filter((build) => matches(build, filter))
        .sort(compareBuilds)
        .slice(0, filter.limit);
    },
    async findBuild(id) {
      return builds.find((build) => build.id === id) ?? null;
    },
  };
}

function matches(build: StoredBuild, filter: BuildListFilter): boolean {
  if (build.projectId !== filter.projectId) return false;
  if (filter.branch && build.branch !== filter.branch) return false;
  if (filter.status && build.status !== filter.status) return false;
  if (filter.from && build.createdAt < filter.from) return false;
  if (filter.to && build.createdAt > filter.to) return false;
  if (!filter.cursor) return true;
  if (build.createdAt < filter.cursor.createdAt) return true;
  return (
    build.createdAt.getTime() === filter.cursor.createdAt.getTime() && build.id < filter.cursor.id
  );
}

function compareBuilds(left: StoredBuild, right: StoredBuild): number {
  const byTime = right.createdAt.getTime() - left.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
}

export function sampleBuild(input: {
  id: string;
  projectId: string;
  createdAt: string;
  branch?: string;
  status?: BuildStatus;
  deployments?: StoredBuildDeployment[];
}): StoredBuild {
  return {
    id: input.id,
    projectId: input.projectId,
    githubRunId: input.id,
    commitSha: "abc123def456",
    branch: input.branch ?? "main",
    commitMessage: "Ship payments",
    author: "Ada Lovelace",
    status: input.status ?? "success",
    conclusion: input.status === "failure" ? "failure" : "success",
    startedAt: new Date("2026-06-01T00:00:00.000Z"),
    finishedAt: new Date("2026-06-01T00:01:00.000Z"),
    durationMs: 60_000,
    url: "https://github.com/octo/payments/actions/runs/1",
    createdAt: new Date(input.createdAt),
    project: { id: input.projectId, name: "Payments", slug: "payments" },
    deployments: input.deployments ?? [],
  };
}

import type { BuildDetail, BuildListQuery, BuildSummary } from "@releaseops/shared";
import { AppError } from "../plugins/errors.js";
import type { BuildCursor, BuildRepository, StoredBuild } from "./repository.js";

export interface BuildService {
  list(
    projectId: string,
    query: BuildListQuery,
  ): Promise<{ data: BuildSummary[]; nextCursor: string | null }>;
  get(id: string): Promise<BuildDetail>;
}

export function createBuildService(repository: BuildRepository): BuildService {
  return {
    async list(projectId, query) {
      if (!(await repository.projectExists(projectId))) {
        throw new AppError(404, "NOT_FOUND", "Project not found.");
      }
      const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
      const rows = await repository.listBuilds({
        projectId,
        branch: query.branch,
        status: query.status,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        cursor,
        limit: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > query.limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return { data: page.map(summary), nextCursor };
    },
    async get(id) {
      const build = await repository.findBuild(id);
      if (!build) throw new AppError(404, "NOT_FOUND", "Build not found.");
      return detail(build);
    },
  };
}

function summary(build: StoredBuild): BuildSummary {
  return {
    id: build.id,
    projectId: build.projectId,
    githubRunId: build.githubRunId,
    commitSha: build.commitSha,
    branch: build.branch,
    commitMessage: build.commitMessage,
    author: build.author,
    status: build.status,
    conclusion: build.conclusion,
    startedAt: build.startedAt?.toISOString() ?? null,
    finishedAt: build.finishedAt?.toISOString() ?? null,
    durationMs: build.durationMs,
    url: build.url,
    createdAt: build.createdAt.toISOString(),
  };
}

function detail(build: StoredBuild): BuildDetail {
  return {
    ...summary(build),
    project: build.project,
    deployments: build.deployments.map((deployment) => ({
      id: deployment.id,
      status: deployment.status as BuildDetail["deployments"][number]["status"],
      environmentName: deployment.environmentName,
      createdAt: deployment.createdAt.toISOString(),
    })),
  };
}

export function encodeCursor(cursor: BuildCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}\n${cursor.id}`).toString("base64url");
}

export function decodeCursor(value: string): BuildCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new AppError(400, "INVALID_CURSOR", "That page cursor is not valid.");
  }
  const [createdAt, id] = decoded.split("\n");
  const parsed = createdAt ? new Date(createdAt) : new Date(Number.NaN);
  if (
    !id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== createdAt
  ) {
    throw new AppError(400, "INVALID_CURSOR", "That page cursor is not valid.");
  }
  return { createdAt: parsed, id };
}

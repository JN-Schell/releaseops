import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { BuildStatus } from "@releaseops/shared";
import type {
  BuildListFilter,
  BuildRepository,
  StoredBuild,
  StoredBuildDeployment,
} from "./repository.js";

const buildInclude = {
  project: { select: { id: true, name: true, slug: true } },
  deployments: {
    orderBy: { createdAt: "desc" as const },
    include: { environment: { select: { name: true } } },
  },
} satisfies Prisma.BuildInclude;

type BuildRow = Prisma.BuildGetPayload<{ include: typeof buildInclude }>;

export class PrismaBuildRepository implements BuildRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async projectExists(id: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    return project !== null;
  }

  async listBuilds(filter: BuildListFilter): Promise<StoredBuild[]> {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filter.from) createdAt.gte = filter.from;
    if (filter.to) createdAt.lte = filter.to;
    const rows = await this.prisma.build.findMany({
      where: {
        projectId: filter.projectId,
        ...(filter.branch ? { branch: filter.branch } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to ? { createdAt } : {}),
        ...(filter.cursor
          ? {
              OR: [
                { createdAt: { lt: filter.cursor.createdAt } },
                { createdAt: filter.cursor.createdAt, id: { lt: filter.cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: filter.limit,
      include: buildInclude,
    });
    return rows.map(toBuild);
  }

  async findBuild(id: string): Promise<StoredBuild | null> {
    const row = await this.prisma.build.findUnique({ where: { id }, include: buildInclude });
    return row ? toBuild(row) : null;
  }
}

function toBuild(row: BuildRow): StoredBuild {
  return {
    id: row.id,
    projectId: row.projectId,
    githubRunId: row.githubRunId,
    commitSha: row.commitSha,
    branch: row.branch,
    commitMessage: row.commitMessage,
    author: row.author,
    status: row.status as BuildStatus,
    conclusion: row.conclusion,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    url: row.url,
    createdAt: row.createdAt,
    project: row.project,
    deployments: row.deployments.map(toDeployment),
  };
}

function toDeployment(row: BuildRow["deployments"][number]): StoredBuildDeployment {
  return {
    id: row.id,
    status: row.status,
    environmentName: row.environment.name,
    createdAt: row.createdAt,
  };
}

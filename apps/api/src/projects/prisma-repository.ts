import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { DuplicateRecordError, type AuditWrite } from "../auth/repository.js";
import type {
  EnvironmentPatch,
  ProjectPatch,
  ProjectRecord,
  ProjectRepository,
  StoredEnvironment,
  StoredProject,
} from "./repository.js";

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  webhookSecretEnc: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  environments: EnvironmentRow[];
};

type EnvironmentRow = {
  id: string;
  projectId: string;
  name: string;
  order: number;
  requiresApproval: boolean;
  requiredApprovals: number;
  deployWorkflowFile: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function duplicateField(error: unknown): never {
  if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
    const meta = "meta" in error ? error.meta : undefined;
    const target =
      meta && typeof meta === "object" && meta !== null && "target" in meta ? meta.target : "";
    const text = (Array.isArray(target) ? target.join(" ") : String(target)).toLowerCase();
    if (text.includes("slug")) throw new DuplicateRecordError("slug");
    if (text.includes("github")) throw new DuplicateRecordError("github");
    if (text.includes("order")) throw new DuplicateRecordError("order");
    if (text.includes("name")) throw new DuplicateRecordError("name");
    throw new DuplicateRecordError("record");
  }
  throw error;
}

function jsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  if (value == null) return undefined;
  return value as Prisma.InputJsonValue;
}

function toEnvironment(row: EnvironmentRow): StoredEnvironment {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    order: row.order,
    requiresApproval: row.requiresApproval,
    requiredApprovals: row.requiredApprovals,
    deployWorkflowFile: row.deployWorkflowFile,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecord(row: ProjectRow): ProjectRecord {
  return {
    project: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      githubOwner: row.githubOwner,
      githubRepo: row.githubRepo,
      defaultBranch: row.defaultBranch,
      // Encryption of this column is the open hardening issue. The value is omitted from audits.
      webhookSecret: row.webhookSecretEnc ?? "",
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    environments: row.environments
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(toEnvironment),
  };
}

const includeEnvironments = { environments: { orderBy: { order: "asc" as const } } };

export class PrismaProjectRepository implements ProjectRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly inTransaction = false,
  ) {}

  async listProjects() {
    const rows = await this.db.project.findMany({
      orderBy: { name: "asc" },
      include: includeEnvironments,
    });
    return rows.map((row) => toRecord(row));
  }

  async findProjectById(id: string) {
    const row = await this.db.project.findUnique({ where: { id }, include: includeEnvironments });
    return row ? toRecord(row) : null;
  }

  async findProjectBySlug(slug: string) {
    const row = await this.db.project.findUnique({
      where: { slug },
      include: includeEnvironments,
    });
    return row ? toRecord(row) : null;
  }

  async insertProject(project: StoredProject, environments: StoredEnvironment[]) {
    try {
      await this.db.project.create({
        data: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          description: project.description,
          githubOwner: project.githubOwner,
          githubRepo: project.githubRepo,
          defaultBranch: project.defaultBranch,
          webhookSecretEnc: project.webhookSecret,
          createdById: project.createdById,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          environments: {
            create: environments.map((environment) => ({
              id: environment.id,
              name: environment.name,
              order: environment.order,
              requiresApproval: environment.requiresApproval,
              requiredApprovals: environment.requiredApprovals,
              deployWorkflowFile: environment.deployWorkflowFile,
              createdAt: environment.createdAt,
              updatedAt: environment.updatedAt,
            })),
          },
        },
      });
    } catch (error) {
      duplicateField(error);
    }
  }

  async updateProject(id: string, patch: ProjectPatch) {
    try {
      const row = await this.db.project.update({
        where: { id },
        data: {
          name: patch.name,
          description: patch.description,
          defaultBranch: patch.defaultBranch,
        },
        include: includeEnvironments,
      });
      return toRecord(row).project;
    } catch (error) {
      duplicateField(error);
    }
  }

  async deleteProject(id: string) {
    await this.db.project.delete({ where: { id } });
  }

  async insertEnvironment(environment: StoredEnvironment) {
    try {
      await this.db.environment.create({
        data: {
          id: environment.id,
          projectId: environment.projectId,
          name: environment.name,
          order: environment.order,
          requiresApproval: environment.requiresApproval,
          requiredApprovals: environment.requiredApprovals,
          deployWorkflowFile: environment.deployWorkflowFile,
          createdAt: environment.createdAt,
          updatedAt: environment.updatedAt,
        },
      });
    } catch (error) {
      duplicateField(error);
    }
  }

  async updateEnvironment(id: string, patch: EnvironmentPatch) {
    try {
      const row = await this.db.environment.update({
        where: { id },
        data: {
          name: patch.name,
          order: patch.order,
          requiresApproval: patch.requiresApproval,
          requiredApprovals: patch.requiredApprovals,
          deployWorkflowFile: patch.deployWorkflowFile,
        },
      });
      return toEnvironment(row);
    } catch (error) {
      duplicateField(error);
    }
  }

  async deleteEnvironment(id: string) {
    await this.db.environment.delete({ where: { id } });
  }

  async insertAudit(event: AuditWrite) {
    await this.db.auditLog.create({
      data: {
        actorId: event.actorId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId ?? null,
        before: event.before == null ? undefined : jsonValue(event.before),
        after: event.after == null ? undefined : jsonValue(event.after),
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
      },
    });
  }

  async transaction<T>(run: (repository: ProjectRepository) => Promise<T>): Promise<T> {
    if (this.inTransaction) return run(this);
    return this.db.$transaction((tx) => run(new PrismaProjectRepository(tx as PrismaClient, true)));
  }
}

import { randomBytes, randomUUID } from "node:crypto";
import type {
  CreateProjectBody,
  EnvironmentBody,
  UpdateEnvironmentBody,
  UpdateProjectBody,
} from "@releaseops/shared";
import { DuplicateRecordError, type AuditWrite } from "../auth/repository.js";
import type { RequestMeta } from "../auth/service.js";
import { AppError } from "../plugins/errors.js";
import type {
  ProjectRecord,
  ProjectRepository,
  StoredEnvironment,
  StoredProject,
} from "./repository.js";

export const WEBHOOK_PAYLOAD_PATH = "/api/v1/webhooks/github";

function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function blankToNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertDistinctEnvironments(environments: EnvironmentBody[]) {
  const names = new Set<string>();
  const orders = new Set<number>();
  for (const environment of environments) {
    if (names.has(environment.name) || orders.has(environment.order)) {
      throw new AppError(400, "VALIDATION_ERROR", "Environment names and orders must be unique.");
    }
    names.add(environment.name);
    orders.add(environment.order);
  }
}

function duplicateError(field: string): AppError {
  if (field === "slug") {
    return new AppError(409, "SLUG_IN_USE", "A project already uses that name.");
  }
  if (field === "github") {
    return new AppError(409, "REPO_LINKED", "That GitHub repository is already linked.");
  }
  if (field === "name") {
    return new AppError(409, "ENVIRONMENT_EXISTS", "That environment name is already used.");
  }
  if (field === "order") {
    return new AppError(409, "ENVIRONMENT_ORDER", "That environment order is already used.");
  }
  return new AppError(409, "CONFLICT", "That record already exists.");
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DuplicateRecordError) throw duplicateError(error.field);
    throw error;
  }
}

function auditProject(project: StoredProject): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    description: project.description,
    githubOwner: project.githubOwner,
    githubRepo: project.githubRepo,
    defaultBranch: project.defaultBranch,
  };
}

function auditEnvironment(environment: StoredEnvironment): Record<string, unknown> {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    order: environment.order,
    requiresApproval: environment.requiresApproval,
    requiredApprovals: environment.requiredApprovals,
    deployWorkflowFile: environment.deployWorkflowFile,
  };
}

function publicEnvironment(environment: StoredEnvironment) {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    order: environment.order,
    requiresApproval: environment.requiresApproval,
    requiredApprovals: environment.requiredApprovals,
    deployWorkflowFile: environment.deployWorkflowFile,
  };
}

function publicProject(record: ProjectRecord, includeSecret: boolean) {
  return {
    id: record.project.id,
    name: record.project.name,
    slug: record.project.slug,
    description: record.project.description,
    githubOwner: record.project.githubOwner,
    githubRepo: record.project.githubRepo,
    defaultBranch: record.project.defaultBranch,
    createdAt: record.project.createdAt.toISOString(),
    updatedAt: record.project.updatedAt.toISOString(),
    environments: record.environments.map(publicEnvironment),
    ...(includeSecret ? { webhookSecret: record.project.webhookSecret } : {}),
  };
}

function webhookInstructions(secret: string): string {
  return [
    "Add a webhook on the GitHub repository.",
    `Payload URL: https://<releaseops-host>${WEBHOOK_PAYLOAD_PATH}`,
    "Content type: application/json",
    `Secret: ${secret}`,
    "Events: workflow_run, push, and deployment_status.",
    "ReleaseOps checks X-Hub-Signature-256 and stores each delivery once.",
  ].join("\n");
}

function storedEnvironment(projectId: string, body: EnvironmentBody, now: Date): StoredEnvironment {
  return {
    id: randomUUID(),
    projectId,
    name: body.name,
    order: body.order,
    requiresApproval: body.requiresApproval,
    requiredApprovals: body.requiredApprovals,
    deployWorkflowFile: blankToNull(body.deployWorkflowFile) ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createProjectService(repository: ProjectRepository) {
  return {
    async list() {
      const records = await repository.listProjects();
      return records.map((record) => publicProject(record, false));
    },

    async getById(id: string, includeSecret: boolean) {
      const record = await repository.findProjectById(id);
      if (!record) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
      return publicProject(record, includeSecret);
    },

    async getBySlug(slug: string, includeSecret: boolean) {
      const record = await repository.findProjectBySlug(slug);
      if (!record) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
      return publicProject(record, includeSecret);
    },

    async create(actorId: string, body: CreateProjectBody, meta: RequestMeta) {
      const slug = slugFromName(body.name);
      if (!slug || slug === "new") {
        throw new AppError(400, "INVALID_NAME", "Use a name that contains a letter or number.");
      }
      const environments = body.environments ?? [];
      assertDistinctEnvironments(environments);
      const now = new Date();
      const secret = randomBytes(32).toString("base64url");
      const project: StoredProject = {
        id: randomUUID(),
        name: body.name,
        slug,
        description: blankToNull(body.description) ?? null,
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        defaultBranch: body.defaultBranch,
        webhookSecret: secret,
        createdById: actorId,
        createdAt: now,
        updatedAt: now,
      };
      const storedEnvironments = environments.map((environment) =>
        storedEnvironment(project.id, environment, now),
      );

      const record = await run(() =>
        repository.transaction(async (tx) => {
          await tx.insertProject(project, storedEnvironments);
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "project.created",
              "project",
              project.id,
              null,
              auditProject(project),
            ),
          );
          for (const environment of storedEnvironments) {
            await tx.insertAudit(
              audit(
                meta,
                actorId,
                "environment.created",
                "environment",
                environment.id,
                null,
                auditEnvironment(environment),
              ),
            );
          }
          const saved = await tx.findProjectById(project.id);
          if (!saved) throw new AppError(500, "INTERNAL_ERROR", "Project was not saved.");
          return saved;
        }),
      );

      return {
        project: publicProject(record, true),
        webhook: {
          secret,
          payloadPath: WEBHOOK_PAYLOAD_PATH,
          instructions: webhookInstructions(secret),
        },
      };
    },

    async update(actorId: string, id: string, body: UpdateProjectBody, meta: RequestMeta) {
      return run(() =>
        repository.transaction(async (tx) => {
          const current = await tx.findProjectById(id);
          if (!current) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
          const updated = await tx.updateProject(id, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined
              ? { description: blankToNull(body.description) ?? null }
              : {}),
            ...(body.defaultBranch !== undefined ? { defaultBranch: body.defaultBranch } : {}),
          });
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "project.updated",
              "project",
              id,
              auditProject(current.project),
              auditProject(updated),
            ),
          );
          const saved = await tx.findProjectById(id);
          if (!saved) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
          return publicProject(saved, true);
        }),
      );
    },

    async remove(actorId: string, id: string, meta: RequestMeta) {
      await run(() =>
        repository.transaction(async (tx) => {
          const current = await tx.findProjectById(id);
          if (!current) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "project.deleted",
              "project",
              id,
              auditProject(current.project),
              null,
            ),
          );
          await tx.deleteProject(id);
        }),
      );
    },

    async addEnvironment(
      actorId: string,
      projectId: string,
      body: EnvironmentBody,
      meta: RequestMeta,
    ) {
      return run(() =>
        repository.transaction(async (tx) => {
          const project = await tx.findProjectById(projectId);
          if (!project) throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
          const environment = storedEnvironment(projectId, body, new Date());
          await tx.insertEnvironment(environment);
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "environment.created",
              "environment",
              environment.id,
              null,
              auditEnvironment(environment),
            ),
          );
          return publicEnvironment(environment);
        }),
      );
    },

    async updateEnvironment(
      actorId: string,
      id: string,
      body: UpdateEnvironmentBody,
      meta: RequestMeta,
    ) {
      return run(() =>
        repository.transaction(async (tx) => {
          const records = await tx.listProjects();
          const current = records
            .flatMap((record) => record.environments)
            .find((environment) => environment.id === id);
          if (!current) throw new AppError(404, "ENVIRONMENT_NOT_FOUND", "Environment not found.");
          const updated = await tx.updateEnvironment(id, {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.order !== undefined ? { order: body.order } : {}),
            ...(body.requiresApproval !== undefined
              ? { requiresApproval: body.requiresApproval }
              : {}),
            ...(body.requiredApprovals !== undefined
              ? { requiredApprovals: body.requiredApprovals }
              : {}),
            ...(body.deployWorkflowFile !== undefined
              ? { deployWorkflowFile: blankToNull(body.deployWorkflowFile) ?? null }
              : {}),
          });
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "environment.updated",
              "environment",
              id,
              auditEnvironment(current),
              auditEnvironment(updated),
            ),
          );
          return publicEnvironment(updated);
        }),
      );
    },

    async removeEnvironment(actorId: string, id: string, meta: RequestMeta) {
      await run(() =>
        repository.transaction(async (tx) => {
          const records = await tx.listProjects();
          const current = records
            .flatMap((record) => record.environments)
            .find((environment) => environment.id === id);
          if (!current) throw new AppError(404, "ENVIRONMENT_NOT_FOUND", "Environment not found.");
          await tx.insertAudit(
            audit(
              meta,
              actorId,
              "environment.deleted",
              "environment",
              id,
              auditEnvironment(current),
              null,
            ),
          );
          await tx.deleteEnvironment(id);
        }),
      );
    },
  };
}

function audit(
  meta: RequestMeta,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditWrite {
  return {
    actorId,
    action,
    entityType,
    entityId,
    before,
    after,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

export type ProjectService = ReturnType<typeof createProjectService>;

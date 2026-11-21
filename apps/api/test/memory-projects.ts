import { DuplicateRecordError, type AuditWrite } from "../src/auth/repository.js";
import type {
  EnvironmentPatch,
  ProjectPatch,
  ProjectRecord,
  ProjectRepository,
  StoredEnvironment,
  StoredProject,
} from "../src/projects/repository.js";

interface MemoryState {
  projects: StoredProject[];
  environments: StoredEnvironment[];
  audits: AuditWrite[];
}

export interface MemoryProjectRepository extends ProjectRepository {
  readonly audits: AuditWrite[];
  failNextAudit(action: string): void;
}

function recordOf(state: MemoryState, project: StoredProject): ProjectRecord {
  return {
    project: structuredClone(project),
    environments: state.environments
      .filter((environment) => environment.projectId === project.id)
      .slice()
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
      .map((environment) => structuredClone(environment)),
  };
}

function assertProjectAvailable(state: MemoryState, project: StoredProject) {
  if (state.projects.some((existing) => existing.slug === project.slug)) {
    throw new DuplicateRecordError("slug");
  }
  if (
    state.projects.some(
      (existing) =>
        existing.githubOwner === project.githubOwner && existing.githubRepo === project.githubRepo,
    )
  ) {
    throw new DuplicateRecordError("github");
  }
}

function assertEnvironmentAvailable(
  state: MemoryState,
  environment: { projectId: string; name: string; order: number },
  ignoreId?: string,
) {
  const siblings = state.environments.filter(
    (existing) => existing.projectId === environment.projectId && existing.id !== ignoreId,
  );
  if (siblings.some((existing) => existing.name === environment.name)) {
    throw new DuplicateRecordError("name");
  }
  if (siblings.some((existing) => existing.order === environment.order)) {
    throw new DuplicateRecordError("order");
  }
}

export function createMemoryProjectRepository(): MemoryProjectRepository {
  const state: MemoryState = { projects: [], environments: [], audits: [] };
  let failAuditAction: string | null = null;
  let depth = 0;
  let queue: Promise<unknown> = Promise.resolve();

  const repository: MemoryProjectRepository = {
    get audits() {
      return state.audits;
    },
    failNextAudit(action) {
      failAuditAction = action;
    },
    async listProjects() {
      return state.projects
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((project) => recordOf(state, project));
    },
    async findProjectById(id) {
      const project = state.projects.find((item) => item.id === id);
      return project ? recordOf(state, project) : null;
    },
    async findProjectBySlug(slug) {
      const project = state.projects.find((item) => item.slug === slug);
      return project ? recordOf(state, project) : null;
    },
    async insertProject(project, environments) {
      assertProjectAvailable(state, project);
      for (const environment of environments) assertEnvironmentAvailable(state, environment);
      state.projects.push(structuredClone(project));
      state.environments.push(...environments.map((environment) => structuredClone(environment)));
    },
    async updateProject(id, patch: ProjectPatch) {
      const index = state.projects.findIndex((project) => project.id === id);
      const current = state.projects[index];
      if (!current) throw new Error(`Project ${id} was not found`);
      const updated = { ...current, ...patch, updatedAt: new Date() };
      state.projects[index] = updated;
      return structuredClone(updated);
    },
    async deleteProject(id) {
      state.projects = state.projects.filter((project) => project.id !== id);
      state.environments = state.environments.filter((environment) => environment.projectId !== id);
    },
    async insertEnvironment(environment) {
      assertEnvironmentAvailable(state, environment);
      state.environments.push(structuredClone(environment));
    },
    async updateEnvironment(id, patch: EnvironmentPatch) {
      const index = state.environments.findIndex((environment) => environment.id === id);
      const current = state.environments[index];
      if (!current) throw new Error(`Environment ${id} was not found`);
      const updated = { ...current, ...patch, updatedAt: new Date() };
      assertEnvironmentAvailable(state, updated, id);
      state.environments[index] = updated;
      return structuredClone(updated);
    },
    async deleteEnvironment(id) {
      state.environments = state.environments.filter((environment) => environment.id !== id);
    },
    async insertAudit(event) {
      if (failAuditAction === event.action) {
        failAuditAction = null;
        throw new Error(`audit failed: ${event.action}`);
      }
      state.audits.push(structuredClone(event));
    },
    async transaction(run) {
      if (depth > 0) return run(repository);
      const job = queue.then(async () => {
        const saved = structuredClone(state);
        depth += 1;
        try {
          return await run(repository);
        } catch (error) {
          state.projects = saved.projects;
          state.environments = saved.environments;
          state.audits = saved.audits;
          throw error;
        } finally {
          depth -= 1;
        }
      });
      queue = job.then(
        () => undefined,
        () => undefined,
      );
      return job;
    },
  };

  return repository;
}

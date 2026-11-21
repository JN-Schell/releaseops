import type { AuditWrite } from "../auth/repository.js";

export interface StoredProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  githubOwner: string;
  githubRepo: string;
  defaultBranch: string;
  webhookSecret: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredEnvironment {
  id: string;
  projectId: string;
  name: string;
  order: number;
  requiresApproval: boolean;
  requiredApprovals: number;
  deployWorkflowFile: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectRecord {
  project: StoredProject;
  environments: StoredEnvironment[];
}

export interface ProjectPatch {
  name?: string;
  description?: string | null;
  defaultBranch?: string;
}

export interface EnvironmentPatch {
  name?: string;
  order?: number;
  requiresApproval?: boolean;
  requiredApprovals?: number;
  deployWorkflowFile?: string | null;
}

export interface ProjectRepository {
  listProjects(): Promise<ProjectRecord[]>;
  findProjectById(id: string): Promise<ProjectRecord | null>;
  findProjectBySlug(slug: string): Promise<ProjectRecord | null>;
  insertProject(project: StoredProject, environments: StoredEnvironment[]): Promise<void>;
  updateProject(id: string, patch: ProjectPatch): Promise<StoredProject>;
  deleteProject(id: string): Promise<void>;
  insertEnvironment(environment: StoredEnvironment): Promise<void>;
  updateEnvironment(id: string, patch: EnvironmentPatch): Promise<StoredEnvironment>;
  deleteEnvironment(id: string): Promise<void>;
  insertAudit(event: AuditWrite): Promise<void>;
  transaction<T>(run: (repository: ProjectRepository) => Promise<T>): Promise<T>;
}

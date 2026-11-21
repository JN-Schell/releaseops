import { z } from "zod";

const githubOwnerSchema = z
  .string()
  .trim()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/)
  .transform((value) => value.toLowerCase());

const githubRepoSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/)
  .transform((value) => value.toLowerCase());

export const environmentBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  order: z.number().int().min(0).max(100),
  requiresApproval: z.boolean().default(false),
  requiredApprovals: z.number().int().min(1).max(10).default(1),
  deployWorkflowFile: z.string().trim().min(1).max(200).nullable().optional(),
});

export const createProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional(),
  githubOwner: githubOwnerSchema,
  githubRepo: githubRepoSchema,
  defaultBranch: z.string().trim().min(1).max(255).default("main"),
  environments: z.array(environmentBodySchema).max(20).optional(),
});

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    defaultBranch: z.string().trim().min(1).max(255).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.defaultBranch !== undefined,
    { message: "Provide a name, description, or branch" },
  );

export const updateEnvironmentBodySchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    order: z.number().int().min(0).max(100).optional(),
    requiresApproval: z.boolean().optional(),
    requiredApprovals: z.number().int().min(1).max(10).optional(),
    deployWorkflowFile: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.order !== undefined ||
      value.requiresApproval !== undefined ||
      value.requiredApprovals !== undefined ||
      value.deployWorkflowFile !== undefined,
    { message: "Provide a field to change" },
  );

export const environmentSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  order: z.number().int(),
  requiresApproval: z.boolean(),
  requiredApprovals: z.number().int(),
  deployWorkflowFile: z.string().nullable(),
});

export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  githubOwner: z.string(),
  githubRepo: z.string(),
  defaultBranch: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  environments: z.array(environmentSchema),
  webhookSecret: z.string().optional(),
});

export const projectListResponseSchema = z.object({
  data: z.array(projectSchema),
});

export const projectResponseSchema = z.object({
  project: projectSchema,
});

export const createProjectResponseSchema = z.object({
  project: projectSchema,
  webhook: z.object({
    secret: z.string(),
    payloadPath: z.string(),
    instructions: z.string(),
  }),
});

export const environmentResponseSchema = z.object({
  environment: environmentSchema,
});

export type EnvironmentBody = z.infer<typeof environmentBodySchema>;
export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;
export type UpdateEnvironmentBody = z.infer<typeof updateEnvironmentBodySchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type Project = z.infer<typeof projectSchema>;

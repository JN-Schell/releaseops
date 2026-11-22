import { z } from "zod";

export const buildStatuses = ["queued", "in_progress", "success", "failure", "cancelled"] as const;

export const deploymentStatuses = [
  "pending_approval",
  "approved",
  "in_progress",
  "succeeded",
  "failed",
  "rejected",
  "cancelled",
] as const;

const instant = z.string().refine((value) => {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}, "Use an ISO-8601 timestamp.");

function emptyAsUndefined(value: unknown): unknown {
  if (value === "" || value === null) return undefined;
  return value;
}

export const buildListQuerySchema = z
  .object({
    branch: z.preprocess(emptyAsUndefined, z.string().trim().min(1).max(255).optional()),
    status: z.preprocess(emptyAsUndefined, z.enum(buildStatuses).optional()),
    from: z.preprocess(emptyAsUndefined, instant.optional()),
    to: z.preprocess(emptyAsUndefined, instant.optional()),
    cursor: z.preprocess(emptyAsUndefined, z.string().trim().min(1).max(300).optional()),
    limit: z.preprocess(emptyAsUndefined, z.coerce.number().int().min(1).max(100).default(20)),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "The end of the range is before the start.",
  });

const buildSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  githubRunId: z.string(),
  commitSha: z.string(),
  branch: z.string(),
  commitMessage: z.string().nullable(),
  author: z.string().nullable(),
  status: z.enum(buildStatuses),
  conclusion: z.string().nullable(),
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
  durationMs: z.number().int().nullable(),
  url: z.string().nullable(),
  createdAt: instant,
});

const buildDeploymentSchema = z.object({
  id: z.uuid(),
  status: z.enum(deploymentStatuses),
  environmentName: z.string(),
  createdAt: instant,
});

export const buildSchema = buildSummarySchema.extend({
  deployments: z.array(buildDeploymentSchema),
  project: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  }),
});

export const buildListResponseSchema = z.object({
  data: z.array(buildSummarySchema),
  nextCursor: z.string().nullable(),
});

export const buildResponseSchema = z.object({
  build: buildSchema,
});

export type BuildListQuery = z.infer<typeof buildListQuerySchema>;
export type BuildSummary = z.infer<typeof buildSummarySchema>;
export type BuildDetail = z.infer<typeof buildSchema>;
export type BuildStatus = (typeof buildStatuses)[number];

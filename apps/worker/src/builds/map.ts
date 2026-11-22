import type { BuildRecord, BuildStatus } from "./repository.js";

const INT32_MAX = 2_147_483_647;

export function mapWorkflowRun(payload: unknown, projectId: string): BuildRecord {
  const run = readRun(payload);
  const status = mapStatus(run.status, run.conclusion);
  const startedAt = parseTime(run.startedAt);
  const finishedAt =
    status === "queued" || status === "in_progress" ? null : parseTime(run.finishedAt);
  return {
    projectId,
    githubRunId: String(run.id),
    commitSha: run.commitSha,
    branch: run.branch,
    commitMessage: run.commitMessage,
    author: run.author,
    status,
    conclusion: run.conclusion,
    startedAt,
    finishedAt,
    durationMs: duration(startedAt, finishedAt),
    url: run.url,
  };
}

interface WorkflowRunFields {
  id: number | string;
  commitSha: string;
  branch: string;
  commitMessage: string | null;
  author: string | null;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  url: string | null;
}

function readRun(payload: unknown): WorkflowRunFields {
  if (!payload || typeof payload !== "object") {
    throw new Error("workflow_run payload is missing.");
  }
  const body = payload as {
    action?: unknown;
    workflow_run?: unknown;
  };
  const run = body.workflow_run;
  if (!run || typeof run !== "object") {
    throw new Error("workflow_run payload is missing.");
  }
  const record = run as Record<string, unknown>;
  const id = record.id;
  if (typeof id !== "number" && typeof id !== "string") {
    throw new Error("workflow_run id is missing.");
  }
  const commitSha = stringField(record.head_sha);
  const branch = stringField(record.head_branch);
  if (!commitSha || !branch) {
    throw new Error("workflow_run is missing the commit or branch.");
  }
  const status = stringField(record.status) ?? stringField(body.action);
  if (!status) throw new Error("workflow_run is missing a status.");
  const headCommit = record.head_commit;
  const commitMessage =
    (headCommit && typeof headCommit === "object"
      ? stringField((headCommit as { message?: unknown }).message)
      : null) ?? stringField(record.display_title);
  const author =
    (headCommit && typeof headCommit === "object"
      ? stringField(((headCommit as { author?: { name?: unknown } | null }).author ?? {}).name)
      : null) ??
    (record.actor && typeof record.actor === "object"
      ? stringField((record.actor as { login?: unknown }).login)
      : null);
  return {
    id,
    commitSha,
    branch,
    commitMessage,
    author,
    status,
    conclusion: stringField(record.conclusion),
    startedAt: stringField(record.run_started_at),
    finishedAt: stringField(record.updated_at),
    url: stringField(record.html_url),
  };
}

function mapStatus(status: string, conclusion: string | null): BuildStatus {
  if (status !== "completed") {
    return status === "in_progress" ? "in_progress" : "queued";
  }
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled" || conclusion === "skipped" || conclusion === "neutral") {
    return "cancelled";
  }
  return "failure";
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseTime(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("workflow_run has an invalid timestamp.");
  }
  return parsed;
}

function duration(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const milliseconds = finishedAt.getTime() - startedAt.getTime();
  if (milliseconds < 0) return 0;
  return Math.min(milliseconds, INT32_MAX);
}

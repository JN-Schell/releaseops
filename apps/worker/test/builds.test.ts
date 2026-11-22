import { describe, expect, it } from "vitest";
import { processWebhookJob } from "../src/builds/process.js";
import { createMemoryBuildRepository } from "./memory-builds.js";

const projectId = "123e4567-e89b-12d3-a456-426614174000";
const runId = 1001;

function delivery(id: string, payload: unknown, event = "workflow_run") {
  return {
    id,
    event,
    projectId,
    payload,
    status: "received" as const,
    error: null,
  };
}

function workflowRun(status: string, conclusion: string | null) {
  return {
    action: status === "completed" ? "completed" : status,
    workflow_run: {
      id: runId,
      head_sha: "abc123",
      head_branch: "main",
      display_title: "Ship payments",
      status,
      conclusion,
      html_url: "https://github.com/octo/payments-api/actions/runs/1001",
      run_started_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:01:00.000Z",
      actor: { login: "octo" },
      head_commit: { message: "Ship payments\n\nDetails", author: { name: "Ada Lovelace" } },
    },
  };
}

function job(deliveryId: string, event: "workflow_run" | "push" = "workflow_run") {
  return {
    deliveryId,
    githubDeliveryId: `github-${deliveryId}`,
    event,
    projectId,
  };
}

describe("workflow_run builds", () => {
  it("updates one build from in-progress, failed, and successful events", async () => {
    const store = createMemoryBuildRepository();
    const now = new Date("2026-06-01T00:02:00.000Z");
    const inProgress = "123e4567-e89b-12d3-a456-426614174001";
    const failed = "123e4567-e89b-12d3-a456-426614174002";
    const succeeded = "123e4567-e89b-12d3-a456-426614174003";
    store.deliveries.set(inProgress, delivery(inProgress, workflowRun("in_progress", null)));
    store.deliveries.set(failed, delivery(failed, workflowRun("completed", "failure")));
    store.deliveries.set(succeeded, delivery(succeeded, workflowRun("completed", "success")));

    await processWebhookJob(job(inProgress), store.repository, () => now);
    expect(store.builds.size).toBe(1);
    expect(store.builds.get(String(runId))?.status).toBe("in_progress");
    expect(store.builds.get(String(runId))?.finishedAt).toBeNull();

    await processWebhookJob(job(failed), store.repository, () => now);
    expect(store.builds.size).toBe(1);
    expect(store.builds.get(String(runId))?.status).toBe("failure");

    await processWebhookJob(job(succeeded), store.repository, () => now);
    expect(store.builds.size).toBe(1);
    const build = store.builds.get(String(runId));
    expect(build).toMatchObject({
      projectId,
      githubRunId: "1001",
      commitSha: "abc123",
      branch: "main",
      commitMessage: "Ship payments\n\nDetails",
      author: "Ada Lovelace",
      status: "success",
      conclusion: "success",
      durationMs: 60_000,
      url: "https://github.com/octo/payments-api/actions/runs/1001",
    });
    expect(store.deliveries.get(succeeded)?.status).toBe("processed");
    expect(store.deliveries.get(succeeded)?.error).toBeNull();
  });

  it("does not create a second build when the same delivery is processed twice", async () => {
    const store = createMemoryBuildRepository();
    const id = "123e4567-e89b-12d3-a456-426614174004";
    store.deliveries.set(id, delivery(id, workflowRun("completed", "success")));

    await processWebhookJob(job(id), store.repository);
    await processWebhookJob(job(id), store.repository);

    expect(store.builds.size).toBe(1);
    expect(store.deliveries.get(id)?.status).toBe("processed");
  });

  it("stores a worker error and succeeds on retry", async () => {
    const store = createMemoryBuildRepository();
    const id = "123e4567-e89b-12d3-a456-426614174005";
    store.deliveries.set(id, delivery(id, workflowRun("completed", "success")));
    store.failNextUpsert();

    await expect(processWebhookJob(job(id), store.repository)).rejects.toThrow(
      /database unavailable/,
    );
    expect(store.builds.size).toBe(0);
    expect(store.deliveries.get(id)).toMatchObject({
      status: "failed",
      error: "database unavailable",
    });

    await processWebhookJob(job(id), store.repository);
    expect(store.builds.size).toBe(1);
    expect(store.deliveries.get(id)?.status).toBe("processed");
    expect(store.deliveries.get(id)?.error).toBeNull();
  });

  it("marks push deliveries processed without a build", async () => {
    const store = createMemoryBuildRepository();
    const id = "123e4567-e89b-12d3-a456-426614174006";
    store.deliveries.set(id, delivery(id, { ref: "refs/heads/main" }, "push"));

    await processWebhookJob(job(id, "push"), store.repository);

    expect(store.builds.size).toBe(0);
    expect(store.deliveries.get(id)?.status).toBe("processed");
  });

  it("stores an error when the workflow payload is incomplete", async () => {
    const store = createMemoryBuildRepository();
    const id = "123e4567-e89b-12d3-a456-426614174007";
    store.deliveries.set(id, delivery(id, { action: "completed" }));

    await expect(processWebhookJob(job(id), store.repository)).rejects.toThrow(
      /workflow_run payload/,
    );
    expect(store.builds.size).toBe(0);
    expect(store.deliveries.get(id)?.status).toBe("failed");
  });
});

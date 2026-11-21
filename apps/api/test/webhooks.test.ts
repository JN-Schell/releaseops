import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { GithubWebhookEvent } from "@releaseops/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createMemoryWebhookQueue, createMemoryWebhookRepository } from "./memory-webhooks.js";

const secret = "test-webhook-secret";
const projectId = "123e4567-e89b-12d3-a456-426614174000";

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./fixtures/webhooks/${name}.json`, import.meta.url));
}

function signature(body: Buffer, key = secret): string {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

async function createHarness(bodyLimit?: number) {
  const webhooks = createMemoryWebhookRepository();
  const jobs = createMemoryWebhookQueue();
  webhooks.addProject("octo", "payments-api", { id: projectId, webhookSecret: secret });
  const app = await buildApp({
    webOrigin: "http://localhost:5173",
    service: "releaseops-api",
    version: "0.2.0",
    logLevel: "silent",
    webhooks: { repository: webhooks.repository, queue: jobs.queue, bodyLimit },
  });
  return { app, webhooks, jobs };
}

async function post(
  app: FastifyInstance,
  body: Buffer,
  headers: Record<string, string>,
): Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> {
  return app.inject({
    method: "POST",
    url: "/api/v1/webhooks/github",
    headers: { "content-type": "application/json", ...headers },
    payload: body,
  });
}

describe("signed GitHub webhooks", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it.each([
    ["workflow-run", "workflow_run"],
    ["push", "push"],
    ["deployment-status", "deployment_status"],
  ] as const)("stores and queues a signed %s delivery once", async (file, event) => {
    const deliveryId = `delivery-${file}`;
    const harness = await createHarness();
    app = harness.app;
    const body = fixture(file);
    const response = await post(app, body, {
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature(body),
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ accepted: true, duplicate: false });
    expect(harness.webhooks.deliveries.size).toBe(1);
    const stored = harness.webhooks.deliveries.get(deliveryId);
    expect(stored?.event).toBe(event satisfies GithubWebhookEvent);
    expect(stored?.projectId).toBe(projectId);
    expect(JSON.parse(body.toString("utf8"))).toEqual(stored?.payload);
    expect(harness.jobs.jobs).toEqual([
      {
        deliveryId: stored?.id,
        githubDeliveryId: deliveryId,
        event,
        projectId,
      },
    ]);
    expect(JSON.stringify(harness.jobs.jobs)).not.toContain(secret);

    const duplicate = await post(app, body, {
      "x-github-event": event,
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": signature(body),
    });
    expect(duplicate.statusCode).toBe(202);
    expect(duplicate.json()).toMatchObject({
      accepted: true,
      duplicate: true,
      deliveryId: stored?.id,
    });
    expect(harness.webhooks.deliveries.size).toBe(1);
    expect(harness.jobs.jobs).toHaveLength(1);
  });

  it("rejects a missing signature, a bad signature, and an unknown repository", async () => {
    const harness = await createHarness();
    app = harness.app;
    const body = fixture("push");

    const missing = await post(app, body, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-missing",
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("INVALID_SIGNATURE");

    const bad = await post(app, body, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-bad",
      "x-hub-signature-256": signature(body, "other-secret"),
    });
    expect(bad.statusCode).toBe(401);

    const unknown = Buffer.from(body.toString("utf8").replace("payments-api", "other-repo"));
    const unmatched = await post(app, unknown, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-unknown",
      "x-hub-signature-256": signature(unknown),
    });
    expect(unmatched.statusCode).toBe(401);
    expect(harness.webhooks.deliveries.size).toBe(0);
    expect(harness.jobs.jobs).toHaveLength(0);
  });

  it("rejects an oversized body", async () => {
    const harness = await createHarness(32);
    app = harness.app;
    const body = Buffer.from("x".repeat(64));
    const oversized = await post(app, body, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-large",
      "x-hub-signature-256": signature(body),
    });
    expect(oversized.statusCode).toBe(413);
    expect(harness.webhooks.deliveries.size).toBe(0);
  });

  it("rejects an unsupported event after a valid signature", async () => {
    const harness = await createHarness();
    app = harness.app;
    const body = fixture("push");
    const unsupported = await post(app, body, {
      "x-github-event": "issues",
      "x-github-delivery": "delivery-issues",
      "x-hub-signature-256": signature(body),
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error.code).toBe("UNSUPPORTED_EVENT");
    expect(harness.webhooks.deliveries.size).toBe(0);
    expect(harness.jobs.jobs).toHaveLength(0);
  });

  it("acknowledges a signed ping without storing or queueing it", async () => {
    const harness = await createHarness();
    app = harness.app;
    const body = fixture("push");
    const response = await post(app, body, {
      "x-github-event": "ping",
      "x-github-delivery": "delivery-ping",
      "x-hub-signature-256": signature(body),
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ accepted: true, duplicate: false, deliveryId: null });
    expect(harness.webhooks.deliveries.size).toBe(0);
    expect(harness.jobs.jobs).toHaveLength(0);
  });

  it("drops the stored delivery when the queue is unavailable", async () => {
    const harness = await createHarness();
    app = harness.app;
    harness.jobs.failNext();
    const body = fixture("push");
    const failed = await post(app, body, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-retry",
      "x-hub-signature-256": signature(body),
    });
    expect(failed.statusCode).toBe(500);
    expect(harness.webhooks.deliveries.size).toBe(0);

    const retried = await post(app, body, {
      "x-github-event": "push",
      "x-github-delivery": "delivery-retry",
      "x-hub-signature-256": signature(body),
    });
    expect(retried.statusCode).toBe(202);
    expect(retried.json().duplicate).toBe(false);
    expect(harness.jobs.jobs).toHaveLength(1);
  });
});

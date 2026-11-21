import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/auth/cookies.js";
import { buildApp } from "../src/app.js";
import { createMemoryAuthRepository, type MemoryAuthRepository } from "./memory-repository.js";
import { createMemoryProjectRepository, type MemoryProjectRepository } from "./memory-projects.js";

const PASSWORD = "correct horse battery";

function sessionCookie(response: LightMyRequestResponse): string {
  const raw = response.headers["set-cookie"];
  const header = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
  const pair = header
    .split(/[;\n]/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) throw new Error("missing session cookie");
  return pair;
}

async function createHarness(): Promise<{
  app: FastifyInstance;
  auth: MemoryAuthRepository;
  projects: MemoryProjectRepository;
}> {
  const auth = createMemoryAuthRepository();
  const projects = createMemoryProjectRepository();
  const app = await buildApp({
    webOrigin: "http://localhost:5173",
    service: "releaseops-api",
    version: "0.2.0",
    logLevel: "silent",
    auth: { repository: auth, hashing: "fast" },
    projects: { repository: projects },
  });
  return { app, auth, projects };
}

async function adminCookie(app: FastifyInstance): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email: "ada@example.com", name: "Ada", password: PASSWORD },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

async function developerCookie(app: FastifyInstance, admin: string): Promise<string> {
  const invited = await app.inject({
    method: "POST",
    url: "/api/v1/users/invites",
    headers: { cookie: admin },
    payload: { email: "dee@example.com", role: "developer" },
  });
  expect(invited.statusCode).toBe(201);
  const registered = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email: "dee@example.com",
      name: "Dee",
      password: PASSWORD,
      inviteToken: invited.json().token,
    },
  });
  expect(registered.statusCode).toBe(201);
  return sessionCookie(registered);
}

const projectBody = {
  name: "Payments API",
  description: "Card charges",
  githubOwner: "Octo",
  githubRepo: "Payments",
  defaultBranch: "main",
  environments: [
    {
      name: "production",
      order: 0,
      requiresApproval: true,
      requiredApprovals: 2,
      deployWorkflowFile: ".github/workflows/deploy.yml",
    },
  ],
};

describe("projects", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("lets an admin create, edit, and delete a project and its environments", async () => {
    const harness = await createHarness();
    app = harness.app;
    const cookie = await adminCookie(app);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: projectBody,
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    expect(body.project.slug).toBe("payments-api");
    expect(body.project.githubOwner).toBe("octo");
    expect(body.project.githubRepo).toBe("payments");
    expect(body.project.webhookSecret).toBe(body.webhook.secret);
    expect(body.webhook.payloadPath).toBe("/api/v1/webhooks/github");
    expect(body.webhook.instructions).toContain(body.webhook.secret);
    expect(body.webhook.instructions).toContain("X-Hub-Signature-256");
    expect(body.webhook.instructions).toContain("push");
    expect(body.project.environments).toHaveLength(1);

    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
    expect(listed.json().data[0].webhookSecret).toBeUndefined();

    const bySlug = await app.inject({
      method: "GET",
      url: "/api/v1/projects/slug/payments-api",
      headers: { cookie },
    });
    expect(bySlug.statusCode).toBe(200);
    expect(bySlug.json().project.webhookSecret).toBe(body.webhook.secret);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${body.project.id}`,
      headers: { cookie },
      payload: { name: "Payments", description: null },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().project.name).toBe("Payments");
    expect(patched.json().project.slug).toBe("payments-api");
    expect(patched.json().project.description).toBeNull();

    const environmentId = body.project.environments[0].id as string;
    const environment = await app.inject({
      method: "PATCH",
      url: `/api/v1/environments/${environmentId}`,
      headers: { cookie },
      payload: { requiredApprovals: 1 },
    });
    expect(environment.statusCode).toBe(200);
    expect(environment.json().environment.requiredApprovals).toBe(1);

    const added = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${body.project.id}/environments`,
      headers: { cookie },
      payload: { name: "staging", order: 1 },
    });
    expect(added.statusCode).toBe(201);

    const removedEnvironment = await app.inject({
      method: "DELETE",
      url: `/api/v1/environments/${added.json().environment.id}`,
      headers: { cookie },
    });
    expect(removedEnvironment.statusCode).toBe(204);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/projects/${body.project.id}`,
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    const after = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { cookie },
    });
    expect(after.json().data).toEqual([]);

    const serialized = JSON.stringify(harness.projects.audits);
    expect(serialized).not.toContain(body.webhook.secret);
    expect(harness.projects.audits.map((event) => event.action)).toEqual([
      "project.created",
      "environment.created",
      "project.updated",
      "environment.updated",
      "environment.created",
      "environment.deleted",
      "project.deleted",
    ]);
  });

  it("rejects a missing session, a denied role, and invalid input", async () => {
    const harness = await createHarness();
    app = harness.app;
    const admin = await adminCookie(app);
    const developer = await developerCookie(app, admin);

    const anonymous = await app.inject({ method: "GET", url: "/api/v1/projects" });
    expect(anonymous.statusCode).toBe(401);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: admin },
      payload: { name: "Payments", githubOwner: "-bad", githubRepo: "payments" },
    });
    expect(invalid.statusCode).toBe(400);

    const reserved = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: admin },
      payload: { name: "New", githubOwner: "octo", githubRepo: "new-project" },
    });
    expect(reserved.statusCode).toBe(400);
    expect(reserved.json().error.code).toBe("INVALID_NAME");

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: developer },
      payload: projectBody,
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie: admin },
      payload: projectBody,
    });
    expect(created.statusCode).toBe(201);
    const viewed = await app.inject({
      method: "GET",
      url: "/api/v1/projects/slug/payments-api",
      headers: { cookie: developer },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().project.webhookSecret).toBeUndefined();
    expect(viewed.json().project.environments).toHaveLength(1);

    const manage = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${created.json().project.id}/environments`,
      headers: { cookie: developer },
      payload: { name: "staging", order: 1 },
    });
    expect(manage.statusCode).toBe(403);
  });

  it("rolls the project back when the audit write fails", async () => {
    const harness = await createHarness();
    app = harness.app;
    const cookie = await adminCookie(app);
    harness.projects.failNextAudit("project.created");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: projectBody,
    });
    expect(created.statusCode).toBe(500);
    expect(harness.projects.audits).toEqual([]);
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/projects",
      headers: { cookie },
    });
    expect(listed.json().data).toEqual([]);
  });

  it("rejects a second link to the same GitHub repository", async () => {
    const harness = await createHarness();
    app = harness.app;
    const cookie = await adminCookie(app);
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: projectBody,
    });
    expect(first.statusCode).toBe(201);
    const second = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: { cookie },
      payload: { ...projectBody, name: "Other" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("REPO_LINKED");
  });
});

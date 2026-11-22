import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/auth/cookies.js";
import { buildApp } from "../src/app.js";
import { createMemoryAuthRepository } from "./memory-repository.js";
import { createMemoryProjectRepository } from "./memory-projects.js";
import { createMemoryBuildRepository, sampleBuild } from "./memory-builds.js";

const PASSWORD = "correct horse battery";
const projectId = "123e4567-e89b-12d3-a456-426614174010";

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

async function register(
  app: FastifyInstance,
  email: string,
  role?: "developer" | "approver",
  admin?: string,
) {
  let inviteToken: string | undefined;
  if (role && admin) {
    const invited = await app.inject({
      method: "POST",
      url: "/api/v1/users/invites",
      headers: { cookie: admin },
      payload: { email, role },
    });
    expect(invited.statusCode).toBe(201);
    inviteToken = invited.json().token;
  }
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, name: email, password: PASSWORD, ...(inviteToken ? { inviteToken } : {}) },
  });
  expect(response.statusCode).toBe(201);
  return sessionCookie(response);
}

describe("builds", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("pages a stable cursor and filters by branch, status, and date", async () => {
    const builds = createMemoryBuildRepository();
    builds.allowProject(projectId);
    const newest = "123e4567-e89b-12d3-a456-426614174003";
    const middle = "123e4567-e89b-12d3-a456-426614174002";
    const oldest = "123e4567-e89b-12d3-a456-426614174001";
    builds.addBuild(
      sampleBuild({ id: oldest, projectId, createdAt: "2026-06-01T00:00:00.000Z", branch: "main" }),
    );
    builds.addBuild(
      sampleBuild({
        id: middle,
        projectId,
        createdAt: "2026-06-02T00:00:00.000Z",
        branch: "feature",
        status: "failure",
      }),
    );
    builds.addBuild(
      sampleBuild({ id: newest, projectId, createdAt: "2026-06-03T00:00:00.000Z", branch: "main" }),
    );
    app = await createApp(builds);
    const admin = await register(app, "ada@example.com");

    const first = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?limit=2`,
      headers: { cookie: admin },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.map((build: { id: string }) => build.id)).toEqual([newest, middle]);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toEqual(expect.any(String));

    const repeated = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?limit=2`,
      headers: { cookie: admin },
    });
    expect(repeated.json().nextCursor).toBe(cursor);

    const second = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?limit=2&cursor=${encodeURIComponent(cursor)}`,
      headers: { cookie: admin },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data.map((build: { id: string }) => build.id)).toEqual([oldest]);
    expect(second.json().nextCursor).toBeNull();

    const mainOnly = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?branch=main&status=success&from=2026-06-03T00:00:00.000Z&to=2026-06-03T00:00:00.000Z`,
      headers: { cookie: admin },
    });
    expect(mainOnly.json().data.map((build: { id: string }) => build.id)).toEqual([newest]);

    const invalid = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?cursor=not-a-cursor`,
      headers: { cookie: admin },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_CURSOR");
    const malformed = Buffer.from("2026-06-03T00:00:00.000Z\nnot-a-uuid").toString("base64url");
    const badId = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/builds?cursor=${encodeURIComponent(malformed)}`,
      headers: { cookie: admin },
    });
    expect(badId.statusCode).toBe(400);
    expect(badId.json().error.code).toBe("INVALID_CURSOR");
  });

  it("lets an admin, a developer, and an approver read a build", async () => {
    const builds = createMemoryBuildRepository();
    builds.allowProject(projectId, { name: "Payments", slug: "payments" });
    const buildId = "123e4567-e89b-12d3-a456-426614174020";
    builds.addBuild(
      sampleBuild({
        id: buildId,
        projectId,
        createdAt: "2026-06-01T00:00:00.000Z",
        deployments: [
          {
            id: "123e4567-e89b-12d3-a456-426614174021",
            status: "succeeded",
            environmentName: "production",
            createdAt: new Date("2026-06-01T01:00:00.000Z"),
          },
        ],
      }),
    );
    app = await createApp(builds);
    const admin = await register(app, "ada@example.com");
    const developer = await register(app, "dee@example.com", "developer", admin);
    const approver = await register(app, "pat@example.com", "approver", admin);

    for (const cookie of [admin, developer, approver]) {
      const listed = await app.inject({
        method: "GET",
        url: `/api/v1/projects/${projectId}/builds`,
        headers: { cookie },
      });
      expect(listed.statusCode).toBe(200);
      expect(listed.json().data).toHaveLength(1);
      const viewed = await app.inject({
        method: "GET",
        url: `/api/v1/builds/${buildId}`,
        headers: { cookie },
      });
      expect(viewed.statusCode).toBe(200);
      expect(viewed.json().build.project.slug).toBe("payments");
      expect(viewed.json().build.deployments).toEqual([
        {
          id: "123e4567-e89b-12d3-a456-426614174021",
          status: "succeeded",
          environmentName: "production",
          createdAt: "2026-06-01T01:00:00.000Z",
        },
      ]);
    }

    const anonymous = await app.inject({ method: "GET", url: `/api/v1/builds/${buildId}` });
    expect(anonymous.statusCode).toBe(401);
    const missing = await app.inject({
      method: "GET",
      url: "/api/v1/projects/123e4567-e89b-12d3-a456-426614174099/builds",
      headers: { cookie: admin },
    });
    expect(missing.statusCode).toBe(404);
  });
});

function createApp(builds: ReturnType<typeof createMemoryBuildRepository>) {
  return buildApp({
    webOrigin: "http://localhost:5173",
    service: "releaseops-api",
    version: "0.2.0",
    logLevel: "silent",
    auth: { repository: createMemoryAuthRepository(), hashing: "fast" },
    projects: { repository: createMemoryProjectRepository() },
    builds: { repository: builds },
  });
}

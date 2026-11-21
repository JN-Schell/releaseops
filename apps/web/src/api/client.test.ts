import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, fetchCurrentUser, fetchHealth, loginAccount } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchHealth", () => {
  it("parses a healthy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", service: "releaseops-api", version: "0.1.0" }),
      }),
    );

    await expect(fetchHealth("http://localhost:3001")).resolves.toMatchObject({
      status: "ok",
      service: "releaseops-api",
    });
  });

  it("throws when the API responds with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      }),
    );

    await expect(fetchHealth("http://api.test")).rejects.toThrow(/503/);
  });

  it("throws when the network request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    await expect(fetchHealth("http://api.test")).rejects.toThrow(
      /unreachable at http:\/\/api\.test/,
    );
  });
});

describe("session client", () => {
  it("treats 401 from the session endpoint as signed out", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: "UNAUTHENTICATED", message: "Sign in required." } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCurrentUser()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends login credentials on the request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: "123e4567-e89b-12d3-a456-426614174000",
          email: "ada@example.com",
          name: "Ada",
          role: "admin",
          isActive: true,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loginAccount({ email: "ada@example.com", password: "correct horse battery" }),
    ).resolves.toMatchObject({
      email: "ada@example.com",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ email: "ada@example.com", password: "correct horse battery" }),
      }),
    );
  });

  it("creates a project with credentials included", async () => {
    const project = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Payments",
      slug: "payments",
      description: null,
      githubOwner: "octo",
      githubRepo: "payments",
      defaultBranch: "main",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      environments: [],
      webhookSecret: "secret",
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        project,
        webhook: {
          secret: "secret",
          payloadPath: "/api/v1/webhooks/github",
          instructions: "Add a webhook",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createProject({
        name: "Payments",
        githubOwner: "octo",
        githubRepo: "payments",
        defaultBranch: "main",
      }),
    ).resolves.toMatchObject({ project: { slug: "payments" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/projects",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

import {
  authUserResponseSchema,
  createProjectResponseSchema,
  environmentResponseSchema,
  errorBodySchema,
  healthResponseSchema,
  inviteResponseSchema,
  projectListResponseSchema,
  projectResponseSchema,
  setupResponseSchema,
  userListResponseSchema,
  type CreateInviteBody,
  type CreateProjectBody,
  type EnvironmentBody,
  type HealthResponse,
  type Project,
  type PublicUser,
  type UpdateEnvironmentBody,
  type UpdateProjectBody,
  type UpdateUserBody,
} from "@releaseops/shared";

export function apiBaseUrl(env: ImportMetaEnv = import.meta.env): string {
  const configured = env.VITE_API_URL?.trim();
  return configured && configured.length > 0 ? configured : "http://localhost:3001";
}

export async function fetchHealth(baseUrl = apiBaseUrl()): Promise<HealthResponse> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/healthz`);
  } catch {
    throw new Error(`API unreachable at ${baseUrl}`);
  }

  if (!response.ok) {
    throw new Error(`API health check failed (${response.status})`);
  }

  return healthResponseSchema.parse(await response.json());
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(`API unreachable at ${apiBaseUrl()}`, 0);
  }
}

async function parseError(response: Response): Promise<never> {
  let message = `Request failed (${response.status})`;
  let code: string | undefined;
  try {
    const parsed = errorBodySchema.safeParse(await response.json());
    if (parsed.success) {
      message = parsed.data.error.message;
      code = parsed.data.error.code;
    }
  } catch {
    // The body was not the JSON error envelope.
  }
  throw new ApiError(message, response.status, code);
}

export async function fetchSetup(): Promise<{ needsInvite: boolean }> {
  const response = await request("/api/v1/auth/setup");
  if (!response.ok) await parseError(response);
  return setupResponseSchema.parse(await response.json());
}

export async function fetchCurrentUser(): Promise<PublicUser | null> {
  const response = await request("/api/v1/auth/me");
  if (response.status === 401) return null;
  if (!response.ok) await parseError(response);
  return authUserResponseSchema.parse(await response.json()).user;
}

export async function registerAccount(input: {
  email: string;
  name: string;
  password: string;
  inviteToken?: string;
}): Promise<PublicUser> {
  const response = await request("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return authUserResponseSchema.parse(await response.json()).user;
}

export async function loginAccount(input: {
  email: string;
  password: string;
}): Promise<PublicUser> {
  const response = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return authUserResponseSchema.parse(await response.json()).user;
}

export async function logoutAccount(): Promise<void> {
  const response = await request("/api/v1/auth/logout", { method: "POST" });
  if (!response.ok) await parseError(response);
}

export async function fetchUsers(): Promise<PublicUser[]> {
  const response = await request("/api/v1/users");
  if (!response.ok) await parseError(response);
  return userListResponseSchema.parse(await response.json()).data;
}

export async function createInvite(input: CreateInviteBody): Promise<{
  email: string;
  role: CreateInviteBody["role"];
  expiresAt: string;
  token: string;
}> {
  const response = await request("/api/v1/users/invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return inviteResponseSchema.parse(await response.json());
}

export async function fetchProjects(): Promise<Project[]> {
  const response = await request("/api/v1/projects");
  if (!response.ok) await parseError(response);
  return projectListResponseSchema.parse(await response.json()).data;
}

export async function fetchProjectBySlug(slug: string): Promise<Project> {
  const response = await request(`/api/v1/projects/slug/${encodeURIComponent(slug)}`);
  if (!response.ok) await parseError(response);
  return projectResponseSchema.parse(await response.json()).project;
}

export async function createProject(input: CreateProjectBody): Promise<{
  project: Project;
  webhook: { secret: string; payloadPath: string; instructions: string };
}> {
  const response = await request("/api/v1/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return createProjectResponseSchema.parse(await response.json());
}

export async function updateProject(id: string, patch: UpdateProjectBody): Promise<Project> {
  const response = await request(`/api/v1/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response);
  return projectResponseSchema.parse(await response.json()).project;
}

export async function deleteProject(id: string): Promise<void> {
  const response = await request(`/api/v1/projects/${id}`, { method: "DELETE" });
  if (!response.ok) await parseError(response);
}

export async function createEnvironment(
  projectId: string,
  input: EnvironmentBody,
): Promise<Project["environments"][number]> {
  const response = await request(`/api/v1/projects/${projectId}/environments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) await parseError(response);
  return environmentResponseSchema.parse(await response.json()).environment;
}

export async function updateEnvironment(
  id: string,
  patch: UpdateEnvironmentBody,
): Promise<Project["environments"][number]> {
  const response = await request(`/api/v1/environments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response);
  return environmentResponseSchema.parse(await response.json()).environment;
}

export async function deleteEnvironment(id: string): Promise<void> {
  const response = await request(`/api/v1/environments/${id}`, { method: "DELETE" });
  if (!response.ok) await parseError(response);
}

export async function updateUser(id: string, patch: UpdateUserBody): Promise<PublicUser> {
  const response = await request(`/api/v1/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!response.ok) await parseError(response);
  return authUserResponseSchema.parse(await response.json()).user;
}

import {
  createProjectBodySchema,
  environmentBodySchema,
  updateEnvironmentBodySchema,
  updateProjectBodySchema,
  can,
} from "@releaseops/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requestMeta } from "../auth/request.js";
import { AppError } from "../plugins/errors.js";
import { requirePermission } from "../plugins/permissions.js";
import type { ProjectService } from "../projects/service.js";

const idParams = z.object({ id: z.uuid() });
const slugParams = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});

export function registerProjectRoutes(app: FastifyInstance, service: ProjectService) {
  app.get("/api/v1/projects", { preHandler: requirePermission("read") }, async () => ({
    data: await service.list(),
  }));

  app.post(
    "/api/v1/projects",
    { preHandler: requirePermission("project:create") },
    async (request, reply) => {
      const body = createProjectBodySchema.parse(request.body);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      reply.code(201);
      return service.create(actor.id, body, requestMeta(request));
    },
  );

  app.get(
    "/api/v1/projects/slug/:slug",
    { preHandler: requirePermission("read") },
    async (request) => {
      const params = slugParams.parse(request.params);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      return {
        project: await service.getBySlug(params.slug, can(actor, "project:update")),
      };
    },
  );

  app.get("/api/v1/projects/:id", { preHandler: requirePermission("read") }, async (request) => {
    const params = idParams.parse(request.params);
    const actor = request.user;
    if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
    return { project: await service.getById(params.id, can(actor, "project:update")) };
  });

  app.patch(
    "/api/v1/projects/:id",
    { preHandler: requirePermission("project:update") },
    async (request) => {
      const params = idParams.parse(request.params);
      const body = updateProjectBodySchema.parse(request.body);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      return { project: await service.update(actor.id, params.id, body, requestMeta(request)) };
    },
  );

  app.delete(
    "/api/v1/projects/:id",
    { preHandler: requirePermission("project:delete") },
    async (request, reply) => {
      const params = idParams.parse(request.params);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      await service.remove(actor.id, params.id, requestMeta(request));
      reply.code(204);
      return null;
    },
  );

  app.post(
    "/api/v1/projects/:id/environments",
    { preHandler: requirePermission("env:manage") },
    async (request, reply) => {
      const params = idParams.parse(request.params);
      const body = environmentBodySchema.parse(request.body);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      reply.code(201);
      return {
        environment: await service.addEnvironment(actor.id, params.id, body, requestMeta(request)),
      };
    },
  );

  app.patch(
    "/api/v1/environments/:id",
    { preHandler: requirePermission("env:manage") },
    async (request) => {
      const params = idParams.parse(request.params);
      const body = updateEnvironmentBodySchema.parse(request.body);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      return {
        environment: await service.updateEnvironment(
          actor.id,
          params.id,
          body,
          requestMeta(request),
        ),
      };
    },
  );

  app.delete(
    "/api/v1/environments/:id",
    { preHandler: requirePermission("env:manage") },
    async (request, reply) => {
      const params = idParams.parse(request.params);
      const actor = request.user;
      if (!actor) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      await service.removeEnvironment(actor.id, params.id, requestMeta(request));
      reply.code(204);
      return null;
    },
  );
}

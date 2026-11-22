import { buildListQuerySchema } from "@releaseops/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BuildService } from "../builds/service.js";
import { AppError } from "../plugins/errors.js";
import { requirePermission } from "../plugins/permissions.js";

const idParams = z.object({ id: z.uuid() });

export function registerBuildRoutes(app: FastifyInstance, service: BuildService): void {
  app.get(
    "/api/v1/projects/:id/builds",
    { preHandler: requirePermission("read") },
    async (request) => {
      const params = idParams.parse(request.params);
      const query = buildListQuerySchema.parse(request.query);
      if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
      return service.list(params.id, query);
    },
  );

  app.get("/api/v1/builds/:id", { preHandler: requirePermission("read") }, async (request) => {
    const params = idParams.parse(request.params);
    if (!request.user) throw new AppError(401, "UNAUTHENTICATED", "Sign in required.");
    return { build: await service.get(params.id) };
  });
}

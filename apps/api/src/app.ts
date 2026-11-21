import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { AuditWrite, AuthRepository } from "./auth/repository.js";
import type { ProjectRepository } from "./projects/repository.js";
import { createPasswordHasher } from "./auth/passwords.js";
import { createLoginRateLimiter, type RateLimiter } from "./auth/rate-limit.js";
import { createAuthService } from "./auth/service.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import "./types.js";
import { healthRoutes, type HealthRouteOptions } from "./routes/health.js";
import { createProjectService } from "./projects/service.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import type { WebhookQueue } from "./webhooks/queue.js";
import type { WebhookRepository } from "./webhooks/repository.js";
import { createWebhookService, WEBHOOK_BODY_LIMIT } from "./webhooks/service.js";

export interface BuildAppOptions extends HealthRouteOptions {
  webOrigin: string;
  logLevel?: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  auth?: {
    repository: AuthRepository;
    hashing?: "fast" | "standard";
    now?: () => Date;
    rateLimit?: RateLimiter;
    secureCookies?: boolean;
  };
  projects?: {
    repository: ProjectRepository;
  };
  webhooks?: {
    repository: WebhookRepository;
    queue: WebhookQueue;
    bodyLimit?: number;
    now?: () => Date;
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logLevel = options.logLevel ?? "info";
  const app = Fastify({
    logger:
      logLevel === "silent"
        ? false
        : {
            level: logLevel,
            redact: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['x-hub-signature-256']",
              "req.body.password",
              "req.body.inviteToken",
            ],
          },
  });

  await app.register(cors, {
    origin: options.webOrigin,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  registerErrorHandler(app);
  app.decorateRequest("user", null);
  if (options.webhooks) {
    const webhooks = options.webhooks;
    await registerWebhookRoutes(
      app,
      createWebhookService(webhooks.repository, webhooks.queue, {
        now: webhooks.now,
        bodyLimit: webhooks.bodyLimit,
      }),
      webhooks.bodyLimit ?? WEBHOOK_BODY_LIMIT,
    );
  }
  await app.register(healthRoutes, {
    service: options.service,
    version: options.version,
    checkReady: options.checkReady,
  });

  if (options.auth) {
    const auth = options.auth;
    await app.register(cookie);
    const service = createAuthService(auth.repository, {
      hasher: createPasswordHasher(auth.hashing ?? "standard"),
      now: auth.now ?? (() => new Date()),
      rateLimit: auth.rateLimit ?? createLoginRateLimiter(),
    });
    app.decorate("recordAudit", (event: AuditWrite) => auth.repository.insertAudit(event));
    await registerAuthRoutes(app, {
      service,
      secureCookies: auth.secureCookies ?? false,
    });
    if (options.projects) {
      await registerProjectRoutes(app, createProjectService(options.projects.repository));
    }
  }

  return app;
}

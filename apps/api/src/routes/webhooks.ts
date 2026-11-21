import type { FastifyInstance } from "fastify";
import { AppError } from "../plugins/errors.js";
import { WEBHOOK_BODY_LIMIT, type WebhookService } from "../webhooks/service.js";

export async function registerWebhookRoutes(
  app: FastifyInstance,
  service: WebhookService,
  bodyLimit = WEBHOOK_BODY_LIMIT,
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit },
      (_request, body, done) => {
        const raw = Buffer.isBuffer(body) ? body : Buffer.from(body);
        try {
          const payload: unknown = JSON.parse(raw.toString("utf8"));
          done(null, { raw, payload });
        } catch {
          const error = new AppError(400, "VALIDATION_ERROR", "Webhook body must be JSON.");
          done(error, undefined);
        }
      },
    );

    scope.post("/api/v1/webhooks/github", async (request, reply) => {
      const body = request.body as { raw: Buffer; payload: unknown };
      const result = await service.accept({
        rawBody: body.raw,
        payload: body.payload,
        event: headerValue(request.headers["x-github-event"]),
        deliveryId: headerValue(request.headers["x-github-delivery"]),
        signature: headerValue(request.headers["x-hub-signature-256"]),
      });
      return reply.code(202).send(result);
    });
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : undefined;
}

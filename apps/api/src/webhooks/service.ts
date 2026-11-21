import { randomUUID } from "node:crypto";
import { GITHUB_WEBHOOK_EVENTS, type GithubWebhookEvent } from "@releaseops/shared";
import { DuplicateRecordError } from "../auth/repository.js";
import { AppError } from "../plugins/errors.js";
import type { WebhookQueue } from "./queue.js";
import type { StoredWebhookDelivery, WebhookRepository } from "./repository.js";
import { verifyGithubSignature } from "./signature.js";

export const WEBHOOK_BODY_LIMIT = 1_048_576;

const supportedEvents = new Set<string>(GITHUB_WEBHOOK_EVENTS);

export interface IncomingWebhook {
  rawBody: Buffer;
  payload: unknown;
  event: string | undefined;
  deliveryId: string | undefined;
  signature: string | undefined;
}

export interface AcceptedWebhook {
  accepted: true;
  duplicate: boolean;
  deliveryId: string | null;
}

export interface WebhookService {
  accept(input: IncomingWebhook): Promise<AcceptedWebhook>;
}

export function createWebhookService(
  repository: WebhookRepository,
  queue: WebhookQueue,
  options: { now?: () => Date; bodyLimit?: number } = {},
): WebhookService {
  const now = options.now ?? (() => new Date());
  const bodyLimit = options.bodyLimit ?? WEBHOOK_BODY_LIMIT;

  return {
    async accept(input) {
      if (input.rawBody.length > bodyLimit) {
        throw new AppError(413, "PAYLOAD_TOO_LARGE", "Webhook body exceeds the size limit.");
      }

      const repositoryName = readRepository(input.payload);
      if (!repositoryName) {
        throw new AppError(400, "VALIDATION_ERROR", "Webhook payload has no repository.");
      }

      const project = await repository.findProject(repositoryName.owner, repositoryName.repo);
      const secret = project?.webhookSecret ?? "";
      if (!project || !verifyGithubSignature(secret, input.rawBody, input.signature)) {
        throw new AppError(401, "INVALID_SIGNATURE", "Webhook signature is invalid.");
      }

      if (input.event === "ping") {
        return { accepted: true, duplicate: false, deliveryId: null };
      }

      const event = supportedEvent(input.event);
      const deliveryId = githubDeliveryId(input.deliveryId);
      const existing = await repository.findDelivery(deliveryId);
      if (existing) {
        return { accepted: true, duplicate: true, deliveryId: existing.id };
      }

      const delivery: StoredWebhookDelivery = {
        id: randomUUID(),
        deliveryId,
        event,
        projectId: project.id,
        payload: input.payload,
        receivedAt: now(),
      };

      try {
        await repository.insertDelivery(delivery);
      } catch (error) {
        if (error instanceof DuplicateRecordError) {
          const raced = await repository.findDelivery(deliveryId);
          return { accepted: true, duplicate: true, deliveryId: raced?.id ?? null };
        }
        throw error;
      }

      try {
        await queue.enqueue({
          deliveryId: delivery.id,
          githubDeliveryId: delivery.deliveryId,
          event: delivery.event,
          projectId: delivery.projectId,
        });
      } catch (error) {
        await repository.deleteDelivery(delivery.id);
        throw error;
      }

      return { accepted: true, duplicate: false, deliveryId: delivery.id };
    },
  };
}

function readRepository(payload: unknown): { owner: string; repo: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const repository = (payload as { repository?: unknown }).repository;
  if (!repository || typeof repository !== "object") return null;
  const owner = (repository as { owner?: { login?: unknown } }).owner?.login;
  const name = (repository as { name?: unknown }).name;
  if (typeof owner !== "string" || typeof name !== "string") return null;
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepo = name.trim().toLowerCase();
  if (!normalizedOwner || !normalizedRepo) return null;
  return { owner: normalizedOwner, repo: normalizedRepo };
}

function supportedEvent(event: string | undefined): GithubWebhookEvent {
  if (event && supportedEvents.has(event)) return event as GithubWebhookEvent;
  throw new AppError(400, "UNSUPPORTED_EVENT", "This GitHub event is not accepted.");
}

function githubDeliveryId(value: string | undefined): string {
  const deliveryId = value?.trim() ?? "";
  if (!/^[A-Za-z0-9-]{1,80}$/.test(deliveryId)) {
    throw new AppError(400, "VALIDATION_ERROR", "X-GitHub-Delivery is required.");
  }
  return deliveryId;
}

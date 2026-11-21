import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { DuplicateRecordError } from "../auth/repository.js";
import type { GithubWebhookEvent } from "@releaseops/shared";
import type { StoredWebhookDelivery, WebhookProject, WebhookRepository } from "./repository.js";

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class PrismaWebhookRepository implements WebhookRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findProject(owner: string, repo: string): Promise<WebhookProject | null> {
    const project = await this.prisma.project.findUnique({
      where: { githubOwner_githubRepo: { githubOwner: owner, githubRepo: repo } },
      select: { id: true, webhookSecretEnc: true },
    });
    if (!project) return null;
    return { id: project.id, webhookSecret: project.webhookSecretEnc ?? "" };
  }

  async findDelivery(deliveryId: string): Promise<StoredWebhookDelivery | null> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { deliveryId } });
    if (!row || !row.projectId) return null;
    return {
      id: row.id,
      deliveryId: row.deliveryId,
      event: row.event as GithubWebhookEvent,
      projectId: row.projectId,
      payload: row.payload,
      receivedAt: row.receivedAt,
    };
  }

  async insertDelivery(delivery: StoredWebhookDelivery): Promise<void> {
    try {
      await this.prisma.webhookDelivery.create({
        data: {
          id: delivery.id,
          deliveryId: delivery.deliveryId,
          event: delivery.event,
          projectId: delivery.projectId,
          payload: jsonValue(delivery.payload),
          status: "received",
          receivedAt: delivery.receivedAt,
        },
      });
    } catch (error) {
      if (isDeliveryConflict(error)) throw new DuplicateRecordError("delivery");
      throw error;
    }
  }

  async deleteDelivery(id: string): Promise<void> {
    await this.prisma.webhookDelivery.delete({ where: { id } }).catch((error: unknown) => {
      if (isMissing(error)) return;
      throw error;
    });
  }
}

function isDeliveryConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const meta = "meta" in error ? error.meta : undefined;
  const target =
    meta && typeof meta === "object" && meta !== null && "target" in meta ? meta.target : "";
  const text = (Array.isArray(target) ? target.join(" ") : String(target)).toLowerCase();
  return text.includes("delivery");
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

import { GITHUB_WEBHOOK_EVENTS, JOB_NAMES } from "@releaseops/shared";
import { z } from "zod";
import { mapWorkflowRun } from "./map.js";
import type { BuildRepository } from "./repository.js";

const jobSchema = z.object({
  deliveryId: z.uuid(),
  githubDeliveryId: z.string().trim().min(1),
  event: z.enum(GITHUB_WEBHOOK_EVENTS),
  projectId: z.uuid(),
});

const errorLimit = 500;

export async function handleJob(
  name: string,
  data: unknown,
  repository: BuildRepository,
  now: () => Date = () => new Date(),
): Promise<void> {
  if (name !== JOB_NAMES.githubWebhook) return;
  await processWebhookJob(data, repository, now);
}

export async function processWebhookJob(
  data: unknown,
  repository: BuildRepository,
  now: () => Date = () => new Date(),
): Promise<void> {
  const deliveryId = readDeliveryId(data);
  try {
    const job = jobSchema.parse(data);
    const delivery = await repository.findDelivery(job.deliveryId);
    if (!delivery) {
      throw new Error("Webhook delivery was not found.");
    }
    if (delivery.event !== "workflow_run") {
      await repository.markProcessed(delivery.id, now());
      return;
    }
    const build = mapWorkflowRun(delivery.payload, delivery.projectId);
    await repository.upsertBuild(build);
    await repository.markProcessed(delivery.id, now());
  } catch (error) {
    if (deliveryId) {
      await repository.markFailed(deliveryId, errorMessage(error));
    }
    throw error;
  }
}

function readDeliveryId(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("deliveryId" in data)) return undefined;
  const value = data.deliveryId;
  return typeof value === "string" && z.uuid().safeParse(value).success ? value : undefined;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Build update failed";
  return message.slice(0, errorLimit);
}

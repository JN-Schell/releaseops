import { JOB_NAMES } from "@releaseops/shared";
import type { Queue } from "bullmq";
import type { WebhookJob, WebhookQueue } from "./queue.js";

export class BullMqWebhookQueue implements WebhookQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(job: WebhookJob): Promise<void> {
    await this.queue.add(JOB_NAMES.githubWebhook, job, {
      jobId: job.githubDeliveryId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }
}

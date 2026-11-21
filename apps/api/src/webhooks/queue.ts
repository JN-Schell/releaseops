import type { GithubWebhookEvent } from "@releaseops/shared";

export interface WebhookJob {
  deliveryId: string;
  githubDeliveryId: string;
  event: GithubWebhookEvent;
  projectId: string;
}

export interface WebhookQueue {
  enqueue(job: WebhookJob): Promise<void>;
}

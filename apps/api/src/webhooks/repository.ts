import type { GithubWebhookEvent } from "@releaseops/shared";

export interface WebhookProject {
  id: string;
  webhookSecret: string;
}

export interface StoredWebhookDelivery {
  id: string;
  deliveryId: string;
  event: GithubWebhookEvent;
  projectId: string;
  payload: unknown;
  receivedAt: Date;
}

export interface WebhookRepository {
  findProject(owner: string, repo: string): Promise<WebhookProject | null>;
  findDelivery(deliveryId: string): Promise<StoredWebhookDelivery | null>;
  insertDelivery(delivery: StoredWebhookDelivery): Promise<void>;
  deleteDelivery(id: string): Promise<void>;
}

import { DuplicateRecordError } from "../src/auth/repository.js";
import type { WebhookJob, WebhookQueue } from "../src/webhooks/queue.js";
import type {
  StoredWebhookDelivery,
  WebhookProject,
  WebhookRepository,
} from "../src/webhooks/repository.js";

export function createMemoryWebhookRepository() {
  const projects = new Map<string, WebhookProject>();
  const deliveries = new Map<string, StoredWebhookDelivery>();

  const repository: WebhookRepository = {
    async findProject(owner, repo) {
      return projects.get(`${owner}/${repo}`) ?? null;
    },
    async findDelivery(deliveryId) {
      return deliveries.get(deliveryId) ?? null;
    },
    async insertDelivery(delivery) {
      if (deliveries.has(delivery.deliveryId)) throw new DuplicateRecordError("delivery");
      deliveries.set(delivery.deliveryId, delivery);
    },
    async deleteDelivery(id) {
      for (const [key, delivery] of deliveries) {
        if (delivery.id === id) deliveries.delete(key);
      }
    },
  };

  return {
    repository,
    addProject(owner: string, repo: string, project: WebhookProject) {
      projects.set(`${owner}/${repo}`, project);
    },
    deliveries,
  };
}

export function createMemoryWebhookQueue() {
  const jobs: WebhookJob[] = [];
  let failNext = false;

  const queue: WebhookQueue = {
    async enqueue(job) {
      if (failNext) {
        failNext = false;
        throw new Error("queue unavailable");
      }
      jobs.push(job);
    },
  };

  return {
    queue,
    jobs,
    failNext() {
      failNext = true;
    },
  };
}

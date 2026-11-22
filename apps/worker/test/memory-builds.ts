import type { BuildRecord, BuildRepository, StoredDelivery } from "../src/builds/repository.js";

export function createMemoryBuildRepository() {
  const deliveries = new Map<string, StoredDelivery>();
  const builds = new Map<string, BuildRecord>();
  let failUpsert = false;

  const repository: BuildRepository = {
    async findDelivery(id) {
      const delivery = deliveries.get(id);
      return delivery ? { ...delivery, payload: delivery.payload } : null;
    },
    async upsertBuild(build) {
      if (failUpsert) {
        failUpsert = false;
        throw new Error("database unavailable");
      }
      builds.set(build.githubRunId, build);
    },
    async markProcessed(id) {
      const delivery = deliveries.get(id);
      if (!delivery) return;
      deliveries.set(id, { ...delivery, status: "processed", error: null });
    },
    async markFailed(id, error) {
      const delivery = deliveries.get(id);
      if (!delivery) return;
      deliveries.set(id, { ...delivery, status: "failed", error });
    },
  };

  return {
    repository,
    deliveries,
    builds,
    failNextUpsert() {
      failUpsert = true;
    },
  };
}

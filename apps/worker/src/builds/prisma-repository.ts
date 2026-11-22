import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { BuildRecord, BuildRepository, StoredDelivery } from "./repository.js";

export class PrismaBuildRepository implements BuildRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findDelivery(id: string): Promise<StoredDelivery | null> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { id } });
    if (!row?.projectId) return null;
    return {
      id: row.id,
      event: row.event,
      projectId: row.projectId,
      payload: row.payload,
      status: row.status,
      error: row.error,
    };
  }

  async upsertBuild(build: BuildRecord): Promise<void> {
    const data = {
      projectId: build.projectId,
      commitSha: build.commitSha,
      branch: build.branch,
      commitMessage: build.commitMessage,
      author: build.author,
      status: build.status,
      conclusion: build.conclusion,
      startedAt: build.startedAt,
      finishedAt: build.finishedAt,
      durationMs: build.durationMs,
      url: build.url,
    };
    await this.prisma.build.upsert({
      where: { githubRunId: build.githubRunId },
      create: { id: randomUUID(), githubRunId: build.githubRunId, ...data },
      update: data,
    });
  }

  async markProcessed(id: string, processedAt: Date): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: { status: "processed", processedAt, error: null },
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    try {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: { status: "failed", error },
      });
    } catch (caught) {
      if (isMissing(caught)) return;
      throw caught;
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

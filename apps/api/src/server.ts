import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "./generated/prisma/client.js";
import { QUEUE_NAMES, SERVICE_NAMES } from "@releaseops/shared";
import { PrismaAuthRepository } from "./auth/prisma-repository.js";
import { PrismaBuildRepository } from "./builds/prisma-repository.js";
import { PrismaProjectRepository } from "./projects/prisma-repository.js";
import { BullMqWebhookQueue } from "./webhooks/bullmq-queue.js";
import { PrismaWebhookRepository } from "./webhooks/prisma-repository.js";
import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

// pnpm runs this package with cwd apps/api. The repo-root .env is two levels up.
// Existing process env (Docker, CI) is left untouched because dotenv does not override.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv });
}

const env = loadEnv();
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const jobs = new Queue(QUEUE_NAMES.jobs, { connection });

const app = await buildApp({
  logLevel: env.LOG_LEVEL,
  webOrigin: env.WEB_ORIGIN,
  service: SERVICE_NAMES.api,
  version: env.APP_VERSION,
  auth: {
    repository: new PrismaAuthRepository(prisma),
    secureCookies: env.NODE_ENV === "production",
  },
  projects: {
    repository: new PrismaProjectRepository(prisma),
  },
  builds: {
    repository: new PrismaBuildRepository(prisma),
  },
  webhooks: {
    repository: new PrismaWebhookRepository(prisma),
    queue: new BullMqWebhookQueue(jobs),
  },
  checkReady: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

let shuttingDown = false;

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await app.close();
    await jobs.close();
    await connection.quit();
    await prisma.$disconnect();
  } finally {
    process.exit(exitCode);
  }
}

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (error) {
  app.log.error(error);
  await shutdown(1);
}

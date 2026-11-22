import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Worker } from "bullmq";
import { config as loadDotenv } from "dotenv";
import { Redis } from "ioredis";
import pino from "pino";
import { QUEUE_NAMES, SERVICE_NAMES } from "@releaseops/shared";
import { PrismaClient } from "./generated/prisma/client.js";
import { handleJob } from "./builds/process.js";
import { PrismaBuildRepository } from "./builds/prisma-repository.js";
import { loadWorkerConfig } from "./config.js";

const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv });
}

const config = loadWorkerConfig();
const logger = pino({ level: config.logLevel, base: { service: SERVICE_NAMES.worker } });

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: config.databaseUrl }),
});
const builds = new PrismaBuildRepository(prisma);

const worker = new Worker(
  QUEUE_NAMES.jobs,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name }, "received job");
    await handleJob(job.name, job.data, builds);
  },
  { connection },
);

worker.on("ready", () => {
  logger.info({ queue: QUEUE_NAMES.jobs }, "worker ready");
});

worker.on("error", (error) => {
  logger.error({ err: error }, "worker error");
});

worker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, err: error }, "job failed");
});

let shuttingDown = false;

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await worker.close();
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

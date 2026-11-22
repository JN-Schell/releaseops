import { z } from "zod";

const workerEnvSchema = z.object({
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface WorkerConfig {
  redisUrl: string;
  databaseUrl: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = workerEnvSchema.safeParse({
    REDIS_URL: env.REDIS_URL,
    DATABASE_URL: env.DATABASE_URL,
    ...(env.LOG_LEVEL ? { LOG_LEVEL: env.LOG_LEVEL } : {}),
  });
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${details}`);
  }
  return {
    redisUrl: parsed.data.REDIS_URL,
    databaseUrl: parsed.data.DATABASE_URL,
    logLevel: parsed.data.LOG_LEVEL,
  };
}

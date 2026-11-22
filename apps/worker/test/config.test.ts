import { describe, expect, it } from "vitest";
import { loadWorkerConfig } from "../src/config.js";

describe("loadWorkerConfig", () => {
  it("defaults the log level", () => {
    const config = loadWorkerConfig({
      REDIS_URL: "redis://localhost:6379",
      DATABASE_URL: "postgresql://releaseops:releaseops@localhost:5432/releaseops",
    });
    expect(config).toEqual({
      redisUrl: "redis://localhost:6379",
      databaseUrl: "postgresql://releaseops:releaseops@localhost:5432/releaseops",
      logLevel: "info",
    });
  });

  it("requires a redis url", () => {
    expect(() => loadWorkerConfig({})).toThrow(/REDIS_URL/);
    expect(() => loadWorkerConfig({ REDIS_URL: "redis://localhost:6379" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an unknown log level", () => {
    expect(() =>
      loadWorkerConfig({
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgresql://releaseops:releaseops@localhost:5432/releaseops",
        LOG_LEVEL: "loud",
      }),
    ).toThrow(/LOG_LEVEL/);
  });
});

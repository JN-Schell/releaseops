export const SERVICE_NAMES = {
  api: "releaseops-api",
  worker: "releaseops-worker",
  web: "releaseops-web",
} as const;

export const QUEUE_NAMES = {
  jobs: "releaseops",
} as const;

export const JOB_NAMES = {
  githubWebhook: "github.webhook",
} as const;

export const GITHUB_WEBHOOK_EVENTS = ["workflow_run", "push", "deployment_status"] as const;

export type GithubWebhookEvent = (typeof GITHUB_WEBHOOK_EVENTS)[number];

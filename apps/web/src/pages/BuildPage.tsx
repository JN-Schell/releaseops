import { useQuery } from "@tanstack/react-query";
import type { BuildDetail } from "@releaseops/shared";
import { Link, useParams } from "react-router-dom";
import { fetchBuild } from "../api/client";

export function BuildPage() {
  const params = useParams();
  const id = params.id ?? "";
  const build = useQuery({
    queryKey: ["build", id],
    queryFn: () => fetchBuild(id),
    enabled: id.length > 0,
    retry: false,
  });

  if (build.isPending) return <p className="text-sm text-zinc-400">Loading build.</p>;
  if (build.isError || !build.data) {
    return <p className="text-sm text-red-300">That build could not be loaded.</p>;
  }

  const current = build.data;
  const subject = current.commitMessage?.split("\n")[0] || current.commitSha.slice(0, 7);

  return (
    <section>
      <p className="text-sm text-zinc-400">
        <Link to={`/projects/${current.project.slug}`} className="hover:text-zinc-200">
          {current.project.name}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{subject}</h1>
      <p className="mt-2 text-sm text-zinc-400">
        {current.branch} · {current.status.replaceAll("_", " ")}
        {current.conclusion ? ` · ${current.conclusion}` : ""}
      </p>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-400">Commit</dt>
          <dd className="mt-1 font-mono text-zinc-100">{current.commitSha}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Author</dt>
          <dd className="mt-1">{current.author ?? "Unknown"}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">Duration</dt>
          <dd className="mt-1">{formatDuration(current.durationMs)}</dd>
        </div>
        <div>
          <dt className="text-zinc-400">GitHub run</dt>
          <dd className="mt-1">
            {current.url?.startsWith("https://") ? (
              <a
                href={current.url}
                className="text-emerald-300 hover:text-emerald-200"
                rel="noreferrer"
              >
                Open run
              </a>
            ) : (
              "No run link"
            )}
          </dd>
        </div>
      </dl>
      {current.commitMessage ? (
        <pre className="mt-6 whitespace-pre-wrap rounded-lg border border-white/10 p-4 text-sm text-zinc-200">
          {current.commitMessage}
        </pre>
      ) : null}
      <h2 className="mt-8 text-lg font-semibold">Deployments</h2>
      {current.deployments.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-400">No deployments have used this build.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/10 rounded-lg border border-white/10">
          {current.deployments.map((deployment) => (
            <li key={deployment.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <span>{deployment.environmentName}</span>
              <span className="text-zinc-400">{deployment.status.replaceAll("_", " ")}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatDuration(durationMs: BuildDetail["durationMs"]): string {
  if (durationMs === null) return "Not finished";
  const seconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

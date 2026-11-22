import { useInfiniteQuery } from "@tanstack/react-query";
import type { BuildStatus } from "@releaseops/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjectBuilds } from "../api/client";
import { fieldClass, quietButtonClass } from "../ui";

const statuses: Array<BuildStatus | ""> = [
  "",
  "queued",
  "in_progress",
  "success",
  "failure",
  "cancelled",
];

export function ProjectBuilds(props: { projectId: string }) {
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState<BuildStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({
    branch: "",
    status: "" as BuildStatus | "",
    from: "",
    to: "",
  });
  const builds = useInfiniteQuery({
    queryKey: ["builds", props.projectId, applied],
    queryFn: ({ pageParam }) =>
      fetchProjectBuilds(props.projectId, {
        branch: applied.branch || undefined,
        status: applied.status || undefined,
        from: applied.from ? new Date(applied.from).toISOString() : undefined,
        to: applied.to ? new Date(applied.to).toISOString() : undefined,
        cursor: pageParam,
        limit: 20,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const rows = builds.data?.pages.flatMap((page) => page.data) ?? [];
  const filtered = Boolean(applied.branch || applied.status || applied.from || applied.to);

  return (
    <div className="mt-6">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied({ branch: branch.trim(), status, from, to });
        }}
      >
        <label className="flex w-40 flex-col gap-1.5 text-sm">
          <span className="font-medium">Branch</span>
          <input
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex w-40 flex-col gap-1.5 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as BuildStatus | "")}
            className={fieldClass}
          >
            {statuses.map((value) => (
              <option key={value || "all"} value={value}>
                {value ? labelStatus(value) : "Any"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">From</span>
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">To</span>
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={fieldClass}
          />
        </label>
        <button type="submit" className={quietButtonClass}>
          Apply
        </button>
      </form>
      {builds.isPending ? <p className="mt-6 text-sm text-zinc-400">Loading builds.</p> : null}
      {builds.isError ? (
        <p className="mt-6 text-sm text-red-300">Builds could not be loaded.</p>
      ) : null}
      {builds.data && rows.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-400">
          {filtered ? "No builds match these filters." : "No builds have arrived yet."}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="mt-6 divide-y divide-white/10 rounded-lg border border-white/10">
          {rows.map((build) => (
            <li key={build.id}>
              <Link
                to={`/builds/${build.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-white/5"
              >
                <span>
                  <span className="font-medium">
                    {build.commitMessage?.split("\n")[0] || build.commitSha.slice(0, 7)}
                  </span>
                  <span className="mt-1 block text-sm text-zinc-400">
                    {build.branch} · {build.commitSha.slice(0, 7)}
                    {build.author ? ` · ${build.author}` : ""}
                  </span>
                </span>
                <StatusBadge status={build.status} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {builds.hasNextPage ? (
        <button
          type="button"
          className={`${quietButtonClass} mt-4`}
          disabled={builds.isFetchingNextPage}
          onClick={() => void builds.fetchNextPage()}
        >
          Older builds
        </button>
      ) : null}
    </div>
  );
}

function StatusBadge(props: { status: BuildStatus }) {
  const tone =
    props.status === "success"
      ? "text-emerald-300"
      : props.status === "failure"
        ? "text-red-300"
        : props.status === "in_progress"
          ? "text-amber-200"
          : "text-zinc-400";
  return <span className={`text-sm ${tone}`}>{labelStatus(props.status)}</span>;
}

function labelStatus(status: BuildStatus): string {
  return status.replaceAll("_", " ");
}

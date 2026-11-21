import { useQuery } from "@tanstack/react-query";
import { can } from "@releaseops/shared";
import { Link } from "react-router-dom";
import { fetchProjects } from "../api/client";
import { useSession } from "../auth/session";
import { primaryButtonClass } from "../ui";

export function ProjectsPage() {
  const session = useSession();
  const user = session.data;
  const canCreate = user ? can(user, "project:create") : false;
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    enabled: Boolean(user),
    retry: false,
  });

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-sm text-zinc-400">GitHub repositories ReleaseOps can watch.</p>
        </div>
        {canCreate ? (
          <Link to="/projects/new" className={primaryButtonClass}>
            New project
          </Link>
        ) : null}
      </div>
      {projects.isPending ? <p className="mt-8 text-sm text-zinc-400">Loading projects.</p> : null}
      {projects.isError ? (
        <p className="mt-8 text-sm text-red-300">Projects could not be loaded.</p>
      ) : null}
      {projects.data && projects.data.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-400">No projects yet.</p>
      ) : null}
      {projects.data && projects.data.length > 0 ? (
        <ul className="mt-8 divide-y divide-white/10 rounded-lg border border-white/10">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link
                to={`/projects/${project.slug}`}
                className="block px-4 py-3 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
              >
                <span className="font-medium">{project.name}</span>
                <span className="ml-3 text-sm text-zinc-400">
                  {project.githubOwner}/{project.githubRepo}
                </span>
                <span className="mt-1 block text-sm text-zinc-400">
                  {project.environments.length === 0
                    ? "No environments"
                    : project.environments.map((environment) => environment.name).join(", ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

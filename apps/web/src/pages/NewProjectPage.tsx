import { useMutation } from "@tanstack/react-query";
import { can } from "@releaseops/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, createProject } from "../api/client";
import { useSession } from "../auth/session";
import { LabelInput } from "../components/LabelInput";
import { fieldClass, primaryButtonClass } from "../ui";

export function NewProjectPage() {
  const session = useSession();
  const user = session.data;
  const allowed = user ? can(user, "project:create") : false;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const created = useMutation({
    mutationFn: () =>
      createProject({
        name,
        githubOwner,
        githubRepo,
        defaultBranch,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : "Unable to create the project.");
    },
  });

  if (!allowed) {
    return (
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="mt-3 text-sm text-zinc-400">Only an administrator can create projects.</p>
      </section>
    );
  }

  if (created.data) {
    return (
      <section className="max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Webhook secret</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Copy this secret into GitHub. It stays available to administrators on the project settings
          page.
        </p>
        <label className="mt-6 flex flex-col gap-1.5 text-sm" htmlFor="webhook-secret">
          <span className="font-medium">Secret</span>
          <input
            id="webhook-secret"
            readOnly
            value={created.data.webhook.secret}
            className={fieldClass}
          />
        </label>
        <pre className="mt-4 whitespace-pre-wrap rounded-md border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
          {created.data.webhook.instructions}
        </pre>
        <Link
          to={`/projects/${created.data.project.slug}`}
          className={`${primaryButtonClass} mt-6 inline-block`}
        >
          Open project
        </Link>
      </section>
    );
  }

  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <form
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          created.mutate();
        }}
      >
        <LabelInput label="Name" name="name" value={name} onChange={setName} />
        <label className="flex flex-col gap-1.5 text-sm" htmlFor="description">
          <span className="font-medium">Description</span>
          <textarea
            id="description"
            name="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={fieldClass}
            rows={3}
          />
        </label>
        <LabelInput
          label="GitHub owner"
          name="githubOwner"
          value={githubOwner}
          onChange={setGithubOwner}
          autoComplete="off"
        />
        <LabelInput
          label="GitHub repository"
          name="githubRepo"
          value={githubRepo}
          onChange={setGithubRepo}
          autoComplete="off"
        />
        <LabelInput
          label="Default branch"
          name="defaultBranch"
          value={defaultBranch}
          onChange={setDefaultBranch}
          autoComplete="off"
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button type="submit" className={primaryButtonClass} disabled={created.isPending}>
          Create project
        </button>
      </form>
    </section>
  );
}

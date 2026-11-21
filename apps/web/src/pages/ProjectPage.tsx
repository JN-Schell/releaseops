import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { can } from "@releaseops/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  createEnvironment,
  deleteEnvironment,
  deleteProject,
  fetchProjectBySlug,
  updateEnvironment,
  updateProject,
} from "../api/client";
import { useSession } from "../auth/session";
import { LabelInput } from "../components/LabelInput";
import { fieldClass, primaryButtonClass, quietButtonClass } from "../ui";

type Tab = "overview" | "environments" | "settings";

export function ProjectPage() {
  const params = useParams();
  const slug = params.slug ?? "";
  const session = useSession();
  const user = session.data;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const project = useQuery({
    queryKey: ["project", slug],
    queryFn: () => fetchProjectBySlug(slug),
    enabled: slug.length > 0,
    retry: false,
  });
  const canUpdate = user ? can(user, "project:update") : false;
  const canDelete = user ? can(user, "project:delete") : false;
  const canManageEnvironments = user ? can(user, "env:manage") : false;

  function refresh() {
    setError(null);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", slug] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    ]);
  }

  const saveProject = useMutation({
    mutationFn: (input: { name: string; description: string; defaultBranch: string }) => {
      if (!project.data) throw new Error("Project is not loaded");
      return updateProject(project.data.id, {
        name: input.name,
        description: input.description.trim() ? input.description.trim() : null,
        defaultBranch: input.defaultBranch,
      });
    },
    onSuccess: async (updated) => {
      if (updated.slug !== slug) await navigate(`/projects/${updated.slug}`);
      await refresh();
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : "Unable to save the project.");
    },
  });

  const removeProject = useMutation({
    mutationFn: () => {
      if (!project.data) throw new Error("Project is not loaded");
      return deleteProject(project.data.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      await navigate("/projects");
    },
    onError: (caught) => {
      setError(caught instanceof ApiError ? caught.message : "Unable to delete the project.");
    },
  });

  if (project.isPending) return <p className="text-sm text-zinc-400">Loading project.</p>;
  if (project.isError || !project.data) {
    return <p className="text-sm text-red-300">That project could not be loaded.</p>;
  }

  const current = project.data;

  return (
    <section>
      <p className="text-sm text-zinc-400">
        <Link to="/projects" className="hover:text-zinc-200">
          Projects
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{current.name}</h1>
      <p className="mt-1 text-sm text-zinc-400">
        {current.githubOwner}/{current.githubRepo}
      </p>
      <div className="mt-6 flex gap-2" role="tablist">
        {(
          [
            ["overview", "Overview"],
            ["environments", "Environments"],
            ["settings", "Settings"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? primaryButtonClass : quietButtonClass}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
      {tab === "overview" ? (
        <div className="mt-6 text-sm text-zinc-300">
          <p>{current.description ?? "No description."}</p>
          <p className="mt-3 text-zinc-400">Default branch: {current.defaultBranch}</p>
        </div>
      ) : null}
      {tab === "environments" ? (
        <Environments
          projectId={current.id}
          environments={current.environments}
          canManage={canManageEnvironments}
          onChange={refresh}
          onError={setError}
        />
      ) : null}
      {tab === "settings" ? (
        <Settings
          project={current}
          canUpdate={canUpdate}
          canDelete={canDelete}
          pendingSave={saveProject.isPending}
          pendingDelete={removeProject.isPending}
          onSave={(input) => saveProject.mutate(input)}
          onDelete={() => removeProject.mutate()}
        />
      ) : null}
    </section>
  );
}

function Environments(props: {
  projectId: string;
  environments: Array<{
    id: string;
    name: string;
    order: number;
    requiresApproval: boolean;
    requiredApprovals: number;
    deployWorkflowFile: string | null;
  }>;
  canManage: boolean;
  onChange: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [order, setOrder] = useState(String(props.environments.length));
  const add = useMutation({
    mutationFn: () =>
      createEnvironment(props.projectId, {
        name,
        order: Number(order),
        requiresApproval: false,
        requiredApprovals: 1,
      }),
    onSuccess: async () => {
      setName("");
      setOrder(String(Number(order) + 1));
      await props.onChange();
    },
    onError: (caught) => {
      props.onError(caught instanceof ApiError ? caught.message : "Unable to add the environment.");
    },
  });

  return (
    <div className="mt-6">
      {props.environments.length === 0 ? (
        <p className="text-sm text-zinc-400">No environments yet.</p>
      ) : (
        <ul className="divide-y divide-white/10 rounded-lg border border-white/10">
          {props.environments.map((environment) => (
            <EnvironmentRow
              key={environment.id}
              environment={environment}
              canManage={props.canManage}
              onChange={props.onChange}
              onError={props.onError}
            />
          ))}
        </ul>
      )}
      {props.canManage ? (
        <form
          className="mt-6 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <LabelInput label="Name" name="environment-name" value={name} onChange={setName} />
          <label className="flex w-24 flex-col gap-1.5 text-sm" htmlFor="environment-order">
            <span className="font-medium">Order</span>
            <input
              id="environment-order"
              type="number"
              min={0}
              required
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              className={fieldClass}
            />
          </label>
          <button type="submit" className={primaryButtonClass} disabled={add.isPending}>
            Add environment
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-zinc-400">Only an administrator can change environments.</p>
      )}
    </div>
  );
}

function EnvironmentRow(props: {
  environment: {
    id: string;
    name: string;
    order: number;
    requiresApproval: boolean;
    requiredApprovals: number;
    deployWorkflowFile: string | null;
  };
  canManage: boolean;
  onChange: () => Promise<unknown>;
  onError: (message: string) => void;
}) {
  const [requiresApproval, setRequiresApproval] = useState(props.environment.requiresApproval);
  const [requiredApprovals, setRequiredApprovals] = useState(
    String(props.environment.requiredApprovals),
  );
  const [workflow, setWorkflow] = useState(props.environment.deployWorkflowFile ?? "");
  const save = useMutation({
    mutationFn: () =>
      updateEnvironment(props.environment.id, {
        requiresApproval,
        requiredApprovals: Number(requiredApprovals),
        deployWorkflowFile: workflow.trim() ? workflow.trim() : null,
      }),
    onSuccess: () => props.onChange(),
    onError: (caught) => {
      props.onError(
        caught instanceof ApiError ? caught.message : "Unable to save the environment.",
      );
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteEnvironment(props.environment.id),
    onSuccess: () => props.onChange(),
    onError: (caught) => {
      props.onError(
        caught instanceof ApiError ? caught.message : "Unable to delete the environment.",
      );
    },
  });

  return (
    <li className="flex flex-wrap items-end gap-3 px-4 py-3 text-sm">
      <div>
        <p className="font-medium">{props.environment.name}</p>
        <p className="text-zinc-400">Order {props.environment.order}</p>
      </div>
      {props.canManage ? (
        <>
          <label className="flex items-center gap-2" htmlFor={`approval-${props.environment.id}`}>
            <input
              id={`approval-${props.environment.id}`}
              type="checkbox"
              checked={requiresApproval}
              onChange={(event) => setRequiresApproval(event.target.checked)}
            />
            Requires approval
          </label>
          <label className="flex flex-col gap-1.5" htmlFor={`count-${props.environment.id}`}>
            <span>Approvals</span>
            <input
              id={`count-${props.environment.id}`}
              type="number"
              min={1}
              max={10}
              value={requiredApprovals}
              onChange={(event) => setRequiredApprovals(event.target.value)}
              className={`${fieldClass} w-20`}
            />
          </label>
          <label
            className="flex min-w-56 flex-1 flex-col gap-1.5"
            htmlFor={`workflow-${props.environment.id}`}
          >
            <span>Deploy workflow</span>
            <input
              id={`workflow-${props.environment.id}`}
              value={workflow}
              onChange={(event) => setWorkflow(event.target.value)}
              className={fieldClass}
            />
          </label>
          <button type="button" className={quietButtonClass} onClick={() => save.mutate()}>
            Save
          </button>
          <button type="button" className={quietButtonClass} onClick={() => remove.mutate()}>
            Delete
          </button>
        </>
      ) : (
        <p className="text-zinc-400">
          {props.environment.requiresApproval
            ? `${props.environment.requiredApprovals} approvals`
            : "No approval"}
          {props.environment.deployWorkflowFile ? ` · ${props.environment.deployWorkflowFile}` : ""}
        </p>
      )}
    </li>
  );
}

function Settings(props: {
  project: {
    name: string;
    description: string | null;
    defaultBranch: string;
    slug: string;
    webhookSecret?: string;
  };
  canUpdate: boolean;
  canDelete: boolean;
  pendingSave: boolean;
  pendingDelete: boolean;
  onSave: (input: { name: string; description: string; defaultBranch: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(props.project.name);
  const [description, setDescription] = useState(props.project.description ?? "");
  const [defaultBranch, setDefaultBranch] = useState(props.project.defaultBranch);
  const [confirming, setConfirming] = useState(false);

  if (!props.canUpdate) {
    return (
      <p className="mt-6 text-sm text-zinc-400">Only an administrator can change this project.</p>
    );
  }

  return (
    <form
      className="mt-6 flex max-w-xl flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave({ name, description, defaultBranch });
      }}
    >
      <LabelInput label="Name" name="project-name" value={name} onChange={setName} />
      <p className="text-sm text-zinc-400">The address stays /projects/{props.project.slug}.</p>
      <label className="flex flex-col gap-1.5 text-sm" htmlFor="project-description">
        <span className="font-medium">Description</span>
        <textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className={fieldClass}
          rows={3}
        />
      </label>
      <LabelInput
        label="Default branch"
        name="project-branch"
        value={defaultBranch}
        onChange={setDefaultBranch}
        autoComplete="off"
      />
      {props.project.webhookSecret ? (
        <label className="flex flex-col gap-1.5 text-sm" htmlFor="stored-secret">
          <span className="font-medium">Webhook secret</span>
          <input
            id="stored-secret"
            readOnly
            value={props.project.webhookSecret}
            className={fieldClass}
          />
        </label>
      ) : null}
      <button type="submit" className={primaryButtonClass} disabled={props.pendingSave}>
        Save changes
      </button>
      {props.canDelete ? (
        <button
          type="button"
          className={quietButtonClass}
          disabled={props.pendingDelete}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            props.onDelete();
          }}
        >
          {confirming ? "Confirm delete" : "Delete project"}
        </button>
      ) : null}
    </form>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProject,
  fetchProjects,
  findUnsortedSubproject,
  setSubprojectCrates,
  type ProjectDetail,
} from "../lib/projectBookApi";

export default function AssignSelectionBar({
  crateIds,
  projectId,
  defaultSubTitle = "Unsorted",
  onAssigned,
}: {
  crateIds: string[];
  projectId: string | null;
  defaultSubTitle?: string;
  onAssigned?: () => void;
}) {
  const qc = useQueryClient();
  const [pickedProject, setPickedProject] = useState("");
  const [pickedSub, setPickedSub] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["project-book-projects"],
    queryFn: fetchProjects,
  });
  const projectQuery = useQuery({
    queryKey: ["project-book-project", projectId],
    queryFn: () => fetchProject(projectId!),
    enabled: Boolean(projectId),
  });

  const projects = projectsQuery.data?.projects ?? [];
  const project = projectQuery.data;

  const subOptions = useMemo(() => {
    if (!project) return [];
    return [...project.subprojects].sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [project]);

  const defaultSubId = project
    ? findUnsortedSubproject(project, defaultSubTitle)?.id ?? ""
    : "";

  const mut = useMutation({
    mutationFn: async () => {
      if (!crateIds.length) throw new Error("Nothing selected");
      let targetId = "";
      let label = "";
      if (projectId) {
        const detail = project ?? (await fetchProject(projectId));
        const subId = pickedSub || defaultSubId;
        const sub = detail.subprojects.find((s) => s.id === subId);
        if (!sub) throw new Error("Choose a subproject");
        targetId = sub.id;
        label = `${detail.title} / ${sub.title}`;
      } else {
        const pid = pickedProject || projects[0]?.id;
        if (!pid) throw new Error("Choose a project");
        const detail: ProjectDetail = await fetchProject(pid);
        const sub = findUnsortedSubproject(detail, defaultSubTitle);
        if (!sub) throw new Error("Project has no Unsorted subproject");
        targetId = sub.id;
        label = `${detail.title} / ${sub.title}`;
      }
      await setSubprojectCrates(targetId, { add: crateIds });
      return label;
    },
    onSuccess: async (label) => {
      setMessage(`Filed ${crateIds.length} crate${crateIds.length === 1 ? "" : "s"} into ${label}.`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project-book-projects"] }),
        qc.invalidateQueries({ queryKey: ["project-book-project"] }),
        qc.invalidateQueries({ queryKey: ["project-book-placements"] }),
      ]);
      onAssigned?.();
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const n = crateIds.length;
  const disabled = n === 0 || mut.isPending;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {projectId ? (
        <select
          value={pickedSub || defaultSubId}
          onChange={(e) => setPickedSub(e.target.value)}
          className="rounded-md bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-slate-100"
          disabled={!subOptions.length}
        >
          {subOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={pickedProject}
          onChange={(e) => setPickedProject(e.target.value)}
          className="rounded-md bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-slate-100"
        >
          <option value="">Choose project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        disabled={disabled || (!projectId && !pickedProject)}
        onClick={() => {
          setMessage(null);
          mut.mutate();
        }}
        className="px-3 py-1.5 rounded-md bg-emerald-800 text-emerald-50 text-sm hover:bg-emerald-700 disabled:opacity-40"
      >
        {mut.isPending
          ? "Assigning…"
          : projectId
            ? `Assign ${n} to subproject`
            : `Assign ${n} to project`}
      </button>
      {message ? (
        <span className="text-xs text-slate-400">{message}</span>
      ) : null}
    </div>
  );
}

/**
 * Crate detail "Actions" tab — jobs for this crate from agent_server + results.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { Paper } from "@blueskyproject/finch";
import {
  AGENT_SERVER_CHANGED,
  agentHealth,
  getAgentUrl,
  getJobOutputFile,
  listAgents,
  listJobOutputFiles,
  listJobs,
  type JobListItem,
} from "../lib/agentApi";
import { shortId } from "../lib/tiledCrates";
import type { CrateActionsConfig } from "../lib/schema";
import type { AgentDisplaySpec } from "../lib/displayModule";
import { normalizeAgentDisplay, preferResultPath } from "../lib/displayModule";
import AgentDisplayView from "./AgentDisplayView";

function statusClass(status: string): string {
  if (status === "completed") return "text-emerald-300";
  if (status === "failed" || status === "timed_out") return "text-rose-300";
  if (status === "cancelled") return "text-amber-300";
  return "text-sky-300";
}

function JobResultPanel({
  job,
  preferredFiles,
  display,
  agentLabel,
}: {
  job: JobListItem;
  preferredFiles?: string[];
  display?: AgentDisplaySpec;
  agentLabel: string;
}) {
  const [open, setOpen] = useState(job.status === "completed");
  const filesQuery = useQuery({
    queryKey: ["job-output-files", job.job_uuid],
    queryFn: () => listJobOutputFiles(job.job_uuid),
    enabled: open && job.status === "completed",
    retry: false,
  });

  const filePaths = useMemo(
    () => (filesQuery.data ?? []).map((f) => f.path),
    [filesQuery.data],
  );
  const selectedPath = preferResultPath(display, preferredFiles, filePaths);

  const resultQuery = useQuery({
    queryKey: ["job-output-file", job.job_uuid, selectedPath],
    queryFn: () => getJobOutputFile(job.job_uuid, selectedPath!),
    enabled: Boolean(open && selectedPath),
    retry: false,
  });

  return (
    <div className="rounded-lg border border-slate-600/80 bg-slate-950/50">
      <button
        type="button"
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-slate-800/50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mt-1 text-slate-400">
          {open ? <CaretDown size={18} /> : <CaretRight size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-slate-100 truncate">
              {agentLabel}
            </span>
            <span
              className={`text-sm font-mono font-medium ${statusClass(job.status)}`}
            >
              {job.status}
              {job.phase ? ` · ${job.phase}` : ""}
            </span>
          </div>
          <div className="text-sm font-mono text-slate-400 mt-1 truncate">
            job {shortId(job.job_uuid)}
            {job.created_at ? ` · ${job.created_at}` : ""}
          </div>
          {job.error_message ? (
            <p className="text-sm text-rose-300 mt-2">{job.error_message}</p>
          ) : null}
        </div>
      </button>

      {open ? (
        <div className="border-t border-slate-700 px-4 py-4 space-y-3">
          {job.status !== "completed" ? (
            <p className="text-base text-slate-400">
              Results appear when the job completes.
            </p>
          ) : filesQuery.isLoading ? (
            <p className="text-base text-slate-400">Loading output files…</p>
          ) : filesQuery.error ? (
            <p className="text-base text-rose-300">{String(filesQuery.error)}</p>
          ) : !selectedPath ? (
            <p className="text-base text-slate-400">No output files found.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {filePaths
                  .filter((p) => p !== "ro-crate-metadata.json")
                  .map((p) => (
                    <span
                      key={p}
                      className={`text-sm font-mono px-2 py-1 rounded-md border ${
                        p === selectedPath
                          ? "border-sky-500 text-sky-100 bg-sky-950/50"
                          : "border-slate-600 text-slate-400"
                      }`}
                    >
                      {p}
                    </span>
                  ))}
              </div>
              {resultQuery.isLoading ? (
                <p className="text-base text-slate-400">
                  Loading {selectedPath}…
                </p>
              ) : resultQuery.error ? (
                <p className="text-base text-rose-300">
                  {String(resultQuery.error)}
                </p>
              ) : resultQuery.data?.data != null ? (
                display ? (
                  <AgentDisplayView
                    display={display}
                    data={resultQuery.data.data}
                    jobUuid={job.job_uuid}
                  />
                ) : (
                  <pre className="text-sm font-mono text-slate-200 bg-slate-900/80 rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap border border-slate-700">
                    {JSON.stringify(resultQuery.data.data, null, 2)}
                  </pre>
                )
              ) : resultQuery.data?.text != null ? (
                <pre className="text-sm font-mono text-slate-200 bg-slate-900/80 rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap border border-slate-700">
                  {resultQuery.data.text}
                </pre>
              ) : (
                <p className="text-base text-slate-400">
                  {resultQuery.data?.error ?? "No preview available"}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function CrateActionsPanel({
  crateUuid,
  config,
}: {
  crateUuid: string;
  config: CrateActionsConfig;
}) {
  const agentUrl = getAgentUrl();
  const [, bump] = useState(0);
  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    window.addEventListener(AGENT_SERVER_CHANGED, onChange);
    return () => window.removeEventListener(AGENT_SERVER_CHANGED, onChange);
  }, []);

  const healthQuery = useQuery({
    queryKey: ["agent-probe", agentUrl, bump],
    queryFn: () => agentHealth(agentUrl),
    retry: false,
  });

  const agentsQuery = useQuery({
    queryKey: ["agent-list", agentUrl],
    queryFn: () => listAgents(agentUrl),
    enabled: healthQuery.data?.ok === true,
    retry: false,
  });

  const jobsQuery = useQuery({
    queryKey: ["crate-jobs", crateUuid, agentUrl],
    queryFn: () => listJobs({ crateUuid, limit: 100 }),
    enabled: healthQuery.data?.ok === true,
    retry: false,
    refetchInterval: 5_000,
  });

  const agentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentsQuery.data ?? []) {
      map.set(a.agent_uuid, a.name);
    }
    return map;
  }, [agentsQuery.data]);

  const title = config.title ?? "Actions";

  if (healthQuery.isLoading) {
    return <p className="text-base text-slate-400">Checking agent server…</p>;
  }
  if (!healthQuery.data?.ok) {
    return (
      <Paper className="p-4 text-base text-amber-200">
        Agent server unavailable ({healthQuery.data?.detail ?? "offline"}). Set
        the URL under Setup to load {title.toLowerCase()} for this crate.
      </Paper>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold uppercase tracking-wide text-sky-200">
            {title}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Jobs from {agentUrl} whose inputs reference this crate.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-slate-100 px-2 py-1 rounded-md hover:bg-slate-800"
          onClick={() => void jobsQuery.refetch()}
        >
          <ArrowClockwise size={16} /> Refresh
        </button>
      </div>

      {jobsQuery.isLoading ? (
        <p className="text-base text-slate-400">Loading jobs…</p>
      ) : jobsQuery.error ? (
        <Paper className="p-4 text-base text-rose-300">
          {String(jobsQuery.error)}
        </Paper>
      ) : !(jobsQuery.data?.length) ? (
        <Paper className="p-4 text-base text-slate-400">
          No agent jobs yet for this crate. Run one from the{" "}
          <span className="text-slate-300">Action queue</span>.
        </Paper>
      ) : (
        <div className="space-y-3">
          {jobsQuery.data.map((job) => (
            <JobResultPanel
              key={job.job_uuid}
              job={job}
              preferredFiles={config.result_files}
              display={
                job.agent_uuid
                  ? normalizeAgentDisplay(config.agents?.[job.agent_uuid])
                  : undefined
              }
              agentLabel={
                agentName.get(job.agent_uuid ?? "") ??
                job.agent_uuid ??
                "unknown agent"
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

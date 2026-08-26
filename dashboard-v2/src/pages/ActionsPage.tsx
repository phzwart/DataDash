import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { Lightning, ArrowClockwise, Play } from "@phosphor-icons/react";
import {
  AGENT_SERVER_CHANGED,
  agentHealth,
  getAgentUrl,
  listAgents,
  submitJob,
  waitForJob,
  type AgentSummary,
} from "../lib/agentApi";
import {
  assembleParameters,
  buildAgentJobRequest,
  formFields,
  type FieldResolution,
} from "../lib/agentRequest";
import { getCartIds, subscribeCart } from "../lib/crateCart";
import { getFacilityUrl } from "../lib/facilityApi";
import { getHydrateUrl } from "../lib/hydrateApi";
import { fetchCrates, shortId, type CrateSummary } from "../lib/tiledCrates";

function inputSummary(agent: AgentSummary): string {
  const items = agent.input_items ?? [];
  if (!items.length) return "No declared inputs";
  return items
    .map((i) => `${i.name}:${i.type}${i.required === false ? "?" : ""}`)
    .join(", ");
}

function sourceBadge(source: FieldResolution["source"]): string {
  if (source === "from") return "from crate";
  if (source === "default") return "default";
  if (source === "override") return "edited";
  return "missing";
}

function fieldToDraftValue(value: unknown, typeName?: string): string {
  if (value == null) return "";
  if (typeName === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function draftToValue(raw: string, typeName?: string): unknown {
  const t = typeName ?? "auto";
  if (t === "boolean") {
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  }
  if (t === "number") return Number(raw);
  if (t === "array") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.split(/[\s,]+/).filter(Boolean).map(Number);
    }
  }
  if (raw.trim().startsWith("[") || raw.trim().startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export default function ActionsPage() {
  const queryClient = useQueryClient();
  const agentUrl = getAgentUrl();
  const [cartIds, setCartIds] = useState(() => getCartIds());
  const [selectedAgentUuid, setSelectedAgentUuid] = useState<string | null>(
    null,
  );
  const [selectedCrateId, setSelectedCrateId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [activeJobUuid, setActiveJobUuid] = useState<string | null>(null);

  useEffect(() => subscribeCart(() => setCartIds(getCartIds())), []);

  const healthQuery = useQuery({
    queryKey: ["agent-probe", agentUrl],
    queryFn: () => agentHealth(agentUrl),
    retry: false,
  });

  const agentsQuery = useQuery({
    queryKey: ["agent-list", agentUrl],
    queryFn: () => listAgents(agentUrl),
    enabled: healthQuery.data?.ok === true,
    retry: false,
  });

  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: fetchCrates,
  });

  useEffect(() => {
    const onChange = () => {
      void queryClient.invalidateQueries({ queryKey: ["agent-probe"] });
      void queryClient.invalidateQueries({ queryKey: ["agent-list"] });
    };
    window.addEventListener(AGENT_SERVER_CHANGED, onChange);
    return () => window.removeEventListener(AGENT_SERVER_CHANGED, onChange);
  }, [queryClient]);

  const agents = agentsQuery.data ?? [];
  const reachable = healthQuery.data?.ok === true;
  const selectedAgent =
    agents.find((a) => a.agent_uuid === selectedAgentUuid) ?? null;

  const cratesById = useMemo(() => {
    const map = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) map.set(c.id, c);
    return map;
  }, [cratesQuery.data]);

  const crateChoices = useMemo(() => {
    return cartIds.map((id) => ({
      id,
      crate: cratesById.get(id) ?? { id, metadata: {} },
    }));
  }, [cartIds, cratesById]);

  // Drop selection if the crate left the action queue.
  useEffect(() => {
    if (selectedCrateId && !cartIds.includes(selectedCrateId)) {
      setSelectedCrateId(null);
      setOverrides({});
    }
  }, [cartIds, selectedCrateId]);

  const selectedCrate = selectedCrateId
    ? (cratesById.get(selectedCrateId) ?? {
        id: selectedCrateId,
        metadata: {},
      })
    : null;

  const assemble = useMemo(() => {
    if (!selectedAgent?.request?.parameters?.length || !selectedCrate) {
      return null;
    }
    return assembleParameters(
      selectedAgent.request,
      selectedCrate.id,
      selectedCrate.metadata,
      overrides,
    );
  }, [selectedAgent, selectedCrate, overrides]);

  const visibleFields = useMemo(
    () => formFields(assemble, selectedAgent?.request),
    [assemble, selectedAgent],
  );

  useEffect(() => {
    if (!assemble) {
      setDraftText({});
      return;
    }
    const next: Record<string, string> = {};
    for (const f of assemble.fields) {
      if (f.binding.user || f.source === "missing" || f.binding.required) {
        next[f.name] = fieldToDraftValue(f.value, f.binding.type);
      }
    }
    setDraftText(next);
  }, [selectedAgentUuid, selectedCrateId, assemble?.missingRequired.join(",")]);

  const preview = useMemo(() => {
    if (!selectedAgent || !selectedCrate) return null;
    return buildAgentJobRequest(
      selectedAgent,
      selectedCrate.id,
      selectedCrate.metadata,
      overrides,
      getFacilityUrl(),
      getHydrateUrl(),
    );
  }, [selectedAgent, selectedCrate, overrides]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!preview || preview.error) {
        throw new Error(preview?.error ?? "Cannot build request");
      }
      const submitted = await submitJob(preview.body);
      setActiveJobUuid(submitted.job_uuid);
      setSubmitMsg(
        `Job ${submitted.job_uuid} · ${submitted.status}${
          submitted.phase ? ` (${submitted.phase})` : ""
        }`,
      );
      const final = await waitForJob(submitted.job_uuid, {
        onUpdate: (job) => {
          setSubmitMsg(
            `Job ${job.job_uuid} · ${job.status}${
              job.phase ? ` (${job.phase})` : ""
            }`,
          );
        },
      });
      return final;
    },
    retry: false,
    onSuccess: (job) => {
      const out = job.output_crate_uuid
        ? ` · output ${String(job.output_crate_uuid)}`
        : "";
      const err = job.error_message ? ` · ${String(job.error_message)}` : "";
      setSubmitMsg(
        `Job ${job.job_uuid} · ${job.status}${
          job.phase ? ` (${job.phase})` : ""
        }${out}${err}`,
      );
    },
    onError: (err) => {
      setSubmitMsg(err instanceof Error ? err.message : String(err));
    },
  });

  function selectAgent(agent: AgentSummary) {
    setSelectedAgentUuid(agent.agent_uuid);
    setOverrides({});
    setSubmitMsg(null);
    setActiveJobUuid(null);
    if (!selectedCrateId && cartIds[0]) {
      setSelectedCrateId(cartIds[0]);
    }
  }

  function applyFieldEdit(name: string, raw: string, typeName?: string) {
    setDraftText((d) => ({ ...d, [name]: raw }));
    try {
      const value = draftToValue(raw, typeName);
      setOverrides((o) => ({ ...o, [name]: value }));
      setSubmitMsg(null);
    } catch {
      /* keep draft text; overrides unchanged until parseable */
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4 w-full h-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100 inline-flex items-center gap-2">
            <Lightning size={28} />
            Actions
            {reachable ? (
              <span className="text-base font-normal text-slate-400">
                ({agents.length})
              </span>
            ) : null}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Pick an agent and a crate from the{" "}
            <Link to="/workflow/cart" className="text-sky-400 hover:underline">
              Action queue
            </Link>
            . Parameters autofill from crate metadata via each agent&apos;s{" "}
            <code className="text-slate-300">request:</code> recipe. Configure
            the endpoint under{" "}
            <Link to="/setup" className="text-sky-400 hover:underline">
              Setup
            </Link>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["agent-probe"] });
            void queryClient.invalidateQueries({ queryKey: ["agent-list"] });
            void queryClient.invalidateQueries({ queryKey: ["crates"] });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-700 text-slate-100 text-sm hover:bg-slate-600"
        >
          <ArrowClockwise size={16} />
          Refresh
        </button>
      </div>

      <Paper className="p-3 bg-slate-900/70 flex flex-wrap items-center gap-3 text-xs">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
            healthQuery.isLoading
              ? "bg-slate-700 text-slate-300"
              : reachable
                ? "bg-emerald-900/60 text-emerald-200"
                : "bg-rose-900/50 text-rose-200"
          }`}
        >
          {healthQuery.isLoading
            ? "Checking…"
            : reachable
              ? "Connected"
              : "Not reachable"}
        </span>
        <span className="text-slate-400 font-mono">{agentUrl}</span>
        {healthQuery.data?.detail ? (
          <span className={reachable ? "text-slate-500" : "text-rose-300"}>
            {healthQuery.data.detail}
          </span>
        ) : null}
      </Paper>

      {!reachable && !healthQuery.isLoading ? (
        <Paper className="p-4 bg-slate-900/70 text-sm text-slate-300 space-y-2">
          <p>
            Cannot reach the agent server. Start it and register the URL on
            Setup:
          </p>
          <pre className="text-xs text-slate-400 font-mono overflow-x-auto">
            {`cd agent_server && ./serve.sh --port 8780`}
          </pre>
          <Link to="/setup" className="text-sky-400 hover:underline text-sm">
            Open Setup → Agent server
          </Link>
        </Paper>
      ) : null}

      {reachable && agentsQuery.isLoading ? (
        <p className="text-sm text-slate-400">Loading agents…</p>
      ) : null}

      {reachable && agentsQuery.isError ? (
        <Paper className="p-4 bg-rose-950/40 text-sm text-rose-200">
          {agentsQuery.error instanceof Error
            ? agentsQuery.error.message
            : String(agentsQuery.error)}
        </Paper>
      ) : null}

      {agents.length > 0 ? (
        <ul className="flex flex-col gap-3 list-none p-0 m-0">
          {agents.map((agent) => {
            const selected = agent.agent_uuid === selectedAgentUuid;
            return (
              <li key={agent.agent_uuid}>
                <Paper
                  className={`p-4 space-y-2 ${
                    selected
                      ? "bg-teal-950/40 ring-1 ring-teal-700/60"
                      : "bg-slate-900/70"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                      <h2 className="text-base font-medium text-slate-100">
                        {agent.name}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          v{agent.version}
                        </span>
                      </h2>
                      {agent.description ? (
                        <p className="text-sm text-slate-400">
                          {agent.description}
                        </p>
                      ) : null}
                      <p className="text-xs text-slate-500 font-mono">
                        {agent.agent_uuid}
                      </p>
                      <p className="text-xs text-slate-500">
                        inputs: {inputSummary(agent)}
                        {agent.request?.parameters?.length
                          ? ` · ${agent.request.parameters.length} autofill field(s)`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => selectAgent(agent)}
                      className="px-3 py-1.5 rounded-md bg-teal-700 text-slate-100 text-sm hover:bg-teal-600 shrink-0"
                    >
                      {selected ? "Selected" : "Configure"}
                    </button>
                  </div>
                </Paper>
              </li>
            );
          })}
        </ul>
      ) : null}

      {selectedAgent ? (
        <Paper className="p-4 bg-slate-900/70 space-y-4">
          <h2 className="text-sm font-medium text-slate-200">
            Launch · {selectedAgent.name}
          </h2>

          <label className="block">
            <span className="text-xs text-slate-400">
              Source crate (Action queue only · {cartIds.length})
            </span>
            {cartIds.length === 0 ? (
              <p className="mt-2 text-sm text-amber-200/90">
                Action queue is empty. Add crates from{" "}
                <Link
                  to="/workflow/selection"
                  className="text-sky-400 hover:underline"
                >
                  Selection
                </Link>{" "}
                or{" "}
                <Link to="/workflow/cart" className="text-sky-400 hover:underline">
                  Action queue
                </Link>
                .
              </p>
            ) : (
              <select
                value={selectedCrateId ?? ""}
                onChange={(e) => {
                  setSelectedCrateId(e.target.value || null);
                  setOverrides({});
                  setSubmitMsg(null);
                }}
                className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
              >
                <option value="">Select a crate…</option>
                {crateChoices.map(({ id, crate }) => {
                  const title =
                    typeof crate.metadata.sample_code === "string"
                      ? crate.metadata.sample_code
                      : typeof crate.metadata.title === "string"
                        ? crate.metadata.title
                        : shortId(id);
                  const sg =
                    typeof crate.metadata.space_group === "string"
                      ? crate.metadata.space_group
                      : "";
                  return (
                    <option key={id} value={id}>
                      {title}
                      {sg ? ` · ${sg}` : ""} · {shortId(id)}
                    </option>
                  );
                })}
              </select>
            )}
          </label>

          {selectedCrate && selectedAgent.request?.parameters?.length ? (
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide">
                Parameters
              </h3>
              {assemble?.fields
                .filter((f) => !f.binding.user && f.source === "from")
                .map((f) => (
                  <div
                    key={f.name}
                    className="flex flex-wrap gap-2 text-xs text-slate-400 font-mono"
                  >
                    <span className="text-slate-500">{f.name}</span>
                    <span className="text-slate-300">
                      {JSON.stringify(f.value)}
                    </span>
                    <span className="text-emerald-600/80">
                      {sourceBadge(f.source)}
                    </span>
                  </div>
                ))}
              {visibleFields.map((f) => (
                <label key={f.name} className="block">
                  <span className="text-xs text-slate-400">
                    {f.name}
                    {f.binding.required ? " *" : ""}
                    <span className="ml-2 text-slate-600">
                      {sourceBadge(
                        overrides[f.name] != null ? "override" : f.source,
                      )}
                    </span>
                  </span>
                  {f.binding.description ? (
                    <span className="block text-xs text-slate-600 mt-0.5">
                      {f.binding.description}
                    </span>
                  ) : null}
                  {f.binding.type === "boolean" ? (
                    <select
                      value={draftText[f.name] ?? "false"}
                      onChange={(e) =>
                        applyFieldEdit(f.name, e.target.value, "boolean")
                      }
                      className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100"
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={draftText[f.name] ?? ""}
                      onChange={(e) =>
                        applyFieldEdit(f.name, e.target.value, f.binding.type)
                      }
                      className="mt-1 w-full rounded-md bg-slate-800 border border-slate-600 px-3 py-2 text-sm text-slate-100 font-mono"
                    />
                  )}
                </label>
              ))}
              {assemble?.missingRequired.length ? (
                <p className="text-xs text-rose-300">
                  Missing required: {assemble.missingRequired.join(", ")}. Pick
                  a crate with unit cell / space group, or edit fields above.
                </p>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <div>
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-2">
                Request JSON
              </h3>
              <pre className="text-xs text-slate-400 font-mono bg-slate-950/60 rounded-md p-3 overflow-x-auto max-h-64">
                {JSON.stringify(preview.body, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={
                !preview ||
                Boolean(preview.error) ||
                submitMutation.isPending ||
                !selectedCrateId
              }
              onClick={() => {
                if (submitMutation.isPending) return;
                submitMutation.mutate();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={16} />
              {submitMutation.isPending ? "Running…" : "Submit job"}
            </button>
            {preview?.error ? (
              <span className="text-xs text-rose-300">{preview.error}</span>
            ) : null}
            {submitMsg ? (
              <span
                className={`text-xs ${
                  submitMutation.isError ||
                  (submitMutation.isSuccess &&
                    submitMutation.data?.status === "failed")
                    ? "text-rose-300"
                    : submitMutation.isSuccess
                      ? "text-emerald-300"
                      : "text-slate-300"
                }`}
              >
                {submitMsg}
                {activeJobUuid ? (
                  <span className="text-slate-500"> · tracking</span>
                ) : null}
              </span>
            ) : null}
          </div>
        </Paper>
      ) : null}
    </div>
  );
}

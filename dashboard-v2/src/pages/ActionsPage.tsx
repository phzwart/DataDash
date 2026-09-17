import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import {
  ArrowClockwise,
  CheckCircle,
  Lightning,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import CollapsibleSection from "../components/CollapsibleSection";
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

const UNIT_CELL_LABELS = ["a", "b", "c", "α", "β", "γ"] as const;

function fieldLabel(f: FieldResolution): string {
  const desc = f.binding.description?.trim();
  if (desc) {
    // Prefer the human sentence before an em dash / hyphen aside.
    const head = desc.split(/\s+[—–-]\s+/)[0]?.trim();
    if (head) return head;
  }
  return f.name.replace(/_/g, " ");
}

function sourceLabel(source: FieldResolution["source"] | "override"): {
  text: string;
  className: string;
} {
  if (source === "from") {
    return { text: "From crate", className: "bg-emerald-950 text-emerald-300" };
  }
  if (source === "default") {
    return { text: "Default", className: "bg-slate-800 text-slate-300" };
  }
  if (source === "override") {
    return { text: "Edited", className: "bg-sky-950 text-sky-300" };
  }
  return { text: "Needed", className: "bg-amber-950 text-amber-200" };
}

function crateTitle(crate: CrateSummary): string {
  if (typeof crate.metadata.sample_code === "string") {
    return crate.metadata.sample_code;
  }
  if (typeof crate.metadata.title === "string") return crate.metadata.title;
  return shortId(crate.id);
}

function fieldToDraftValue(value: unknown, typeName?: string): string {
  if (value == null) return "";
  if (typeName === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function draftToValue(raw: string, typeName?: string): unknown {
  const t = typeName ?? "auto";
  if (t === "boolean") {
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  }
  if (t === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (t === "array") {
    try {
      if (raw.trim().startsWith("[")) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return raw
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => {
        const n = Number(part);
        return Number.isFinite(n) ? n : part;
      });
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

function isUnitCellField(f: FieldResolution): boolean {
  return (
    f.name === "cell" ||
    (f.binding.type === "array" &&
      Boolean(f.binding.description?.toLowerCase().includes("unit cell")))
  );
}

function SourcePill({
  source,
}: {
  source: FieldResolution["source"] | "override";
}) {
  const { text, className } = sourceLabel(source);
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {text}
    </span>
  );
}

function ParamControl({
  field,
  draft,
  onEdit,
}: {
  field: FieldResolution;
  draft: string;
  onEdit: (raw: string) => void;
}) {
  const typeName = field.binding.type ?? "auto";
  const controlClass =
    "w-full rounded-md border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40";

  if (typeName === "boolean") {
    const on = (draft || "false") === "true";
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onEdit(on ? "false" : "true")}
        className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition ${
          on
            ? "border-teal-600/70 bg-teal-950/50 text-teal-100"
            : "border-slate-600 bg-slate-950/70 text-slate-300"
        }`}
      >
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${
            on ? "bg-teal-500" : "bg-slate-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
              on ? "left-4" : "left-0.5"
            }`}
          />
        </span>
        {on ? "On" : "Off"}
      </button>
    );
  }

  if (isUnitCellField(field)) {
    const parts = draft.trim()
      ? draft.trim().split(/[\s,]+/)
      : ["", "", "", "", "", ""];
    while (parts.length < 6) parts.push("");
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {UNIT_CELL_LABELS.map((label, i) => (
          <label key={label} className="block min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
            <input
              type="number"
              step="any"
              value={parts[i] ?? ""}
              onChange={(e) => {
                const next = [...parts];
                next[i] = e.target.value;
                onEdit(next.join(" "));
              }}
              className={`${controlClass} font-mono tabular-nums`}
            />
          </label>
        ))}
      </div>
    );
  }

  if (typeName === "number") {
    return (
      <input
        type="number"
        step="any"
        value={draft}
        onChange={(e) => onEdit(e.target.value)}
        className={`${controlClass} font-mono tabular-nums`}
      />
    );
  }

  if (
    field.name === "sequence" ||
    (typeName === "string" && draft.length > 80)
  ) {
    return (
      <textarea
        rows={4}
        value={draft}
        onChange={(e) => onEdit(e.target.value)}
        spellCheck={false}
        className={`${controlClass} font-mono leading-relaxed`}
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => onEdit(e.target.value)}
      className={controlClass}
    />
  );
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
  const [showRequestJson, setShowRequestJson] = useState(false);

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

  const autofilledFields = useMemo(() => {
    const editable = new Set(visibleFields.map((f) => f.name));
    return (assemble?.fields ?? []).filter(
      (f) =>
        !f.binding.user && f.source === "from" && !editable.has(f.name),
    );
  }, [assemble, visibleFields]);

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
    setShowRequestJson(false);
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
      /* keep draft until parseable */
    }
  }

  const canSubmit =
    Boolean(preview) &&
    !preview?.error &&
    Boolean(selectedCrateId) &&
    !submitMutation.isPending;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-5 overflow-auto p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-100">
            <Lightning size={28} weight="bold" />
            Actions
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Choose an agent, pick a pin from the{" "}
            <Link
              to="/workflow/cart"
              className="font-medium text-sky-400 hover:underline"
            >
              action queue
            </Link>
            , confirm parameters, then run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ["agent-probe"] });
            void queryClient.invalidateQueries({ queryKey: ["agent-list"] });
            void queryClient.invalidateQueries({ queryKey: ["crates"] });
          }}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700"
        >
          <ArrowClockwise size={16} />
          Refresh
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
            healthQuery.isLoading
              ? "bg-slate-800 text-slate-300"
              : reachable
                ? "bg-emerald-950 text-emerald-300"
                : "bg-rose-950 text-rose-200"
          }`}
        >
          {reachable ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
          {healthQuery.isLoading
            ? "Checking agent server…"
            : reachable
              ? "Agent server connected"
              : "Agent server offline"}
        </span>
        <span className="font-mono text-slate-600">{agentUrl}</span>
      </div>

      {!reachable && !healthQuery.isLoading ? (
        <Paper className="space-y-2 bg-slate-900/70 p-4 text-sm text-slate-300">
          <p>Start the agent server and register it under Setup.</p>
          <pre className="overflow-x-auto font-mono text-xs text-slate-500">
            {`cd agent_server && ./serve.sh --port 8780`}
          </pre>
          <Link to="/setup" className="text-sky-400 hover:underline">
            Open Setup → Agent server
          </Link>
        </Paper>
      ) : null}

      {reachable && agentsQuery.isError ? (
        <Paper className="bg-rose-950/40 p-4 text-sm text-rose-200">
          {agentsQuery.error instanceof Error
            ? agentsQuery.error.message
            : String(agentsQuery.error)}
        </Paper>
      ) : null}

      {agents.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            1 · Agent
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const selected = agent.agent_uuid === selectedAgentUuid;
              return (
                <button
                  key={agent.agent_uuid}
                  type="button"
                  onClick={() => selectAgent(agent)}
                  className={`rounded-lg border p-4 text-left transition ${
                    selected
                      ? "border-teal-500/70 bg-teal-950/40 ring-1 ring-teal-600/40"
                      : "border-slate-700/80 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-100">
                      {agent.name.replace(/-agent$/, "").replace(/-/g, " ")}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
                      v{agent.version}
                    </span>
                  </div>
                  {agent.description ? (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-400">
                      {agent.description}
                    </p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedAgent ? (
        <section className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                2 · Pin from action queue
              </h2>
              <span className="text-xs text-slate-500">
                {cartIds.length} in queue
              </span>
            </div>

            {cartIds.length === 0 ? (
              <Paper className="bg-amber-950/30 p-4 text-sm text-amber-100/90">
                Queue is empty. Add pins from{" "}
                <Link
                  to="/workflow/selection"
                  className="text-sky-400 hover:underline"
                >
                  Selection
                </Link>{" "}
                or{" "}
                <Link
                  to="/workflow/cart"
                  className="text-sky-400 hover:underline"
                >
                  Action queue
                </Link>
                .
              </Paper>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {crateChoices.map(({ id, crate }) => {
                  const selected = id === selectedCrateId;
                  const sg =
                    typeof crate.metadata.space_group === "string"
                      ? crate.metadata.space_group
                      : null;
                  const res = crate.metadata.resolution;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setSelectedCrateId(id);
                        setOverrides({});
                        setSubmitMsg(null);
                      }}
                      className={`rounded-lg border px-3 py-3 text-left transition ${
                        selected
                          ? "border-sky-500/70 bg-sky-950/40 ring-1 ring-sky-600/40"
                          : "border-slate-700/80 bg-slate-900/40 hover:border-slate-500"
                      }`}
                    >
                      <div className="truncate text-sm font-semibold text-slate-100">
                        {crateTitle(crate)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                        {sg ? <span>{sg}</span> : null}
                        {res != null && res !== "" ? (
                          <span className="tabular-nums">
                            {Number(res).toFixed(2)} Å
                          </span>
                        ) : (
                          <span className="text-slate-600">no processing</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedCrate ? (
            <div className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                3 · Parameters
              </h2>

              {autofilledFields.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {autofilledFields.map((f) => (
                    <div
                      key={f.name}
                      className="rounded-md border border-slate-700/70 bg-slate-900/60 px-3 py-2"
                    >
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {f.name}
                        </span>
                        <SourcePill source={f.source} />
                      </div>
                      <div className="font-mono text-xs tabular-nums text-slate-200">
                        {Array.isArray(f.value)
                          ? f.value
                              .map((v) =>
                                typeof v === "number" ? v.toFixed(2) : String(v),
                              )
                              .join(" · ")
                          : String(f.value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {visibleFields.length > 0 ? (
                <div className="grid gap-4 rounded-xl border border-slate-700/80 bg-slate-900/50 p-4 md:grid-cols-2">
                  {visibleFields.map((f) => {
                    const src =
                      overrides[f.name] != null ? "override" : f.source;
                    const wide =
                      isUnitCellField(f) ||
                      f.name === "sequence" ||
                      (f.binding.type === "string" &&
                        (draftText[f.name] ?? "").length > 80);
                    return (
                      <label
                        key={f.name}
                        className={`block space-y-1.5 ${wide ? "md:col-span-2" : ""}`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-slate-200">
                            {fieldLabel(f)}
                            {f.binding.required ? (
                              <span className="ml-1 text-rose-400">*</span>
                            ) : null}
                          </span>
                          <SourcePill source={src} />
                        </span>
                        <ParamControl
                          field={f}
                          draft={draftText[f.name] ?? ""}
                          onEdit={(raw) =>
                            applyFieldEdit(f.name, raw, f.binding.type)
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              ) : selectedAgent.request?.parameters?.length ? (
                <p className="text-sm text-slate-500">
                  All parameters autofilled from this pin — nothing to edit.
                </p>
              ) : (
                <p className="text-sm text-slate-500">
                  This agent has no parameter recipe; it will run with the crate
                  reference only.
                </p>
              )}

              {assemble?.missingRequired.length ? (
                <p className="flex items-start gap-2 rounded-md border border-rose-800/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
                  <WarningCircle size={16} className="mt-0.5 shrink-0" />
                  Missing required: {assemble.missingRequired.join(", ")}. Pick
                  a processed pin or edit the fields above.
                </p>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <CollapsibleSection
              title="Request JSON"
              summary="Advanced · inspect submit payload"
              open={showRequestJson}
              onOpenChange={setShowRequestJson}
            >
              <pre className="max-h-64 overflow-auto rounded-md bg-slate-950/70 p-3 font-mono text-xs text-slate-400">
                {JSON.stringify(preview.body, null, 2)}
              </pre>
            </CollapsibleSection>
          ) : null}

          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-950/95 px-4 py-3 backdrop-blur">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                if (submitMutation.isPending) return;
                submitMutation.mutate();
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={18} weight="fill" />
              {submitMutation.isPending
                ? "Running…"
                : `Run ${selectedAgent.name.replace(/-agent$/, "").replace(/-/g, " ")}`}
            </button>
            {preview?.error ? (
              <span className="text-sm text-rose-300">{preview.error}</span>
            ) : null}
            {submitMsg ? (
              <span
                className={`text-sm ${
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
            ) : (
              <span className="text-sm text-slate-500">
                {selectedCrate
                  ? `Ready with ${crateTitle(selectedCrate)}`
                  : "Select a pin to continue"}
              </span>
            )}
          </div>
        </section>
      ) : reachable && agents.length > 0 ? (
        <p className="text-sm text-slate-500">Select an agent to configure a run.</p>
      ) : null}
    </div>
  );
}

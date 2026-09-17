import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import {
  CheckSquare,
  CloudArrowDown,
  HardDrives,
  Play,
  Square,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  SharedParamsForm,
  draftToValue,
  fieldToDraftValue,
} from "../components/AgentSharedParams";
import CrateCard from "../components/CrateCard";
import PushToNotesButton from "../components/PushToNotesButton";
import StoreProgressBar from "../components/StoreProgressBar";
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
  buildAgentJobRequest,
  resolveSharedFields,
} from "../lib/agentRequest";
import {
  clearCart,
  getCartIds,
  removeFromCart,
  subscribeCart,
} from "../lib/crateCart";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import { getFacilityUrl } from "../lib/facilityApi";
import {
  getHydrateUrl,
  storeCratesToLocalTiled,
  type HydrateProgress,
} from "../lib/hydrateApi";
import {
  fetchDashboardConfig,
  fetchLinkmlSchema,
  galleryGridStyle,
  resolveGallery,
} from "../lib/schema";
import { fetchCrates, shortId, type CrateSummary } from "../lib/tiledCrates";

function agentDisplayName(agent: AgentSummary): string {
  return agent.name.replace(/-agent$/, "").replace(/-/g, " ");
}

type BulkResult = {
  crateId: string;
  label: string;
  ok: boolean;
  jobUuid?: string;
  status?: string;
  error?: string;
};

export default function CartPage() {
  const queryClient = useQueryClient();
  const agentUrl = getAgentUrl();
  const [cartIds, setCartIds] = useState(() => getCartIds());
  const [inputIds, setInputIds] = useState<Set<string>>(
    () => new Set(getCartIds()),
  );
  const prevCartRef = useRef<string[]>(getCartIds());
  const [storeMessage, setStoreMessage] = useState<string | null>(null);
  const [storeProgress, setStoreProgress] = useState<HydrateProgress | null>(
    null,
  );
  const [selectedAgentUuid, setSelectedAgentUuid] = useState("");
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const [draftText, setDraftText] = useState<Record<string, string>>({});
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);

  useEffect(() => {
    return subscribeCart(() => {
      const ids = getCartIds();
      const prev = prevCartRef.current;
      const prevSet = new Set(prev);
      setCartIds(ids);
      setInputIds((selected) => {
        const next = new Set<string>();
        for (const id of ids) {
          if (selected.has(id) || !prevSet.has(id)) next.add(id);
        }
        return next;
      });
      prevCartRef.current = ids;
    });
  }, []);

  const dashUriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const dashQuery = useQuery({
    queryKey: ["dashboard-config", dashUriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(dashUriQuery.data!.uri),
    enabled: Boolean(dashUriQuery.data?.uri),
  });

  const schemaQuery = useQuery({
    queryKey: ["schema", dashQuery.data?.schema_uri],
    queryFn: () => fetchLinkmlSchema(dashQuery.data!.schema_uri),
    enabled: Boolean(dashQuery.data?.schema_uri),
  });

  const cratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: fetchCrates,
  });

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

  const gallery = dashQuery.data ? resolveGallery(dashQuery.data) : null;

  const cratesById = useMemo(() => {
    const map = new Map<string, CrateSummary>();
    for (const c of cratesQuery.data ?? []) {
      map.set(c.id, c);
    }
    return map;
  }, [cratesQuery.data]);

  const sharedFields = useMemo(
    () => resolveSharedFields(selectedAgent?.request, overrides),
    [selectedAgent, overrides],
  );

  useEffect(() => {
    if (!selectedAgent) {
      setDraftText({});
      setOverrides({});
      return;
    }
    const resolved = resolveSharedFields(selectedAgent.request, {});
    const next: Record<string, string> = {};
    for (const f of resolved) {
      next[f.name] = fieldToDraftValue(f.value, f.binding.type);
    }
    setDraftText(next);
    setOverrides({});
    setBulkResults([]);
    setBulkMessage(null);
  }, [selectedAgentUuid]);

  const storeMutation = useMutation({
    mutationFn: () => {
      const ids = getCartIds();
      setStoreProgress({
        phase: "start",
        current: 0,
        total: ids.length,
        message: `Starting store of ${ids.length} experiment(s)`,
      });
      return storeCratesToLocalTiled(ids, {
        onProgress: (p) => setStoreProgress({ ...p }),
      });
    },
    onSuccess: (result) => {
      const n = result.count ?? result.hydrated?.length ?? 0;
      const errs = result.error_count ?? result.errors?.length ?? 0;
      const reg = result.tiled_registry;
      const regNote = reg
        ? ` · tiled +${reg.registered ?? 0}/~${reg.updated ?? 0}/skip ${reg.skipped ?? 0}`
        : "";
      setStoreMessage(
        errs > 0
          ? `Stored ${n} experiment(s) on the local Tiled server with ${errs} error(s)${regNote}.`
          : `Stored ${n} experiment(s) on the local Tiled server${regNote}. Open Data Overview or Plots.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["crates"] });
    },
    onError: (err) => {
      setStoreMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error("Select an action first");
      const ids = [...inputIds];
      if (!ids.length) throw new Error("Mark at least one crate as input");

      const results: BulkResult[] = [];

      const patchResult = (crateId: string, patch: Partial<BulkResult>) => {
        const idx = results.findIndex((r) => r.crateId === crateId);
        if (idx < 0) return;
        results[idx] = { ...results[idx], ...patch };
        setBulkResults([...results]);
      };

      // 1) Submit every job first (status will be pending/queued).
      for (const crateId of ids) {
        const crate = cratesById.get(crateId) ?? { id: crateId, metadata: {} };
        const label =
          typeof crate.metadata.sample_code === "string"
            ? crate.metadata.sample_code
            : shortId(crateId);
        const preview = buildAgentJobRequest(
          selectedAgent,
          crateId,
          crate.metadata,
          overrides,
          getFacilityUrl(),
          getHydrateUrl(),
        );
        if (preview.error) {
          results.push({
            crateId,
            label,
            ok: false,
            error: preview.error,
          });
          setBulkResults([...results]);
          continue;
        }
        try {
          const submitted = await submitJob(preview.body);
          results.push({
            crateId,
            label,
            ok: true,
            jobUuid: submitted.job_uuid,
            status: submitted.status ?? "pending",
          });
        } catch (err) {
          results.push({
            crateId,
            label,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        setBulkResults([...results]);
      }

      setBulkMessage(
        `Submitted ${results.filter((r) => r.ok).length} job(s) — waiting for completion…`,
      );

      // 2) Poll each submitted job until terminal and refresh the list.
      await Promise.all(
        results
          .filter((r) => r.ok && r.jobUuid)
          .map(async (r) => {
            try {
              const final = await waitForJob(r.jobUuid!, {
                // Lattice search etc. are usually fast; MR can be long.
                timeoutMs: 6 * 60 * 60 * 1000,
                intervalMs: 1000,
                onUpdate: (job) => {
                  patchResult(r.crateId, {
                    status: job.status,
                    ok: job.status !== "failed" && job.status !== "timed_out",
                    error:
                      typeof job.error_message === "string"
                        ? job.error_message
                        : undefined,
                  });
                },
              });
              const failed =
                final.status === "failed" ||
                final.status === "timed_out" ||
                final.status === "cancelled";
              patchResult(r.crateId, {
                status: final.status,
                ok: !failed,
                error:
                  typeof final.error_message === "string"
                    ? final.error_message
                    : failed
                      ? final.status
                      : undefined,
              });
            } catch (err) {
              patchResult(r.crateId, {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
      );

      return results;
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.ok).length;
      const fail = results.length - ok;
      setBulkMessage(
        fail > 0
          ? `Finished: ${ok} succeeded, ${fail} failed.`
          : `Finished: ${ok} job(s) completed.`,
      );
    },
    onError: (err) => {
      setBulkMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const items = cartIds.map((id) => ({
    id,
    crate: cratesById.get(id) ?? { id, metadata: {} },
  }));

  const hydratedCount = cartIds.filter((id) => cratesById.has(id)).length;
  const selectedCount = inputIds.size;

  const sharedMissing = sharedFields
    .filter((f) => f.binding.required && f.value == null)
    .map((f) => f.name);

  function toggleInput(id: string) {
    setInputIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllInputs() {
    setInputIds(new Set(cartIds));
  }

  function clearInputs() {
    setInputIds(new Set());
  }

  function applyFieldEdit(name: string, raw: string, typeName?: string) {
    setDraftText((d) => ({ ...d, [name]: raw }));
    try {
      const value = draftToValue(raw, typeName);
      setOverrides((o) => ({ ...o, [name]: value }));
    } catch {
      /* keep draft until parseable */
    }
  }

  const canBulkSubmit =
    Boolean(selectedAgent) &&
    selectedCount > 0 &&
    sharedMissing.length === 0 &&
    !bulkMutation.isPending &&
    reachable;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold text-slate-100">
            <HardDrives size={28} />
            Action queue
            <span className="text-base font-normal text-slate-400">
              ({cartIds.length})
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Pick an action, set shared parameters, mark crates as inputs, then
            submit jobs in bulk.{" "}
            <span className="text-slate-500">
              {hydratedCount}/{cartIds.length} stored locally
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={cartIds.length === 0 || storeMutation.isPending}
            onClick={() => {
              setStoreMessage(null);
              setStoreProgress(null);
              storeMutation.mutate();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <CloudArrowDown size={16} />
            {storeMutation.isPending
              ? storeProgress?.message?.slice(0, 40) || "Storing…"
              : "Store to local Tiled"}
          </button>
          <Link
            to="/workflow/export"
            className="rounded-md bg-sky-800 px-3 py-1.5 text-sm text-sky-100 no-underline hover:bg-sky-700"
          >
            Export
          </Link>
          <PushToNotesButton
            crates={cartIds.map((id) => {
              const crate = cratesById.get(id);
              const label =
                (gallery && crate
                  ? String(crate.metadata[gallery.title] ?? "")
                  : "") || id;
              return { id, label };
            })}
            label="Push to notes"
          />
          <button
            type="button"
            disabled={cartIds.length === 0}
            onClick={() => clearCart()}
            className="rounded-md bg-rose-900/70 px-3 py-1.5 text-sm text-rose-100 hover:bg-rose-800 disabled:opacity-40"
          >
            Clear queue
          </button>
        </div>
      </div>

      {(storeMutation.isPending || storeProgress) && (
        <StoreProgressBar
          progress={storeProgress}
          pending={storeMutation.isPending}
        />
      )}
      {storeMessage && !storeMutation.isPending && (
        <p
          className={`text-sm ${
            storeMutation.isError ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {storeMessage}
        </p>
      )}

      {/* Action picker + shared params */}
      <div className="grid gap-3 lg:grid-cols-[minmax(16rem,22rem)_1fr]">
        <Paper className="space-y-3 bg-slate-900/70 p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            Action
          </h2>
          {!reachable && !healthQuery.isLoading ? (
            <p className="text-sm text-amber-200/90">
              Agent server offline.{" "}
              <Link to="/setup" className="text-sky-400 hover:underline">
                Setup
              </Link>
            </p>
          ) : null}
          <label className="block space-y-1.5">
            <span className="text-xs text-slate-400">Registered actions</span>
            <select
              value={selectedAgentUuid}
              onChange={(e) => setSelectedAgentUuid(e.target.value)}
              disabled={!reachable || agents.length === 0}
              className="w-full rounded-md border border-slate-600 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-sky-500"
            >
              <option value="">Select an action…</option>
              {agents.map((agent) => (
                <option key={agent.agent_uuid} value={agent.agent_uuid}>
                  {agentDisplayName(agent)}
                </option>
              ))}
            </select>
          </label>
          {selectedAgent?.description ? (
            <p className="text-xs leading-relaxed text-slate-400">
              {selectedAgent.description}
            </p>
          ) : null}
        </Paper>

        <Paper className="space-y-3 bg-slate-900/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              Shared parameters
            </h2>
            {selectedAgent ? (
              <span className="text-xs text-slate-500">
                Applied to every selected input
              </span>
            ) : null}
          </div>
          {!selectedAgent ? (
            <p className="text-sm text-slate-500">
              Choose an action to configure settings that are not crate-specific
              (cutoffs, sequence, copies, …).
            </p>
          ) : (
            <SharedParamsForm
              fields={sharedFields}
              draftText={draftText}
              overrides={overrides}
              onEdit={applyFieldEdit}
            />
          )}
          {sharedMissing.length > 0 ? (
            <p className="flex items-start gap-2 text-sm text-rose-300">
              <WarningCircle size={16} className="mt-0.5 shrink-0" />
              Fill required: {sharedMissing.join(", ")}
            </p>
          ) : null}
        </Paper>
      </div>

      {/* Bulk submit bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-950/80 px-4 py-3">
        <button
          type="button"
          disabled={!canBulkSubmit}
          onClick={() => {
            setBulkMessage(null);
            setBulkResults([]);
            bulkMutation.mutate();
          }}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play size={18} weight="fill" />
          {bulkMutation.isPending
            ? bulkResults.some((r) => r.ok && r.jobUuid)
              ? `Waiting… (${bulkResults.filter((r) => r.status === "completed" || r.status === "failed" || r.status === "cancelled" || r.status === "timed_out").length}/${bulkResults.filter((r) => r.ok).length} done)`
              : `Submitting… (${bulkResults.length}/${selectedCount})`
            : selectedAgent
              ? `Run ${agentDisplayName(selectedAgent)} on ${selectedCount} input${selectedCount === 1 ? "" : "s"}`
              : "Run on selected inputs"}
        </button>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={selectAllInputs}
            disabled={cartIds.length === 0}
            className="rounded bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={clearInputs}
            disabled={selectedCount === 0}
            className="rounded bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
          >
            Clear inputs
          </button>
        </div>
        <span className="text-sm text-slate-400">
          {selectedCount} marked as input
        </span>
        {bulkMessage ? (
          <span
            className={`text-sm ${
              bulkMutation.isError || bulkResults.some((r) => !r.ok)
                ? "text-amber-200"
                : "text-emerald-300"
            }`}
          >
            {bulkMessage}
          </span>
        ) : null}
      </div>

      {bulkResults.length > 0 ? (
        <Paper className="max-h-48 overflow-auto bg-slate-900/70 p-3">
          <ul className="m-0 list-none space-y-1.5 p-0 text-xs">
            {bulkResults.map((r) => {
              const terminal =
                r.status === "completed" ||
                r.status === "failed" ||
                r.status === "cancelled" ||
                r.status === "timed_out";
              const tone = !r.ok
                ? "text-rose-300"
                : r.status === "completed"
                  ? "text-emerald-300"
                  : terminal
                    ? "text-amber-200"
                    : "text-sky-300";
              return (
                <li key={r.crateId} className={tone}>
                  <span className="font-medium text-slate-200">{r.label}</span>
                  {r.jobUuid ? (
                    <span className="text-slate-500">
                      {" "}
                      · job {shortId(r.jobUuid)}
                    </span>
                  ) : null}
                  {r.status ? ` · ${r.status}` : null}
                  {r.error ? ` · ${r.error}` : null}
                </li>
              );
            })}
          </ul>
        </Paper>
      ) : null}

      {cartIds.length === 0 && (
        <Paper className="bg-slate-900/70 p-6 text-sm text-slate-400">
          Action queue is empty. On{" "}
          <Link to="/plots" className="text-sky-400 hover:underline">
            Plots
          </Link>
          , brush or lasso datasets and add them here.
        </Paper>
      )}

      {cratesQuery.isLoading && cartIds.length > 0 && (
        <p className="text-sm text-slate-400">Loading dataset metadata…</p>
      )}

      {gallery && (
        <div style={galleryGridStyle(gallery)}>
          {items.map(({ id, crate }) => {
            const used = inputIds.has(id);
            return (
              <CrateCard
                key={id}
                crate={crate}
                gallery={gallery}
                schema={schemaQuery.data}
                to={`/crates/${id}`}
                state={{ backTo: "/workflow/cart", backLabel: "Action queue" }}
                className={
                  used
                    ? "ring-2 ring-teal-400/70 rounded-md"
                    : "opacity-80"
                }
                overlay={
                  <div className="flex items-start gap-1">
                    <button
                      type="button"
                      title={
                        used
                          ? "Selected as job input"
                          : "Use this crate as job input"
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleInput(id);
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide shadow-md ${
                        used
                          ? "bg-teal-600 text-white hover:bg-teal-500"
                          : "bg-slate-900/95 text-slate-200 ring-1 ring-slate-500 hover:bg-slate-800"
                      }`}
                    >
                      {used ? (
                        <CheckSquare size={16} weight="fill" />
                      ) : (
                        <Square size={16} />
                      )}
                      {used ? "Input" : "Use as input"}
                    </button>
                    <button
                      type="button"
                      title="Remove from action queue"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeFromCart(id);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-800/90 text-sm text-slate-300 hover:bg-rose-900 hover:text-rose-100"
                    >
                      ×
                    </button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

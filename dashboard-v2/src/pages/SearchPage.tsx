import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { CloudArrowDown, HardDrives, MagnifyingGlass } from "@phosphor-icons/react";
import {
  facilitySearch,
  getFacilityUrl,
  type FacilitySearchHit,
  type FacilitySearchParams,
} from "../lib/facilityApi";
import { getHydrateUrl, storeCratesToLocalTiled } from "../lib/hydrateApi";
import { fetchAllCrates } from "../lib/tiledCrates";

/** LAMBDA Facility Search technique vocabulary. */
const TECHNIQUE_OPTIONS = [
  { value: "", label: "Any technique" },
  { value: "MX", label: "MX — macromolecular crystallography" },
  { value: "cryo-EM", label: "cryo-EM" },
  { value: "cryo-ET", label: "cryo-ET" },
  { value: "SAXS", label: "SAXS" },
  { value: "SANS", label: "SANS" },
  { value: "XRD", label: "XRD" },
  { value: "SFX", label: "SFX" },
  { value: "SX", label: "SX" },
  { value: "FTSX", label: "FTSX" },
] as const;

const FACILITY_OPTIONS = [
  { value: "", label: "Any facility" },
  { value: "NSLS-II", label: "NSLS-II" },
  { value: "ALS", label: "ALS" },
  { value: "APS", label: "APS" },
  { value: "SSRL", label: "SSRL" },
] as const;

const PUBLIC_OPTIONS = [
  { value: "", label: "Any visibility" },
  { value: "true", label: "Public only" },
  { value: "false", label: "Private only" },
] as const;

/** Labels: small caps, muted — never compete with values. */
const fieldLabel =
  "block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500";

/**
 * Controls sit on Finch’s forced light inputs; size/weight only here.
 * Color comes from index.css so typing stays readable.
 */
const fieldControl =
  "w-full min-h-10 rounded-md border px-3 py-2 text-sm leading-5 font-normal tracking-normal";

const presetButton =
  "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-sky-400 hover:bg-sky-50 hover:text-sky-900";

type DatePreset = "week" | "month" | "year";

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateRangeForPreset(preset: DatePreset): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  if (preset === "week") {
    start.setDate(end.getDate() - 7);
  } else if (preset === "month") {
    start.setMonth(end.getMonth() - 1);
  } else {
    start.setFullYear(end.getFullYear() - 1);
  }
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

function formatMeasuredDate(raw?: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(d);
}

function Category({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <header className="mb-3 border-b border-slate-200 pb-2">
        <h2 className="text-[13px] font-semibold tracking-tight text-slate-800">
          {title}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          {description}
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function SearchPage() {
  const queryClient = useQueryClient();
  const [proteinName, setProteinName] = useState("");
  const [technique, setTechnique] = useState("MX");
  const [facility, setFacility] = useState("");
  const [instrument, setInstrument] = useState("");
  const [isPublic, setIsPublic] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [submitted, setSubmitted] = useState<FacilitySearchParams | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [storeMessage, setStoreMessage] = useState<string | null>(null);

  const localCratesQuery = useQuery({
    queryKey: ["crates"],
    queryFn: fetchAllCrates,
  });

  const localIds = useMemo(
    () => new Set((localCratesQuery.data ?? []).map((c) => c.id)),
    [localCratesQuery.data],
  );

  const searchQuery = useQuery({
    queryKey: ["facility-search", submitted],
    queryFn: () => facilitySearch(submitted ?? {}),
    enabled: submitted !== null,
  });

  const results: FacilitySearchHit[] = searchQuery.data?.results ?? [];
  const allIds = useMemo(
    () => results.map((r) => r.experiment_id).filter(Boolean),
    [results],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const storeMutation = useMutation({
    mutationFn: async (ids: string[]) => storeCratesToLocalTiled(ids),
    onSuccess: (result, ids) => {
      const n = result.count ?? result.hydrated?.length ?? ids.length;
      const errs = result.error_count ?? result.errors?.length ?? 0;
      setStoreMessage(
        errs > 0
          ? `Stored ${n} of ${ids.length} experiment(s) on the local Tiled server with ${errs} error(s). Check client_store logs.`
          : `Stored ${n} experiment(s) on the local Tiled server. Open Data Overview or Plots.`,
      );
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["crates"] });
    },
    onError: (err) => {
      setStoreMessage(err instanceof Error ? err.message : String(err));
    },
  });

  function applyDatePreset(preset: DatePreset) {
    const { start, end } = dateRangeForPreset(preset);
    setDateStart(start);
    setDateEnd(end);
  }

  function buildParams(): FacilitySearchParams {
    return {
      protein_name: proteinName.trim() || undefined,
      technique: technique || undefined,
      facility: facility || undefined,
      instrument: instrument.trim() || undefined,
      is_public: isPublic || undefined,
      creation_date_start: dateStart
        ? `${dateStart}T00:00:00Z`
        : undefined,
      creation_date_end: dateEnd ? `${dateEnd}T23:59:59Z` : undefined,
    };
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStoreMessage(null);
    setSelected(new Set());
    setSubmitted(buildParams());
  }

  function onClearFilters() {
    setProteinName("");
    setTechnique("");
    setFacility("");
    setInstrument("");
    setIsPublic("");
    setDateStart("");
    setDateEnd("");
    setSubmitted(null);
    setSelected(new Set());
    setStoreMessage(null);
  }

  function onListAll() {
    // Clear form filters so List all is unambiguous, then query with no params.
    setProteinName("");
    setTechnique("");
    setFacility("");
    setInstrument("");
    setIsPublic("");
    setDateStart("");
    setDateEnd("");
    setStoreMessage(null);
    setSelected(new Set());
    setSubmitted({});
  }

  return (
    <div className="search-panel flex h-full min-h-0 w-full flex-col gap-5 overflow-auto p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="max-w-2xl">
          <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-50">
            <MagnifyingGlass size={28} weight="bold" />
            Facility search
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-400">
            Filter by category, search, build a selection, then store hits on
            the local Tiled server. Open{" "}
            <Link
              to="/crates"
              className="font-medium text-sky-400 hover:underline"
            >
              Data Overview
            </Link>{" "}
            to browse what is already stored locally.
          </p>
          <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
            {getFacilityUrl()}
          </p>
        </div>
        <Link
          to="/crates"
          className="inline-flex items-center gap-2 rounded-md bg-sky-800 px-3 py-2 text-sm font-medium text-slate-50 no-underline hover:bg-sky-700"
        >
          <HardDrives size={16} weight="bold" />
          Stored locally ({localIds.size})
        </Link>
      </header>

      <Paper className="p-4 md:p-5">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Category title="Sample" description="Protein / sample identity">
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={fieldLabel}>Protein name</span>
                <input
                  value={proteinName}
                  onChange={(e) => setProteinName(e.target.value)}
                  className={fieldControl}
                  placeholder="e.g. EcCa, lysozyme"
                  autoComplete="off"
                />
              </label>
            </Category>

            <Category
              title="Method"
              description="Experimental technique and beamline"
            >
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Technique</span>
                <select
                  value={technique}
                  onChange={(e) => setTechnique(e.target.value)}
                  className={fieldControl}
                >
                  {TECHNIQUE_OPTIONS.map((opt) => (
                    <option key={opt.value || "any"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Instrument</span>
                <input
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  className={fieldControl}
                  placeholder="e.g. AMX, FMX"
                  autoComplete="off"
                />
              </label>
            </Category>

            <Category
              title="Location"
              description="Where the data were collected"
            >
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={fieldLabel}>Facility</span>
                <select
                  value={facility}
                  onChange={(e) => setFacility(e.target.value)}
                  className={fieldControl}
                >
                  {FACILITY_OPTIONS.map((opt) => (
                    <option key={opt.value || "any"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </Category>

            <Category
              title="Access & dates"
              description="Visibility and creation window"
            >
              <label className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={fieldLabel}>Visibility</span>
                <select
                  value={isPublic}
                  onChange={(e) => setIsPublic(e.target.value)}
                  className={fieldControl}
                >
                  {PUBLIC_OPTIONS.map((opt) => (
                    <option key={opt.value || "any"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Created from</span>
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className={fieldControl}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={fieldLabel}>Created to</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className={fieldControl}
                />
              </label>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className={fieldLabel}>Quick range</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyDatePreset("week")}
                    className={presetButton}
                  >
                    Last week
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset("month")}
                    className={presetButton}
                  >
                    Last month
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset("year")}
                    className={presetButton}
                  >
                    Last year
                  </button>
                </div>
              </div>
            </Category>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-4">
            <button
              type="submit"
              disabled={searchQuery.isFetching}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50"
            >
              <MagnifyingGlass size={18} weight="bold" />
              {searchQuery.isFetching ? "Searching…" : "Search"}
            </button>
            <button
              type="button"
              onClick={onListAll}
              disabled={searchQuery.isFetching}
              className="min-h-11 rounded-md bg-slate-200 px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-300 disabled:opacity-50"
            >
              List all
            </button>
            <button
              type="button"
              onClick={onClearFilters}
              className="min-h-11 rounded-md px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              Clear filters
            </button>
          </div>
        </form>
      </Paper>

      {storeMessage && (
        <p
          className={`text-sm font-medium ${
            storeMutation.isError ? "text-rose-300" : "text-emerald-300"
          }`}
        >
          {storeMessage}
        </p>
      )}
      {searchQuery.isError && (
        <p className="text-sm font-medium text-rose-300">
          {(searchQuery.error as Error).message}
          {(searchQuery.error as Error).message
            .toLowerCase()
            .includes("failed to fetch")
            ? ` — check facility URL (${getFacilityUrl()}) and that the facility server allows origin http://127.0.0.1:5175 (CORS).`
            : null}
        </p>
      )}

      {submitted !== null && !searchQuery.isFetching && (
        <Paper className="flex flex-col gap-3 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">
              <span className="tabular-nums">
                {searchQuery.data?.count ?? 0}
              </span>{" "}
              hit(s)
              {selected.size > 0 ? (
                <span className="text-slate-500">
                  {" "}
                  · {selected.size} selected
                </span>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set(allIds))}
                disabled={allIds.length === 0}
                className="rounded bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-40"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={selected.size === 0}
                className="rounded bg-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-800 disabled:opacity-40"
              >
                Clear selection
              </button>
            </div>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-slate-100 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-600">
                <tr>
                  <th className="w-10 p-2.5" />
                  <th className="p-2.5 font-semibold">Protein</th>
                  <th className="p-2.5 font-semibold">Technique</th>
                  <th className="p-2.5 font-semibold">Instrument</th>
                  <th className="p-2.5 font-semibold">Facility</th>
                  <th className="p-2.5 font-semibold">Measured</th>
                  <th className="p-2.5 font-semibold normal-case tracking-normal">
                    Experiment ID
                  </th>
                </tr>
              </thead>
              <tbody className="text-[13px] leading-5 text-slate-800">
                {results.map((hit) => {
                  const id = hit.experiment_id;
                  const storedLocally = localIds.has(id);
                  return (
                    <tr
                      key={id}
                      className="border-t border-slate-200 hover:bg-sky-50/60"
                    >
                      <td className="p-2.5 align-middle">
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() => toggle(id)}
                          aria-label={`Select ${id}`}
                        />
                      </td>
                      <td className="p-2.5 align-middle font-medium text-slate-900">
                        {hit.protein_name ?? "—"}
                        {storedLocally && (
                          <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                            stored locally
                          </span>
                        )}
                      </td>
                      <td className="p-2.5 align-middle text-slate-700">
                        {hit.technique ?? "—"}
                      </td>
                      <td className="p-2.5 align-middle text-slate-700">
                        {hit.instrument ?? "—"}
                      </td>
                      <td className="p-2.5 align-middle text-slate-700">
                        {hit.facility ?? "—"}
                      </td>
                      <td className="p-2.5 align-middle tabular-nums text-slate-700">
                        {formatMeasuredDate(hit.creation_date)}
                      </td>
                      <td className="p-2.5 align-middle font-mono text-xs tabular-nums text-slate-500">
                        {id}
                      </td>
                    </tr>
                  );
                })}
                {results.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-6 text-center text-sm text-slate-500"
                    >
                      No results for this query
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              disabled={selected.size === 0 || storeMutation.isPending}
              onClick={() => {
                setStoreMessage(null);
                storeMutation.mutate([...selected]);
              }}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white shadow-md hover:bg-emerald-500 disabled:opacity-40 sm:w-auto sm:min-w-[20rem]"
            >
              <CloudArrowDown size={22} weight="bold" />
              {storeMutation.isPending
                ? "Storing on local Tiled server…"
                : selected.size > 0
                  ? `Store ${selected.size} selected to local Tiled server`
                  : "Store selection to local Tiled server"}
            </button>
            <p className="text-xs text-slate-500">
              Downloads RO-Crates and sidecars from the facility into{" "}
              <span className="font-mono">{getHydrateUrl()}</span>.
            </p>
          </div>
        </Paper>
      )}
    </div>
  );
}

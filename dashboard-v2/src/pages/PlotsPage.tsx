import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { CaretDown, CaretRight, Star } from "@phosphor-icons/react";
import AssignSelectionBar from "../components/AssignSelectionBar";
import MarkerFilterBar, {
  type MarkerFilters,
} from "../components/MarkerFilterBar";
import { useBookSearchSync, writeBookContext } from "../lib/bookContext";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  COLOR_TAG_OPTIONS,
  filterCratesByMarkers,
  getCrateMarker,
  getCrateMarkerStore,
  subscribeCrateMarkers,
} from "../lib/crateMarkers";
import {
  filterByScope,
  filterOrganizeUniverse,
  instrumentsInScope,
  scopeLabel,
} from "../lib/organizeScope";
import {
  clearPlotSelection,
  clipPlotSelectionToUniverse,
  getPlotSelection,
  setCombineMode,
  setPlotBrush,
  subscribePlotSelection,
} from "../lib/plotSelection";
import {
  fetchPlacements,
  fetchProject,
  fetchProjects,
} from "../lib/projectBookApi";
import { sampleAffinityCoords } from "../lib/sampleAffinity";
import {
  enumDisplay,
  fetchDashboardConfig,
  fetchLinkmlSchema,
  resolvePlotLayout,
  resolveRowPanelLayout,
  slotLabel,
  type AffinityPlotSpec,
  type HistogramPlotSpec,
  type ParsedSchema,
  type PlotRowSpec,
  type ScatterPlotSpec,
} from "../lib/schema";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";
import {
  affinityToVegaSpec,
  categoricalToVegaSpec,
  histogramToVegaSpec,
  scatterToVegaSpec,
} from "../viz/bindVegaSpec";
import UnitCell3DView from "../viz/UnitCell3DView";
import VegaLiteView from "../viz/VegaLiteView";

function cratesWithAffinity(
  crates: CrateSummary[],
  field: string,
): CrateSummary[] {
  const labels = crates.map((c) => String(c.metadata[field] ?? ""));
  const coords = sampleAffinityCoords(labels);
  return crates.map((c, i) => ({
    ...c,
    metadata: {
      ...c.metadata,
      name_x: coords[i]?.[0] ?? 0,
      name_y: coords[i]?.[1] ?? 0,
    },
  }));
}

function CollapsiblePlot({
  id,
  title,
  kind,
  summary,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  kind: string;
  summary: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Paper
      className={`bg-slate-900/70 overflow-hidden ${
        expanded ? "ring-1 ring-sky-500/40" : ""
      }`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/60"
        onClick={() => onToggle(id)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <CaretDown className="text-slate-400 shrink-0" size={16} />
        ) : (
          <CaretRight className="text-slate-400 shrink-0" size={16} />
        )}
        <span className="text-sm font-medium text-slate-100 flex-1 truncate">
          {title}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-slate-500 shrink-0">
          {kind}
        </span>
        <span className="text-xs text-slate-500 shrink-0 hidden sm:inline">
          {summary}
        </span>
        <span className="text-xs text-sky-400 shrink-0 ml-2">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>
      {expanded ? <div className="px-3 pb-3 pt-1">{children}</div> : null}
    </Paper>
  );
}

function formatUnitCellValue(raw: unknown): string {
  const num =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(num)) return raw == null || raw === "" ? "—" : String(raw);
  return num.toFixed(2);
}

function MetadataTable({
  crates,
  columns,
  schema,
  title,
}: {
  crates: CrateSummary[];
  columns: string[];
  schema: ParsedSchema | undefined;
  title?: string;
}) {
  const [, bump] = useState(0);
  useEffect(
    () => subscribePlotSelection(() => bump((n) => n + 1)),
    [],
  );
  useEffect(() => subscribeCrateMarkers(() => bump((n) => n + 1)), []);
  const selSet = new Set(getPlotSelection().ids);

  const rows = useMemo(() => {
    return [...crates].sort((a, b) => {
      const sa = String(a.metadata.sample_code ?? a.id);
      const sb = String(b.metadata.sample_code ?? b.id);
      return sa.localeCompare(sb, undefined, { numeric: true });
    });
  }, [crates]);

  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const opt of COLOR_TAG_OPTIONS) {
      if (opt.id) map.set(opt.id, opt.label);
    }
    return map;
  }, []);

  return (
    <div className="min-w-0 w-full h-full flex flex-col min-h-0">
      {title ? (
        <h3 className="text-sm font-medium text-slate-200 mb-2 shrink-0">
          {title}
        </h3>
      ) : null}
      <div className="flex-1 min-h-0 overflow-auto rounded-md border border-slate-700/80">
        <table className="w-full text-left text-xs border-separate border-spacing-0">
          <thead className="text-slate-400 uppercase tracking-wide">
            <tr>
              <th className="sticky top-0 z-20 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900 shadow-[0_1px_0_0_rgb(51,65,85)]">
                ★
              </th>
              <th className="sticky top-0 z-20 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900 shadow-[0_1px_0_0_rgb(51,65,85)]">
                Tag
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="sticky top-0 z-20 px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700 bg-slate-900 shadow-[0_1px_0_0_rgb(51,65,85)]"
                >
                  {schema ? slotLabel(schema, col) : col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const active = selSet.has(c.id);
              const marker = getCrateMarker(c.id);
              const tagColors = marker.colors;
              return (
                <tr
                  key={c.id}
                  className={
                    active
                      ? "bg-sky-950 text-sky-100"
                      : "text-slate-200 odd:bg-slate-950/90"
                  }
                >
                  <td className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80">
                    <span className="inline-flex items-center gap-0.5 text-amber-400">
                      {marker.stars > 0 ? (
                        <>
                          <Star size={12} weight="fill" />
                          <span className="tabular-nums">{marker.stars}</span>
                        </>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80">
                    {tagColors.length > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        {tagColors.map((tagId) => {
                          const tagOpt = COLOR_TAG_OPTIONS.find((o) => o.id === tagId);
                          if (!tagOpt?.id) return null;
                          return (
                            <span
                              key={tagId}
                              className="inline-block h-3 w-3 rounded-full border border-slate-700/80"
                              style={{ backgroundColor: tagOpt.hex }}
                              title={colorById.get(tagOpt.id) ?? tagOpt.label}
                            />
                          );
                        })}
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  {columns.map((col) => {
                    const raw = c.metadata[col];
                    const text = col.startsWith("unit_cell_")
                      ? formatUnitCellValue(raw)
                      : schema != null
                        ? enumDisplay(schema, col, raw) || "—"
                        : raw == null
                          ? "—"
                          : String(raw);
                    return (
                      <td
                        key={col}
                        className="px-2 py-1 whitespace-nowrap border-b border-slate-800/80 font-mono tabular-nums"
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AffinityPanel({
  panel,
  crates,
  layout,
  sourceId,
  onSelect,
}: {
  panel: AffinityPlotSpec;
  crates: CrateSummary[];
  layout: import("../lib/schema").ResolvedPlotLayout;
  sourceId: string;
  onSelect: (source: string, ids: string[]) => void;
}) {
  const field = panel.field ?? "sample_code";
  const points = useMemo(
    () => cratesWithAffinity(crates, field),
    [crates, field],
  );
  return (
    <div className="min-w-0">
      {panel.title ? (
        <h3 className="text-sm font-medium text-slate-200 mb-1 truncate">
          {panel.title}
        </h3>
      ) : null}
      <p className="text-[11px] text-slate-500 mb-1 leading-snug">
        {panel.caption ??
          "Nearby points have similar sample codes (string distance, MDS)."}
      </p>
      <VegaLiteView
        crates={points}
        layout={layout}
        fill
        sourceId={sourceId}
        onSelectionChange={onSelect}
        compiledSpec={affinityToVegaSpec(panel)}
        panel={{
          title: panel.title,
          selection: panel.selection ?? { mode: "lasso", id_field: "id" },
        }}
      />
    </div>
  );
}

function PlotRows({
  rows,
  crates,
  schema,
  defaults,
  onSelectFromChart,
}: {
  rows: PlotRowSpec[];
  crates: CrateSummary[];
  schema: ParsedSchema | undefined;
  defaults: import("../lib/schema").PlotLayoutSpec | undefined;
  onSelectFromChart: (source: string, ids: string[], title: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {rows.map((row, rowIdx) => (
        <Paper
          key={row.id ?? `row-${rowIdx}`}
          className="p-3 bg-slate-900/70 w-full"
        >
          {row.title ? (
            <h2 className="text-sm font-semibold text-sky-300 uppercase tracking-wide mb-3">
              {row.title}
            </h2>
          ) : null}
          <div className="flex flex-row flex-nowrap gap-3 w-full items-stretch overflow-x-auto">
            {row.panels.map((panel, i) => {
              const layout = resolveRowPanelLayout(
                defaults,
                panel,
                1 / Math.max(row.panels.length, 1),
              );
              const key = `${row.id ?? rowIdx}-${panel.type}-${i}`;
              const sourceId = `row:${row.id ?? rowIdx}:${panel.type}:${i}`;
              const panelTitle =
                "title" in panel && typeof panel.title === "string" && panel.title
                  ? panel.title
                  : panel.type;
              const onSelect = (src: string, ids: string[]) =>
                onSelectFromChart(src, ids, panelTitle);
              return (
                <div
                  key={key}
                  className={
                    panel.type === "table"
                      ? // Height comes from sibling plots (items-stretch); absolute
                        // fill keeps table content from expanding the row.
                        "relative min-w-0 shrink-0 self-stretch min-h-0"
                      : "min-w-0 shrink-0"
                  }
                  style={{
                    flex: `1 1 ${layout.widthFraction * 100}%`,
                    width: `${layout.widthFraction * 100}%`,
                    maxWidth: `${layout.widthFraction * 100}%`,
                  }}
                >
                  {panel.type === "table" ? (
                    <div className="absolute inset-0 flex flex-col min-h-0">
                      <MetadataTable
                        crates={crates}
                        columns={panel.columns}
                        schema={schema}
                        title={panel.title}
                      />
                    </div>
                  ) : panel.type === "vega" ? (
                    <div className="min-w-0">
                      {panel.title ? (
                        <h3 className="text-sm font-medium text-slate-200 mb-1 truncate">
                          {panel.title}
                        </h3>
                      ) : null}
                      <VegaLiteView
                        panel={panel}
                        crates={crates}
                        layout={layout}
                        fill
                        sourceId={sourceId}
                        onSelectionChange={onSelect}
                      />
                    </div>
                  ) : panel.type === "three" ? (
                    <UnitCell3DView
                      panel={panel}
                      crates={crates}
                      layout={layout}
                      fill
                      sourceId={sourceId}
                      onSelectionChange={onSelect}
                    />
                  ) : panel.type === "scatter" ? (
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-slate-200 mb-1 truncate">
                        {panel.title ?? `${panel.x} vs ${panel.y}`}
                      </h3>
                      <VegaLiteView
                        crates={crates}
                        layout={layout}
                        fill
                        sourceId={sourceId}
                        onSelectionChange={onSelect}
                        compiledSpec={scatterToVegaSpec(panel)}
                      />
                    </div>
                  ) : panel.type === "affinity" ? (
                    <AffinityPanel
                      panel={panel}
                      crates={crates}
                      layout={layout}
                      sourceId={sourceId}
                      onSelect={onSelect}
                    />
                  ) : (
                    <p className="text-xs text-slate-500">
                      Unsupported panel type in row: {panel.type}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </Paper>
      ))}
    </div>
  );
}

type PlotEntry = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  render: () => ReactNode;
};

export default function PlotsPage() {
  const book = useBookSearchSync();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selection, setSelection] = useState(getPlotSelection);
  const [markerFilters, setMarkerFilters] = useState<MarkerFilters>({
    minStars: 0,
    colorTag: "any",
    processedData: "any",
    sort: "default",
  });
  const [, markerBump] = useState(0);

  useEffect(
    () => subscribePlotSelection(() => setSelection(getPlotSelection())),
    [],
  );
  useEffect(() => subscribeCrateMarkers(() => markerBump((n) => n + 1)), []);

  const uriQuery = useQuery({
    queryKey: ["dashboard-uri-resolved"],
    queryFn: resolveDashboardUri,
  });

  const dashQuery = useQuery({
    queryKey: ["dashboard-config", uriQuery.data?.uri],
    queryFn: () => fetchDashboardConfig(uriQuery.data!.uri),
    enabled: Boolean(uriQuery.data?.uri),
    staleTime: 0,
    refetchOnMount: "always",
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
  const placementsQuery = useQuery({
    queryKey: ["project-book-placements"],
    queryFn: fetchPlacements,
  });
  const projectsQuery = useQuery({
    queryKey: ["project-book-projects"],
    queryFn: fetchProjects,
  });
  const projectQuery = useQuery({
    queryKey: ["project-book-project", book.projectId],
    queryFn: () => fetchProject(book.projectId!),
    enabled: Boolean(book.projectId),
  });

  const placements = placementsQuery.data?.placements ?? [];
  const scopedBeforeFacets = useMemo(
    () =>
      filterByScope(
        cratesQuery.data ?? [],
        placements,
        book.scope,
        book.projectId,
      ),
    [cratesQuery.data, placements, book.scope, book.projectId],
  );
  const instruments = useMemo(
    () => instrumentsInScope(scopedBeforeFacets),
    [scopedBeforeFacets],
  );

  const universe = useMemo(
    () =>
      filterOrganizeUniverse(cratesQuery.data ?? [], placements, book),
    [cratesQuery.data, placements, book],
  );

  const crates = useMemo(
    () => filterCratesByMarkers(universe, markerFilters, getCrateMarkerStore()),
    [universe, markerFilters],
  );
  const totalCrates = cratesQuery.data?.length ?? 0;
  const plots = dashQuery.data?.plots;
  const schema = schemaQuery.data;
  const plotDefaults = plots?.defaults;
  const projectTitle =
    projectQuery.data?.title ??
    projectsQuery.data?.projects.find((p) => p.id === book.projectId)?.title ??
    null;

  const universeKey = universe.map((c) => c.id).join("|");
  const scopeKey = `${book.scope}|${book.projectId ?? ""}|${book.instrument}|${book.dateFrom}|${book.dateTo}`;
  const prevScope = useRef<string | null>(null);
  useEffect(() => {
    if (prevScope.current === null) {
      prevScope.current = scopeKey;
      return;
    }
    if (prevScope.current !== scopeKey) {
      prevScope.current = scopeKey;
      clearPlotSelection();
    }
  }, [scopeKey]);

  useEffect(() => {
    if (!cratesQuery.isSuccess || !placementsQuery.isSuccess) return;
    clipPlotSelectionToUniverse(universe.map((c) => c.id));
  }, [universeKey, universe, cratesQuery.isSuccess, placementsQuery.isSuccess]);

  useEffect(() => {
    setCombineMode(book.combine);
  }, [book.combine]);

  const setFromChart = useCallback(
    (source: string, ids: string[], title?: string) => {
      setPlotBrush(source, title ?? source, ids);
    },
    [],
  );

  const toggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const entries: PlotEntry[] = useMemo(() => {
    if (!plots) return [];
    const list: PlotEntry[] = [];

    for (const [i, spec] of (plots.vega ?? []).entries()) {
      const id = `vega:${i}:${spec.title ?? spec.spec_uri ?? "chart"}`;
      const layout = resolvePlotLayout(plotDefaults, spec);
      const title = spec.title ?? `Vega chart ${i + 1}`;
      list.push({
        id,
        kind: "vega",
        title,
        summary: `${crates.length} datasets · brush / click`,
        render: () => (
          <VegaLiteView
            panel={spec}
            crates={crates}
            layout={layout}
            sourceId={id}
            onSelectionChange={(src, ids) => setFromChart(src, ids, title)}
          />
        ),
      });
    }

    for (const spec of plots.categorical ?? []) {
      const id = `cat:${spec.slot}`;
      const layout = resolvePlotLayout(plotDefaults, spec);
      const title =
        spec.title ?? (schema ? slotLabel(schema, spec.slot) : spec.slot);
      list.push({
        id,
        kind: "categorical",
        title,
        summary: `${crates.length} datasets`,
        render: () => (
          <VegaLiteView
            crates={crates}
            layout={layout}
            sourceId={id}
            onSelectionChange={(src, ids) => setFromChart(src, ids, title)}
            compiledSpec={categoricalToVegaSpec(spec)}
            panel={{ title, selection: { signal: "brush", id_field: "id" } }}
          />
        ),
      });
    }

    for (const spec of (plots.histograms ?? []) as HistogramPlotSpec[]) {
      const field = spec.expr ?? spec.slot ?? spec.path ?? "value";
      const id = `hist:${field}`;
      const layout = resolvePlotLayout(plotDefaults, spec);
      const title =
        spec.title ??
        (schema && spec.slot ? slotLabel(schema, spec.slot) : field);
      list.push({
        id,
        kind: "histogram",
        title,
        summary: `${crates.length} values · brush range`,
        render: () => (
          <VegaLiteView
            crates={crates}
            layout={layout}
            sourceId={id}
            onSelectionChange={(src, ids) => setFromChart(src, ids, title)}
            compiledSpec={histogramToVegaSpec(spec)}
            panel={{
              title,
              selection: {
                mode: "interval",
                signal: "brush",
                id_field: "id",
                range_field: field,
              },
            }}
          />
        ),
      });
    }

    for (const spec of (plots.scatter ?? []) as ScatterPlotSpec[]) {
      const id = `scatter:${spec.x}|${spec.y}|${spec.color ?? ""}`;
      const layout = resolvePlotLayout(plotDefaults, spec);
      const title =
        spec.title ?? `${spec.x.replace(/_/g, " ")} vs ${spec.y.replace(/_/g, " ")}`;
      list.push({
        id,
        kind: "scatter",
        title,
        summary: `${crates.length} points · brush`,
        render: () => (
          <VegaLiteView
            crates={crates}
            layout={layout}
            sourceId={id}
            onSelectionChange={(src, ids) => setFromChart(src, ids, title)}
            compiledSpec={scatterToVegaSpec(spec)}
            panel={{ title, selection: { signal: "brush", id_field: "id" } }}
          />
        ),
      });
    }

    return list;
  }, [plots, plotDefaults, crates, schema, setFromChart]);

  const selectionCount = selection.ids.length;
  const inUniverse = selection.ids.filter((id) =>
    crates.some((c) => c.id === id),
  );

  if (uriQuery.isLoading || dashQuery.isLoading || cratesQuery.isLoading) {
    return <p className="p-6 text-slate-400">Loading organize…</p>;
  }

  if (dashQuery.error) {
    return (
      <div className="p-6">
        <Paper className="p-4 text-rose-300 text-sm">
          Could not load dashboard YAML: {String(dashQuery.error)}. Configure a
          URL under Setup.
        </Paper>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 w-full min-h-0 overflow-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Organize</h1>
          <p className="text-sm text-slate-400 mt-1">
            Scope the store, brush plots ({book.combine.toUpperCase()}), then
            assign or send to Workflow · {crates.length}
            {crates.length !== totalCrates ? ` of ${totalCrates}` : ""}{" "}
            datasets
          </p>
        </div>
        <Link
          to="/workflow/selection"
          className={`px-3 py-1.5 rounded-md text-sm no-underline shrink-0 ${
            selectionCount > 0
              ? "bg-sky-800/80 text-sky-100 hover:bg-sky-700"
              : "bg-slate-800 text-slate-400 hover:bg-slate-700"
          }`}
        >
          Selection ({inUniverse.length}
          {inUniverse.length !== selectionCount ? ` of ${selectionCount}` : ""})
        </Link>
      </div>

      <Paper className="p-3 bg-slate-900/70 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Scope
          </span>
          {(["inbox", "project", "all"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              disabled={scope === "project" && !book.projectId}
              onClick={() => writeBookContext({ scope })}
              className={`px-2.5 py-1 rounded-md text-sm ${
                book.scope === scope
                  ? "bg-sky-800 text-sky-50"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              } disabled:opacity-40`}
            >
              {scopeLabel(scope)}
            </button>
          ))}
          <span className="text-xs text-slate-400 ml-1">
            {projectTitle
              ? `Project · ${projectTitle}`
              : "No project selected"}
            {book.subId && projectQuery.data
              ? ` / ${
                  projectQuery.data.subprojects.find((s) => s.id === book.subId)
                    ?.title ?? "sub"
                }`
              : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-300">
            Instrument
            <select
              value={book.instrument}
              onChange={(e) => writeBookContext({ instrument: e.target.value })}
              className="mt-1 block rounded-md bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-slate-100 min-w-36"
            >
              <option value="">All</option>
              {instruments.map((inst) => (
                <option key={inst} value={inst}>
                  {inst}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-300">
            From
            <input
              type="date"
              value={book.dateFrom}
              onChange={(e) => writeBookContext({ dateFrom: e.target.value })}
              className="mt-1 block rounded-md bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <label className="text-sm text-slate-300">
            To
            <input
              type="date"
              value={book.dateTo}
              onChange={(e) => writeBookContext({ dateTo: e.target.value })}
              className="mt-1 block rounded-md bg-slate-800 border border-slate-600 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Combine
            </span>
            {(["or", "and"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  writeBookContext({ combine: mode });
                  setCombineMode(mode);
                }}
                className={`px-2.5 py-1 rounded-md text-sm ${
                  book.combine === mode
                    ? "bg-violet-800 text-violet-50"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs font-mono text-slate-400">
          {selection.source ?? `${book.combine.toUpperCase()} · no active brushes`}
        </p>
        <AssignSelectionBar
          crateIds={inUniverse}
          projectId={book.projectId}
        />
      </Paper>

      {book.scope === "project" && !book.projectId && (
        <Paper className="p-4 text-slate-400 text-sm">
          Select a project on{" "}
          <Link to="/" className="text-sky-400 hover:underline">
            Data &amp; Projects
          </Link>{" "}
          first, or switch scope to Inbox or All.
        </Paper>
      )}

      <MarkerFilterBar
        filters={markerFilters}
        onChange={setMarkerFilters}
        showSort={false}
      />

      {!plots && (
        <Paper className="p-4 text-amber-300 text-sm">
          No <code>plots:</code> section in the dashboard YAML.
        </Paper>
      )}

      {plots?.rows && plots.rows.length > 0 && (
        <PlotRows
          rows={plots.rows}
          crates={crates}
          schema={schema}
          defaults={plotDefaults}
          onSelectFromChart={setFromChart}
        />
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-1 w-full max-w-6xl">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mt-2 mb-1">
            More plots
          </h2>
          {entries.map((entry) => (
            <CollapsiblePlot
              key={entry.id}
              id={entry.id}
              title={entry.title}
              kind={entry.kind}
              summary={entry.summary}
              expanded={expandedId === entry.id}
              onToggle={toggle}
            >
              {expandedId === entry.id ? entry.render() : null}
            </CollapsiblePlot>
          ))}
        </div>
      )}
    </div>
  );
}

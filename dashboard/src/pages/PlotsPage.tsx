import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Paper } from "@blueskyproject/finch";
import { CaretDown, CaretRight } from "@phosphor-icons/react";
import { resolveDashboardUri } from "../lib/dashboardConfig";
import {
  getPlotSelection,
  setPlotSelection,
  subscribePlotSelection,
} from "../lib/plotSelection";
import {
  enumDisplay,
  fetchDashboardConfig,
  fetchLinkmlSchema,
  resolvePlotLayout,
  resolveRowPanelLayout,
  slotLabel,
  type HistogramPlotSpec,
  type ParsedSchema,
  type PlotRowSpec,
  type ScatterPlotSpec,
} from "../lib/schema";
import { fetchCrates, type CrateSummary } from "../lib/tiledCrates";
import {
  categoricalToVegaSpec,
  histogramToVegaSpec,
  scatterToVegaSpec,
} from "../viz/bindVegaSpec";
import UnitCell3DView from "../viz/UnitCell3DView";
import VegaLiteView from "../viz/VegaLiteView";

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
  const selSet = new Set(getPlotSelection().ids);

  const rows = useMemo(() => {
    return [...crates].sort((a, b) => {
      const sa = String(a.metadata.sample_code ?? a.id);
      const sb = String(b.metadata.sample_code ?? b.id);
      return sa.localeCompare(sb, undefined, { numeric: true });
    });
  }, [crates]);

  return (
    <div className="min-w-0 w-full h-full flex flex-col">
      {title ? (
        <h3 className="text-sm font-medium text-slate-200 mb-2 shrink-0">
          {title}
        </h3>
      ) : null}
      <div className="overflow-auto rounded-md border border-slate-700/80 max-h-[min(420px,55vh)]">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-900 text-slate-400 uppercase tracking-wide">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-2 py-1.5 font-medium whitespace-nowrap border-b border-slate-700"
                >
                  {schema ? slotLabel(schema, col) : col.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const active = selSet.has(c.id);
              return (
                <tr
                  key={c.id}
                  className={
                    active
                      ? "bg-sky-900/40 text-sky-100"
                      : "text-slate-200 odd:bg-slate-900/40"
                  }
                >
                  {columns.map((col) => {
                    const raw = c.metadata[col];
                    const display =
                      schema != null
                        ? enumDisplay(schema, col, raw)
                        : raw == null
                          ? "—"
                          : String(raw);
                    const num =
                      typeof raw === "number"
                        ? raw
                        : typeof raw === "string" && raw.trim() !== ""
                          ? Number(raw)
                          : NaN;
                    const text =
                      Number.isFinite(num) && col.startsWith("unit_cell_")
                        ? num.toFixed(3)
                        : display || "—";
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
  onSelectFromChart: (source: string, ids: string[]) => void;
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
              return (
                <div
                  key={key}
                  className="min-w-0 shrink-0"
                  style={{
                    flex: `1 1 ${layout.widthFraction * 100}%`,
                    width: `${layout.widthFraction * 100}%`,
                    maxWidth: `${layout.widthFraction * 100}%`,
                  }}
                >
                  {panel.type === "table" ? (
                    <MetadataTable
                      crates={crates}
                      columns={panel.columns}
                      schema={schema}
                      title={panel.title}
                    />
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
                        onSelectionChange={onSelectFromChart}
                      />
                    </div>
                  ) : panel.type === "three" ? (
                    <UnitCell3DView
                      panel={panel}
                      crates={crates}
                      layout={layout}
                      fill
                      sourceId={sourceId}
                      onSelectionChange={onSelectFromChart}
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
                        onSelectionChange={onSelectFromChart}
                        compiledSpec={scatterToVegaSpec(panel)}
                      />
                    </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectionCount, setSelectionCount] = useState(
    () => getPlotSelection().ids.length,
  );

  useEffect(
    () =>
      subscribePlotSelection(() =>
        setSelectionCount(getPlotSelection().ids.length),
      ),
    [],
  );

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

  const crates = cratesQuery.data ?? [];
  const plots = dashQuery.data?.plots;
  const schema = schemaQuery.data;
  const plotDefaults = plots?.defaults;

  const setFromChart = useCallback((source: string, ids: string[]) => {
    setPlotSelection(ids, source);
  }, []);

  const toggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  const entries: PlotEntry[] = useMemo(() => {
    if (!plots) return [];
    const list: PlotEntry[] = [];

    for (const [i, spec] of (plots.vega ?? []).entries()) {
      const id = `vega:${i}:${spec.title ?? spec.spec_uri ?? "chart"}`;
      const layout = resolvePlotLayout(plotDefaults, spec);
      list.push({
        id,
        kind: "vega",
        title: spec.title ?? `Vega chart ${i + 1}`,
        summary: `${crates.length} datasets · brush / click`,
        render: () => (
          <VegaLiteView
            panel={spec}
            crates={crates}
            layout={layout}
            sourceId={id}
            onSelectionChange={setFromChart}
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
            onSelectionChange={setFromChart}
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
            onSelectionChange={setFromChart}
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
            onSelectionChange={setFromChart}
            compiledSpec={scatterToVegaSpec(spec)}
            panel={{ title, selection: { signal: "brush", id_field: "id" } }}
          />
        ),
      });
    }

    return list;
  }, [plots, plotDefaults, crates, schema, setFromChart]);

  if (uriQuery.isLoading || dashQuery.isLoading || cratesQuery.isLoading) {
    return <p className="p-6 text-slate-400">Loading plots…</p>;
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
          <h1 className="text-2xl font-semibold text-slate-100">
            {dashQuery.data?.title ?? "Plots"}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Vega-Lite + Three.js · brush / click to select ·{" "}
            {crates.length} datasets
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
          Selection ({selectionCount})
        </Link>
      </div>

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

import { useQuery } from "@tanstack/react-query";
import type {
  AgentDisplaySpec,
  DisplayDensityPopupModule,
  DisplayImageModule,
  DisplayJsonModule,
  DisplayKvModule,
  DisplayModuleSpec,
  DisplayRowModule,
  DisplaySummaryModule,
  DisplayTableModule,
} from "../lib/displayModule";
import {
  formatDisplayValue,
  normalizeAgentDisplay,
  resolveDensityPopupPaths,
  resolveImagePath,
  resolveJsonPath,
} from "../lib/displayModule";
import { getJobOutputFile } from "../lib/agentApi";
import { openDensityWindow } from "../lib/densityPopup";
import HolohedryGraphView from "./HolohedryGraphView";

function SummaryModule({
  mod,
  data,
}: {
  mod: DisplaySummaryModule;
  data: unknown;
}) {
  const emphasisItems = mod.items.filter((item) => item.emphasis);
  const detailItems = mod.items.filter((item) => !item.emphasis);

  return (
    <div className="rounded-lg bg-slate-800/60 border border-slate-600 px-4 py-3 space-y-3">
      {emphasisItems.map((item) => (
        <div key={item.label}>
          <div className="text-3xl font-semibold tabular-nums text-slate-50">
            {formatDisplayValue(resolveJsonPath(data, item.from))}
            {item.suffix ?? ""}
          </div>
          <div className="text-lg text-slate-200 mt-0.5">
            {mod.title ?? item.label}
          </div>
        </div>
      ))}
      {!emphasisItems.length && mod.title ? (
        <div className="text-lg font-semibold text-slate-100">{mod.title}</div>
      ) : null}
      {detailItems.length ? (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-base text-slate-300">
          {detailItems.map((item) => (
            <div key={item.label}>
              <span className="text-slate-400">{item.label}: </span>
              <span className="font-mono text-slate-100">
                {formatDisplayValue(resolveJsonPath(data, item.from))}
                {item.suffix ?? ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TableModule({
  mod,
  data,
  compact,
}: {
  mod: DisplayTableModule;
  data: unknown;
  compact?: boolean;
}) {
  const rowsRaw = resolveJsonPath(data, mod.rows);
  const limit = mod.limit ?? 15;

  if (mod.primitive === "string" && Array.isArray(rowsRaw)) {
    const strings = rowsRaw.filter((x): x is string => typeof x === "string");
    const top = strings.slice(0, limit);
    const valueLabel = mod.value_label ?? "Value";
    return (
      <div className="space-y-2 min-w-0">
        {mod.title ? (
          <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
        ) : null}
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table
            className={`w-full text-left text-base border-separate border-spacing-y-1.5 ${
              compact ? "" : "min-w-[16rem]"
            }`}
          >
            <thead>
              <tr className="text-slate-300 bg-slate-800/80">
                <th className="py-3 px-4 font-semibold w-12 text-base">#</th>
                <th className="py-3 px-4 font-semibold text-base">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {top.map((s, idx) => (
                <tr key={idx} className="bg-slate-900/40">
                  <td className="py-3 px-4 font-mono text-slate-400 tabular-nums text-base">
                    {idx + 1}
                  </td>
                  <td className="py-3 px-4 font-mono text-lg text-slate-100">{s}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const rows = Array.isArray(rowsRaw)
    ? (rowsRaw as Array<Record<string, unknown>>)
    : [];
  const top = rows.slice(0, limit);

  if (!top.length) {
    return (
      <p className="text-base text-slate-400">
        {mod.title ? `${mod.title}: ` : ""}No rows.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-left text-base border-separate border-spacing-y-2 min-w-[32rem]">
          <thead>
            <tr className="text-slate-300 bg-slate-800/80">
              {mod.columns.map((col) => (
                <th
                  key={col.field}
                  className="py-3.5 px-4 text-base font-semibold whitespace-nowrap first:rounded-l-md last:rounded-r-md"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {top.map((row, idx) => (
              <tr
                key={String(row.id ?? row.pdb_id ?? row.system ?? idx)}
                className="bg-slate-900/40 hover:bg-slate-800/60"
              >
                {mod.columns.map((col) => {
                  const value = row[col.field];
                  const linkField = col.link ? row[col.link] : undefined;
                  const display = formatDisplayValue(value, col);
                  return (
                    <td
                      key={col.field}
                      className={`py-4 px-4 text-lg leading-relaxed text-slate-200 first:rounded-l-md last:rounded-r-md ${
                        col.wrap ? "max-w-md whitespace-normal" : "whitespace-nowrap"
                      }`}
                    >
                      {typeof linkField === "string" && linkField ? (
                        <a
                          href={linkField}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sky-300 hover:underline font-semibold"
                        >
                          {display}
                        </a>
                      ) : (
                        <span
                          className={
                            col.type === "number"
                              ? "font-mono tabular-nums text-slate-100"
                              : ""
                          }
                        >
                          {display}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > top.length ? (
          <p className="text-base text-slate-400 px-4 py-3 bg-slate-900/50">
            Showing top {top.length} of {rows.length} rows
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ImageModule({
  mod,
  jobUuid,
  primaryData,
  compact,
}: {
  mod: DisplayImageModule;
  jobUuid: string;
  primaryData: unknown;
  compact?: boolean;
}) {
  const path = resolveImagePath(mod, primaryData);
  const imageQuery = useQuery({
    queryKey: ["job-output-image", jobUuid, path],
    queryFn: () => getJobOutputFile(jobUuid, path!),
    enabled: Boolean(path),
    retry: false,
  });

  if (!path) {
    return (
      <p className="text-sm text-slate-400">
        {mod.title ?? "Image"}: path not found
      </p>
    );
  }
  if (imageQuery.isLoading) {
    return <p className="text-sm text-slate-400">Loading {path}…</p>;
  }
  if (imageQuery.error) {
    return (
      <p className="text-sm text-rose-300">{String(imageQuery.error)}</p>
    );
  }
  const base64 = imageQuery.data?.base64;
  const contentType = imageQuery.data?.content_type ?? "image/png";
  if (!base64) {
    return (
      <p className="text-sm text-slate-400">
        {imageQuery.data?.error ?? "Image preview unavailable"}
      </p>
    );
  }

  return (
    <div className="space-y-2 min-w-0">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
      ) : null}
      <div
        className={`rounded-lg border border-slate-700 bg-slate-950/50 p-3 ${
          compact ? "w-full" : "inline-block max-w-full"
        }`}
      >
        <img
          src={`data:${contentType};base64,${base64}`}
          alt={mod.alt ?? mod.title ?? path}
          className="max-w-full h-auto rounded-md mx-auto min-h-[12rem]"
        />
      </div>
    </div>
  );
}

function KvModule({ mod, data }: { mod: DisplayKvModule; data: unknown }) {
  const raw = resolveJsonPath(data, mod.from);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return (
      <p className="text-sm text-slate-400">
        {mod.title ?? "Key values"}: no data
      </p>
    );
  }
  const entries = Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const keyLabel = mod.key_label ?? "Key";
  const valueLabel = mod.value_label ?? "Value";
  const decimals = mod.value_decimals ?? 4;

  return (
    <div className="space-y-2">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-left text-base border-separate border-spacing-y-1.5 min-w-[14rem]">
          <thead>
            <tr className="text-slate-300 bg-slate-800/80">
              <th className="py-3 px-4 font-semibold">{keyLabel}</th>
              <th className="py-3 px-4 font-semibold">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="bg-slate-900/40">
                <td className="py-3 px-4 font-mono text-base text-slate-300">{k}</td>
                <td className="py-3 px-4 font-mono tabular-nums text-lg text-slate-100">
                  {typeof v === "number" ? v.toFixed(decimals) : formatDisplayValue(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RowModule({
  mod,
  data,
  jobUuid,
}: {
  mod: DisplayRowModule;
  data: unknown;
  jobUuid: string;
}) {
  return (
    <div className="space-y-2">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
      ) : null}
      <div className="flex flex-row gap-4 items-start">
        {mod.modules.map((child, idx) => (
          <div
            key={child.id ?? `row-${idx}`}
            className={
              idx === 0
                ? "shrink-0 w-[44%] max-w-[26rem] min-w-[12rem]"
                : "flex-1 min-w-0"
            }
          >
            <DisplayModule
              mod={child}
              data={data}
              jobUuid={jobUuid}
              compact
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function JsonModule({ mod, data }: { mod: DisplayJsonModule; data: unknown }) {
  const subtree = mod.from ? resolveJsonPath(data, mod.from) : data;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-400 hover:text-slate-200 py-1">
        {mod.title ?? "Raw JSON"}
      </summary>
      <pre className="mt-2 max-h-64 overflow-auto text-sm text-slate-300 font-mono whitespace-pre-wrap bg-slate-900/80 rounded-md p-3 border border-slate-700">
        {JSON.stringify(subtree, null, 2)}
      </pre>
    </details>
  );
}

function DensityPopupModule({
  mod,
  data,
  jobUuid,
}: {
  mod: DisplayDensityPopupModule;
  data: unknown;
  jobUuid: string;
}) {
  let { pdb, map } = resolveDensityPopupPaths(mod, data);
  // Back-compat for older Phaser summaries without view_pdb / density_map.
  if (!pdb && data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.solution_pdb === "string" && rec.solution_pdb.trim()) {
      pdb = rec.solution_pdb.trim();
    } else if (Array.isArray(rec.phaser_products)) {
      const hit = (rec.phaser_products as unknown[]).find(
        (n) => typeof n === "string" && n.endsWith(".pdb"),
      );
      if (typeof hit === "string") pdb = `data/${hit}`;
    } else if (typeof rec.status === "string") {
      // mr_summary-shaped payload: bare model always exists for Phaser.
      pdb = "data/bare_model.pdb";
    }
  }
  if (!map && data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.density_map === "string" && rec.density_map.trim()) {
      map = rec.density_map.trim();
    } else if (Array.isArray(rec.density_maps) && rec.density_maps.length) {
      const first = rec.density_maps[0];
      if (typeof first === "string") map = first;
    }
  }

  if (!pdb) {
    return (
      <p className="text-base text-slate-400">
        {mod.title ?? "Density viewer"}: no PDB path in job summary yet.
      </p>
    );
  }

  const label =
    mod.label?.trim() ||
    (map ? "Open density in popup" : "Open structure in popup");

  return (
    <div className="rounded-lg border border-sky-700/60 bg-sky-950/40 px-4 py-3 space-y-2">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-sky-100">{mod.title}</h3>
      ) : null}
      <p className="text-sm text-slate-300 font-mono truncate">
        {pdb}
        {map
          ? ` + ${map}`
          : " (model only — re-run Phaser for density; packing may have rejected all solutions)"}
      </p>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium px-3 py-2"
        onClick={() => {
          const win = openDensityWindow({
            jobUuid,
            pdb,
            map,
            title: mod.title ?? undefined,
          });
          if (!win) {
            window.alert(
              "Popup blocked — allow popups for this site, then try again.",
            );
          }
        }}
      >
        {label}
      </button>
    </div>
  );
}

function DisplayModule({
  mod,
  data,
  jobUuid,
  compact,
}: {
  mod: DisplayModuleSpec;
  data: unknown;
  jobUuid: string;
  compact?: boolean;
}) {
  switch (mod.kind) {
    case "summary":
      return <SummaryModule mod={mod} data={data} />;
    case "table":
      return <TableModule mod={mod} data={data} compact={compact} />;
    case "image":
      return (
        <ImageModule
          mod={mod}
          jobUuid={jobUuid}
          primaryData={data}
          compact={compact}
        />
      );
    case "json":
      return <JsonModule mod={mod} data={data} />;
    case "kv":
      return <KvModule mod={mod} data={data} />;
    case "graph":
      return <HolohedryGraphView mod={mod} data={data} />;
    case "row":
      return <RowModule mod={mod} data={data} jobUuid={jobUuid} />;
    case "density_popup":
      return (
        <DensityPopupModule mod={mod} data={data} jobUuid={jobUuid} />
      );
    default:
      return null;
  }
}

export default function AgentDisplayView({
  display,
  data,
  jobUuid,
}: {
  display: AgentDisplaySpec;
  data: unknown;
  jobUuid: string;
}) {
  const normalized = normalizeAgentDisplay(display);
  const modules = normalized?.modules ?? [];

  if (!modules.length) {
    return (
      <pre className="text-sm font-mono text-slate-200 bg-slate-900/80 rounded-md p-3 max-h-96 overflow-auto whitespace-pre-wrap border border-slate-700">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-5">
      {modules.map((mod, idx) => (
        <DisplayModule
          key={mod.id ?? `${mod.kind}-${idx}`}
          mod={mod}
          data={data}
          jobUuid={jobUuid}
        />
      ))}
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-200 py-1">
          Full primary file JSON
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto text-sm text-slate-300 font-mono whitespace-pre-wrap bg-slate-900/80 rounded-md p-3 border border-slate-700">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

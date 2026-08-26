/**
 * Per-crate Vega-Lite panel (sidecar/metadata rows; no gallery selection chrome).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { VegaEmbed } from "react-vega";
import type { VisualizationSpec } from "vega-embed";
import type {
  CratePlotPanelSpec,
  CratePlotsConfig,
  ResolvedPlotLayout,
} from "../lib/schema";
import { resolvePlotLayout } from "../lib/schema";
import {
  resolveCratePlotRows,
  type CratePlotRow,
} from "../lib/cratePlotData";
import type { CrateMetadata } from "../lib/tiledCrates";

const DARK = {
  background: "transparent",
  view: { stroke: "#64748b" },
  axis: {
    labelColor: "#f1f5f9",
    titleColor: "#f8fafc",
    labelFontSize: 12,
    titleFontSize: 13,
    labelFontWeight: 500,
    titleFontWeight: 600,
    gridColor: "#475569",
    domainColor: "#94a3b8",
    tickColor: "#94a3b8",
  },
  legend: {
    labelColor: "#f1f5f9",
    titleColor: "#f8fafc",
  },
  title: { color: "#f8fafc", fontSize: 14, fontWeight: 600 },
};

function bindSpec(
  raw: Record<string, unknown>,
  rows: CratePlotRow[],
  opts: { width: number; height: number; title?: string },
): VisualizationSpec {
  const spec = structuredClone(raw) as Record<string, unknown>;
  if (!spec.$schema) {
    spec.$schema = "https://vega.github.io/schema/vega-lite/v5.json";
  }
  if (opts.title && !spec.title) spec.title = opts.title;
  const data = (spec.data as Record<string, unknown> | undefined) ?? {};
  spec.data = { ...data, values: rows };
  spec.width = Math.max(80, Math.round(opts.width));
  spec.height = Math.max(80, Math.round(opts.height));
  const config =
    spec.config && typeof spec.config === "object"
      ? (spec.config as Record<string, unknown>)
      : {};
  spec.config = { ...DARK, ...config };
  // Detail plots are display-only — drop brush params if present.
  if (Array.isArray(spec.params)) {
    spec.params = (spec.params as unknown[]).filter((p) => {
      if (!p || typeof p !== "object") return true;
      const sel = (p as { select?: { type?: string } }).select;
      return sel?.type !== "interval" && sel?.type !== "point";
    });
  }
  return spec as VisualizationSpec;
}

function CrateVegaPanel({
  panel,
  layout,
  rows,
}: {
  panel: CratePlotPanelSpec;
  layout: ResolvedPlotLayout;
  rows: CratePlotRow[];
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rawSpec, setRawSpec] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (panel.spec) {
      setRawSpec(panel.spec);
      return;
    }
    if (!panel.spec_uri) {
      setError("Vega panel requires spec or spec_uri");
      return;
    }
    fetch(panel.spec_uri)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to fetch ${panel.spec_uri}`);
        const text = await res.text();
        if (panel.spec_uri!.endsWith(".yaml") || panel.spec_uri!.endsWith(".yml")) {
          const { load } = await import("js-yaml");
          return load(text) as Record<string, unknown>;
        }
        return JSON.parse(text) as Record<string, unknown>;
      })
      .then((doc) => {
        if (!cancelled) setRawSpec(doc);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [panel.spec, panel.spec_uri]);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth;
      const w = Math.max(160, Math.round(avail));
      const h = Math.max(140, Math.round(w / layout.aspectRatio));
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.aspectRatio]);

  const spec = useMemo(() => {
    if (!rawSpec || size.width <= 0) return null;
    return bindSpec(rawSpec, rows, {
      width: size.width - 8,
      height: size.height - 8,
      title: panel.title,
    });
  }, [rawSpec, rows, size, panel.title]);

  if (error) {
    return <p className="text-rose-300 text-xs">{error}</p>;
  }

  return (
    <div ref={measureRef} className="w-full min-w-0">
      {panel.title ? (
        <h3 className="text-sm font-medium text-slate-100 mb-1">{panel.title}</h3>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-slate-300 text-xs">No rows for this plot source.</p>
      ) : spec ? (
        <div style={{ width: size.width, minHeight: size.height }}>
          <VegaEmbed spec={spec} options={{ actions: false, renderer: "canvas" }} />
        </div>
      ) : (
        <p className="text-slate-500 text-xs">Loading chart…</p>
      )}
    </div>
  );
}

export default function CratePlotsColumn({
  plots,
  sidecar,
  metadata,
}: {
  plots: CratePlotsConfig;
  sidecar: unknown;
  metadata: CrateMetadata;
}) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {plots.panels.map((panel, i) => {
        const layout = resolvePlotLayout(plots.defaults, panel);
        const rows = resolveCratePlotRows(panel.data, { sidecar, metadata });
        return (
          <CrateVegaPanel
            key={`${panel.title ?? "panel"}-${i}`}
            panel={panel}
            layout={layout}
            rows={rows}
          />
        );
      })}
    </div>
  );
}

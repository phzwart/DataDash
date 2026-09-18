/**
 * Bind crate metadata rows into a Vega-Lite spec and compile legacy shorthand.
 */

import type { VisualizationSpec } from "vega-embed";
import type {
  AffinityPlotSpec,
  CategoricalPlotSpec,
  HistogramPlotSpec,
  ScatterPlotSpec,
  VegaPlotSpec,
} from "../lib/schema";
import type { CrateDataRow } from "./plotTypes";
import { getCrateMarker } from "../lib/crateMarkers";

const DARK = {
  background: "transparent",
  view: { stroke: "#334155" },
  axis: {
    labelColor: "#cbd5e1",
    titleColor: "#94a3b8",
    gridColor: "#334155",
    domainColor: "#475569",
    tickColor: "#475569",
  },
  legend: {
    labelColor: "#cbd5e1",
    titleColor: "#94a3b8",
  },
  title: { color: "#e2e8f0" },
};

const DOMAIN_PAD = 0.1;

export function cratesToDataRows(
  crates: { id: string; metadata: Record<string, unknown> }[],
  selectedIds?: Set<string>,
  cartIds?: Set<string>,
): CrateDataRow[] {
  const hasSel = Boolean(selectedIds && selectedIds.size > 0);
  return crates.map((c) => {
    const { user_markers: _omit, ...meta } = c.metadata;
    return {
      id: c.id,
      ...meta,
      user_stars: getCrateMarker(c.id).stars,
      user_color: getCrateMarker(c.id).colors.join("+") || "none",
      _hasSelection: hasSel,
      _selected: hasSel && selectedIds!.has(c.id),
      _inCart: Boolean(cartIds?.has(c.id)),
    };
  });
}

function paddedDomain(
  rows: CrateDataRow[],
  field: string,
  pad = DOMAIN_PAD,
): [number, number] | null {
  const vals = rows
    .map((r) => Number(r[field]))
    .filter((n) => Number.isFinite(n));
  if (vals.length === 0) return null;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) {
    const delta = Math.abs(lo) * pad || pad;
    return [lo - delta, hi + delta];
  }
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}

/** Apply 10% padding to quantitative x/y scale domains from data. */
export function applyQuantitativeDomainPadding(
  spec: Record<string, unknown>,
  rows: CrateDataRow[],
  pad = DOMAIN_PAD,
): void {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  if (!encoding || typeof encoding !== "object") return;

  for (const channel of ["x", "y"] as const) {
    const enc = encoding[channel];
    if (!enc || typeof enc !== "object") continue;
    const e = enc as Record<string, unknown>;
    if (e.type !== "quantitative") continue;
    // Don't force domains on binned axes (breaks histogram brushes).
    if (e.bin) continue;
    const field = typeof e.field === "string" ? e.field : null;
    if (!field) continue;
    const domain = paddedDomain(rows, field, pad);
    if (!domain) continue;
    const scale =
      e.scale && typeof e.scale === "object"
        ? { ...(e.scale as Record<string, unknown>) }
        : {};
    scale.zero = false;
    scale.domain = domain;
    e.scale = scale;
  }
}

function isPointMark(spec: Record<string, unknown>): boolean {
  const mark = spec.mark;
  if (typeof mark === "string") return mark === "point" || mark === "circle";
  if (mark && typeof mark === "object") {
    const t = (mark as { type?: string }).type;
    return t === "point" || t === "circle" || t == null;
  }
  return false;
}

export function scatterToVegaSpec(spec: ScatterPlotSpec): VisualizationSpec {
  const encoding: Record<string, unknown> = {
    x: { field: spec.x, type: "quantitative", scale: { zero: false } },
    y: { field: spec.y, type: "quantitative", scale: { zero: false } },
    opacity: {
      condition: {
        test: "datum._selected === true || datum._inCart === true || !datum._hasSelection",
        value: 1,
      },
      value: 0.25,
    },
    color: {
      condition: [
        {
          test: "datum._selected === true",
          value: "#ef4444",
        },
        {
          test: "datum._inCart === true",
          value: "#22c55e",
        },
      ],
      ...(spec.color
        ? { field: spec.color, type: "nominal" }
        : { value: "#38bdf8" }),
    },
    tooltip: [
      { field: "sample_code", type: "nominal" },
      { field: spec.x, type: "quantitative" },
      { field: spec.y, type: "quantitative" },
    ],
  };
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: spec.title,
    mark: { type: "point", filled: true, size: 80 },
    encoding,
    params: [
      {
        name: "click_sel",
        select: { type: "point", fields: ["id"], toggle: true },
      },
    ],
  } as VisualizationSpec;
}

export function affinityToVegaSpec(spec: AffinityPlotSpec): VisualizationSpec {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: spec.title,
    mark: { type: "point", filled: true, size: 80 },
    encoding: {
      x: {
        field: "name_x",
        type: "quantitative",
        scale: { zero: false },
        title: "MDS 1",
      },
      y: {
        field: "name_y",
        type: "quantitative",
        scale: { zero: false },
        title: "MDS 2",
      },
      opacity: {
        condition: {
          test: "datum._selected === true || datum._inCart === true || !datum._hasSelection",
          value: 1,
        },
        value: 0.25,
      },
      color: {
        condition: [
          { test: "datum._selected === true", value: "#ef4444" },
          { test: "datum._inCart === true", value: "#22c55e" },
        ],
        ...(spec.color
          ? { field: spec.color, type: "nominal" }
          : { value: "#38bdf8" }),
      },
      tooltip: [
        { field: spec.field ?? "sample_code", type: "nominal" },
        { field: "name_x", type: "quantitative", title: "MDS 1" },
        { field: "name_y", type: "quantitative", title: "MDS 2" },
      ],
    },
    params: [
      {
        name: "click_sel",
        select: { type: "point", fields: ["id"], toggle: true },
      },
    ],
  } as VisualizationSpec;
}

export function histogramToVegaSpec(spec: HistogramPlotSpec): VisualizationSpec {
  const field = spec.expr ?? spec.slot ?? spec.path ?? "value";
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: spec.title,
    mark: { type: "bar", color: "#38bdf8", tooltip: true },
    params: [
      {
        name: "brush",
        select: {
          type: "interval",
          encodings: ["x"],
          mark: { fill: "#94a3b8", fillOpacity: 0.25, stroke: "#38bdf8" },
        },
      },
    ],
    encoding: {
      x: {
        field,
        type: "quantitative",
        bin: { maxbins: 20 },
        title: field.replace(/_/g, " "),
      },
      y: { aggregate: "count", type: "quantitative", title: "count" },
      opacity: {
        condition: { param: "brush", value: 1 },
        value: 0.35,
      },
      tooltip: [
        { field, bin: { maxbins: 20 }, type: "quantitative" },
        { aggregate: "count", type: "quantitative" },
      ],
    },
  } as VisualizationSpec;
}

export function categoricalToVegaSpec(
  spec: CategoricalPlotSpec,
): VisualizationSpec {
  return {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: spec.title,
    mark: { type: "bar", color: "#a78bfa", opacity: 0.9 },
    encoding: {
      y: {
        field: spec.slot,
        type: "nominal",
        sort: "-x",
        title: spec.slot.replace(/_/g, " "),
      },
      x: { aggregate: "count", type: "quantitative", title: "count" },
      tooltip: [
        { field: spec.slot, type: "nominal" },
        { aggregate: "count", type: "quantitative" },
      ],
    },
    params: [
      {
        name: "brush",
        select: { type: "point", fields: [spec.slot], toggle: true },
      },
    ],
  } as VisualizationSpec;
}

export async function resolveVegaLiteDocument(
  panel: VegaPlotSpec,
): Promise<Record<string, unknown>> {
  if (panel.spec_uri) {
    const res = await fetch(panel.spec_uri);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${panel.spec_uri} (${res.status})`);
    }
    const text = await res.text();
    if (panel.spec_uri.endsWith(".yaml") || panel.spec_uri.endsWith(".yml")) {
      const { load } = await import("js-yaml");
      return load(text) as Record<string, unknown>;
    }
    return JSON.parse(text) as Record<string, unknown>;
  }
  if (panel.spec) return { ...panel.spec };
  throw new Error("Vega panel requires spec or spec_uri");
}

export function resolveSelectionMode(
  panel: VegaPlotSpec | undefined,
  spec: Record<string, unknown>,
): "lasso" | "interval" | "point" {
  if (panel?.selection?.mode) return panel.selection.mode;
  return isPointMark(spec) ? "lasso" : "interval";
}

export function bindVegaSpec(
  raw: Record<string, unknown>,
  rows: CrateDataRow[],
  opts?: {
    width?: number;
    height?: number;
    title?: string;
    /** When lasso, strip VL interval brush params. */
    selectionMode?: "lasso" | "interval" | "point";
    domainPad?: number;
  },
): VisualizationSpec {
  const spec = structuredClone(raw) as Record<string, unknown>;
  if (!spec.$schema) {
    spec.$schema = "https://vega.github.io/schema/vega-lite/v5.json";
  }
  if (opts?.title && !spec.title) spec.title = opts.title;

  const data = (spec.data as Record<string, unknown> | undefined) ?? {};
  spec.data = { ...data, values: rows };

  if (opts?.width != null) spec.width = Math.max(80, Math.round(opts.width));
  if (opts?.height != null) spec.height = Math.max(80, Math.round(opts.height));

  applyQuantitativeDomainPadding(spec, rows, opts?.domainPad ?? DOMAIN_PAD);

  // Selection / cart styling for point scatters:
  // selected → red; in cart → green; else field color (dim if a selection is active).
  const encoding = (spec.encoding as Record<string, unknown> | undefined) ?? {};
  if (isPointMark(spec)) {
    encoding.opacity = {
      condition: {
        test: "datum._selected === true || datum._inCart === true || !datum._hasSelection",
        value: 1,
      },
      value: 0.25,
    };

    const existingColor = encoding.color;
    const baseColor =
      existingColor && typeof existingColor === "object"
        ? (() => {
            const c = existingColor as Record<string, unknown>;
            return c.field
              ? { field: c.field, type: c.type ?? "nominal", title: c.title }
              : { value: (c.value as string | undefined) ?? "#38bdf8" };
          })()
        : { value: "#38bdf8" };

    encoding.color = {
      condition: [
        { test: "datum._selected === true", value: "#ef4444" },
        { test: "datum._inCart === true", value: "#22c55e" },
      ],
      ...baseColor,
    };
    spec.encoding = encoding;
  }

  let params = Array.isArray(spec.params) ? [...spec.params] : [];
  const mode = opts?.selectionMode ?? "interval";

  if (mode === "lasso") {
    // Keep scale-bound zoom; drop other interval brushes (lasso is React overlay).
    params = params.filter((p) => {
      if (!p || typeof p !== "object") return true;
      const sel = (p as { select?: { type?: string; bind?: string } }).select;
      if (sel?.type !== "interval") return true;
      return sel.bind === "scales";
    });
    const hasZoom = params.some(
      (p) =>
        p &&
        typeof p === "object" &&
        (p as { name?: string }).name === "zoom_pan",
    );
    if (!hasZoom) {
      // Scroll = zoom; Shift-drag = pan (plain drag stays free for lasso).
      params.push({
        name: "zoom_pan",
        select: {
          type: "interval",
          encodings: ["x", "y"],
          bind: "scales",
          zoom: "wheel!",
          translate:
            "[mousedown[event.shiftKey], window:mouseup] > window:mousemove!",
        },
      });
    }
  } else {
    const hasBrush = params.some(
      (p) =>
        p && typeof p === "object" && (p as { name?: string }).name === "brush",
    );
    if (!hasBrush && mode === "interval") {
      params.push({
        name: "brush",
        select: { type: "interval", encodings: ["x", "y"] },
      });
    }
    // Interval histograms stay brush-only; 2D scatters that aren't lasso still get zoom.
    if (isPointMark(spec)) {
      const hasZoom = params.some(
        (p) =>
          p &&
          typeof p === "object" &&
          (p as { name?: string }).name === "zoom_pan",
      );
      if (!hasZoom) {
        params.push({
          name: "zoom_pan",
          select: {
            type: "interval",
            encodings: ["x", "y"],
            bind: "scales",
            zoom: "wheel!",
            translate:
              "[mousedown[event.shiftKey], window:mouseup] > window:mousemove!",
          },
        });
      }
    }
  }
  spec.params = params;

  const config =
    spec.config && typeof spec.config === "object"
      ? (spec.config as Record<string, unknown>)
      : {};
  spec.config = { ...DARK, ...config };

  return spec as VisualizationSpec;
}

/** Extract crate ids from a Vega selection value. */
export function idsFromVegaSelection(
  value: unknown,
  rows: CrateDataRow[],
  idField = "id",
  rangeField?: string,
): string[] {
  if (value == null || value === false) return [];

  if (Array.isArray(value)) {
    const ids: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        const v = (item as Record<string, unknown>)[idField];
        if (typeof v === "string") ids.push(v);
        else if (Array.isArray(v)) {
          for (const x of v) if (typeof x === "string") ids.push(x);
        }
      } else if (typeof item === "string") {
        ids.push(item);
      }
    }
    return [...new Set(ids)];
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter(
      (k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0,
    );
    if (keys.length === 0) return [];

    // Prefer an explicit range field, or a key that matches / contains it.
    const orderedKeys = rangeField
      ? [
          ...keys.filter((k) => k === rangeField || k.includes(rangeField)),
          ...keys.filter((k) => k !== rangeField && !k.includes(rangeField)),
        ]
      : keys;

    // Collect numeric interval extents (possibly across renamed bin keys).
    const intervals: { field: string; lo: number; hi: number }[] = [];
    for (const k of orderedKeys) {
      const range = obj[k] as unknown[];
      if (
        range.length >= 2 &&
        typeof range[0] === "number" &&
        typeof range[1] === "number"
      ) {
        const field =
          rangeField && (k === rangeField || k.includes(rangeField))
            ? rangeField
            : rangeField && orderedKeys[0] === k
              ? rangeField
              : k;
        intervals.push({
          field,
          lo: Math.min(range[0], range[1]),
          hi: Math.max(range[0], range[1]),
        });
        // One continuous brush interval is enough for histograms.
        if (rangeField) break;
      }
    }

    if (intervals.length > 0) {
      return rows
        .filter((row) =>
          intervals.every(({ field, lo, hi }) => {
            const n = Number(row[field]);
            return Number.isFinite(n) && n >= lo && n <= hi;
          }),
        )
        .map((r) => String(r[idField] ?? r.id));
    }

    // Nominal multi-value filters (categorical bars).
    return rows
      .filter((row) =>
        keys.every((k) => {
          const range = obj[k] as unknown[];
          const allowed = new Set(range.map((x) => String(x)));
          return allowed.has(String(row[k] ?? ""));
        }),
      )
      .map((r) => String(r[idField] ?? r.id));
  }
  return [];
}

/** Ray-casting point-in-polygon (poly in same coords as point). */
export function pointInPolygon(
  x: number,
  y: number,
  poly: { x: number; y: number }[],
): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function scatterFieldsFromSpec(
  spec: Record<string, unknown>,
): { x: string; y: string } | null {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  if (!encoding) return null;
  const xf = (encoding.x as { field?: string } | undefined)?.field;
  const yf = (encoding.y as { field?: string } | undefined)?.field;
  if (!xf || !yf) return null;
  return { x: xf, y: yf };
}

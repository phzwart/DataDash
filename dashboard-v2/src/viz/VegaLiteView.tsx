import { useEffect, useMemo, useRef, useState } from "react";
import { VegaEmbed } from "react-vega";
import type { Result, VisualizationSpec } from "vega-embed";
import type { View } from "vega";
import type { ResolvedPlotLayout, VegaPlotSpec } from "../lib/schema";
import {
  getPlotSelection,
  subscribePlotSelection,
} from "../lib/plotSelection";
import { getCartIds, subscribeCart } from "../lib/crateCart";
import {
  bindVegaSpec,
  cratesToDataRows,
  idsFromVegaSelection,
  pointInPolygon,
  resolveSelectionMode,
  resolveVegaLiteDocument,
  scatterFieldsFromSpec,
} from "./bindVegaSpec";
import type { CrateDataRow } from "./plotTypes";

type CrateLike = { id: string; metadata: Record<string, unknown> };
type Pt = { x: number; y: number };

type ScaleFn = ((v: number) => number) & { invert?: (v: number) => number };

function getScale(view: View, name: string): ScaleFn | null {
  try {
    const s = view.scale(name) as ScaleFn | undefined;
    return s ?? null;
  } catch {
    return null;
  }
}

/** Project data → overlay pixel coords (same space as lasso path). */
function dataToOverlayPx(
  view: View,
  overlayEl: Element,
  xField: string,
  yField: string,
  row: CrateDataRow,
): Pt | null {
  const x = Number(row[xField]);
  const y = Number(row[yField]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const sx = getScale(view, "x");
  const sy = getScale(view, "y");
  if (!sx || !sy) return null;

  let origin: [number, number] = [0, 0];
  try {
    origin = (view.origin() as [number, number]) ?? [0, 0];
  } catch {
    origin = [0, 0];
  }

  // Vega plot-local pixels
  const localX = sx(x) + origin[0];
  const localY = sy(y) + origin[1];

  // Map from Vega view container → overlay (accounts for title/padding wrappers)
  const container = view.container();
  if (!container) {
    return { x: localX, y: localY };
  }
  const cRect = container.getBoundingClientRect();
  const oRect = overlayEl.getBoundingClientRect();
  return {
    x: localX + (cRect.left - oRect.left),
    y: localY + (cRect.top - oRect.top),
  };
}

export default function VegaLiteView({
  panel,
  crates,
  layout,
  fill = false,
  sourceId,
  onSelectionChange,
  compiledSpec,
}: {
  panel?: VegaPlotSpec;
  crates: CrateLike[];
  layout: ResolvedPlotLayout;
  fill?: boolean;
  sourceId: string;
  onSelectionChange: (source: string, ids: string[]) => void;
  compiledSpec?: VisualizationSpec;
}) {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const viewRef = useRef<View | null>(null);
  const [viewEpoch, setViewEpoch] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [rawSpec, setRawSpec] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selTick, setSelTick] = useState(0);
  const [cartTick, setCartTick] = useState(0);
  const [lassoPts, setLassoPts] = useState<Pt[]>([]);
  const drawingRef = useRef(false);
  const lassoPtsRef = useRef<Pt[]>([]);
  lassoPtsRef.current = lassoPts;

  const idField = panel?.selection?.id_field ?? "id";
  const signalName = panel?.selection?.signal ?? "brush";
  const rangeField = panel?.selection?.range_field;

  useEffect(
    () => subscribePlotSelection(() => setSelTick((n) => n + 1)),
    [],
  );
  useEffect(() => subscribeCart(() => setCartTick((n) => n + 1)), []);

  const selectedIds = useMemo(
    () => new Set(getPlotSelection().ids),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selTick forces refresh
    [selTick],
  );
  const cartIds = useMemo(
    () => new Set(getCartIds()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cartTick forces refresh
    [cartTick],
  );

  // Base rows are selection-stable. Injecting _selected into Vega data remounts
  // the chart and clears interval brushes — only point/lasso charts need it.
  const baseRows = useMemo(() => cratesToDataRows(crates), [crates]);
  const styledRows = useMemo(
    () => cratesToDataRows(crates, selectedIds, cartIds),
    [crates, selectedIds, cartIds],
  );
  const rowsRef = useRef<CrateDataRow[]>(baseRows);
  rowsRef.current = baseRows;

  useEffect(() => {
    if (compiledSpec) {
      setRawSpec(compiledSpec as unknown as Record<string, unknown>);
      return;
    }
    if (!panel) return;
    let cancelled = false;
    setError(null);
    resolveVegaLiteDocument(panel)
      .then((doc) => {
        if (!cancelled) setRawSpec(doc);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [panel, compiledSpec]);

  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => {
      const avail = fill
        ? el.clientWidth
        : (el.parentElement?.clientWidth ?? el.clientWidth);
      const minW = fill ? 120 : 420;
      const minH = fill ? 120 : 280;
      const w = Math.max(
        minW,
        Math.round(fill ? avail : avail * layout.widthFraction),
      );
      const h = Math.max(minH, Math.round(w / layout.aspectRatio));
      setSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h },
      );
    };
    update();
    const ro = new ResizeObserver(update);
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout.widthFraction, layout.aspectRatio, fill]);

  const selectionMode = useMemo(() => {
    if (!rawSpec) return "interval" as const;
    return resolveSelectionMode(panel, rawSpec);
  }, [panel, rawSpec]);

  const rowsForSpec =
    selectionMode === "lasso" ? styledRows : baseRows;

  const spec = useMemo(() => {
    if (!rawSpec || size.width <= 0) return null;
    return bindVegaSpec(rawSpec, rowsForSpec, {
      width: size.width - 16,
      height: size.height - 24,
      title: panel?.title,
      selectionMode,
      domainPad: 0.1,
    }) as VisualizationSpec;
  }, [rawSpec, rowsForSpec, size, panel?.title, selectionMode]);

  const onEmbed = (result: Result) => {
    viewRef.current = result.view;
    setViewEpoch((n) => n + 1);
  };

  // Attach interval/point selection listeners whenever the Vega view is ready.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (selectionMode !== "interval" && selectionMode !== "point") return;

    const isEmpty = (val: unknown) =>
      val == null ||
      val === false ||
      (typeof val === "object" &&
        !Array.isArray(val) &&
        Object.keys(val as object).length === 0) ||
      (Array.isArray(val) && val.length === 0);

    const applyValue = (
      val: unknown,
      { clearIfEmpty }: { clearIfEmpty: boolean },
    ) => {
      if (isEmpty(val)) {
        if (clearIfEmpty) onSelectionChange(sourceId, []);
        return;
      }
      // Prefer brush_tuple.values when present (reliable for VL interval).
      if (val && typeof val === "object" && "values" in (val as object)) {
        const tuple = val as {
          fields?: { field?: string }[];
          values?: unknown[];
        };
        const fieldName = rangeField ?? tuple.fields?.[0]?.field;
        const extent = tuple.values?.[0];
        if (
          fieldName &&
          Array.isArray(extent) &&
          extent.length >= 2 &&
          typeof extent[0] === "number" &&
          typeof extent[1] === "number"
        ) {
          const ids = idsFromVegaSelection(
            { [fieldName]: extent },
            rowsRef.current,
            idField,
            fieldName,
          );
          onSelectionChange(sourceId, ids);
          return;
        }
        // Incomplete tuple — don't clear a good brush reading.
        return;
      }
      const ids = idsFromVegaSelection(
        val,
        rowsRef.current,
        idField,
        rangeField,
      );
      onSelectionChange(sourceId, ids);
    };

    // Signal listeners only apply non-empty values. Empty/null flashes from
    // brush_tuple (and remounts) must not wipe a just-applied selection.
    const onBrush = (_name: string, value: unknown) => {
      applyValue(value, { clearIfEmpty: false });
    };
    const onBrushExtent = (_name: string, value: unknown) => {
      if (
        Array.isArray(value) &&
        value.length >= 2 &&
        typeof value[0] === "number"
      ) {
        const field = rangeField ?? _name.replace(/^brush_/, "");
        applyValue({ [field]: value }, { clearIfEmpty: false });
      }
    };

    const listeners: [string, (n: string, v: unknown) => void][] = [
      [signalName, onBrush],
    ];
    if (signalName !== "brush") {
      listeners.push(["brush", onBrush]);
    }
    if (rangeField) {
      listeners.push([`brush_${rangeField}`, onBrushExtent]);
    }

    for (const [n, fn] of listeners) {
      try {
        view.addSignalListener(n, fn);
      } catch {
        /* optional */
      }
    }

    const flush = ({ clearIfEmpty }: { clearIfEmpty: boolean }) => {
      try {
        const brush = view.signal("brush");
        if (!isEmpty(brush)) {
          applyValue(brush, { clearIfEmpty: false });
          return;
        }
      } catch {
        /* ignore */
      }
      if (rangeField) {
        try {
          const ext = view.signal(`brush_${rangeField}`);
          if (Array.isArray(ext) && ext.length >= 2) {
            applyValue({ [rangeField]: ext }, { clearIfEmpty: false });
            return;
          }
        } catch {
          /* ignore */
        }
      }
      try {
        const tuple = view.signal("brush_tuple");
        if (!isEmpty(tuple)) {
          applyValue(tuple, { clearIfEmpty: false });
          return;
        }
      } catch {
        /* ignore */
      }
      if (clearIfEmpty) onSelectionChange(sourceId, []);
    };

    const onPointerUp = () => {
      // Apply promptly; only clear after a short delay so an in-flight brush
      // commit is not wiped by a premature empty read.
      window.setTimeout(() => flush({ clearIfEmpty: false }), 0);
      window.setTimeout(() => flush({ clearIfEmpty: true }), 50);
    };
    const container = view.container();
    container?.addEventListener("pointerup", onPointerUp);
    container?.addEventListener("mouseup", onPointerUp);

    return () => {
      for (const [n, fn] of listeners) {
        try {
          view.removeSignalListener(n, fn);
        } catch {
          /* ignore */
        }
      }
      container?.removeEventListener("pointerup", onPointerUp);
      container?.removeEventListener("mouseup", onPointerUp);
    };
  }, [
    viewEpoch,
    selectionMode,
    signalName,
    idField,
    rangeField,
    sourceId,
    onSelectionChange,
  ]);

  const finishLasso = (poly: Pt[]) => {
    drawingRef.current = false;
    setLassoPts([]);
    if (poly.length < 3 || !rawSpec) {
      onSelectionChange(sourceId, []);
      return;
    }
    const fields = scatterFieldsFromSpec(rawSpec);
    const view = viewRef.current;
    const overlay = overlayRef.current;
    if (!fields || !view || !overlay) return;

    // Close the polygon for hit-testing
    const closed =
      poly.length > 0 &&
      (poly[0].x !== poly[poly.length - 1].x ||
        poly[0].y !== poly[poly.length - 1].y)
        ? [...poly, poly[0]]
        : poly;

    // Hit-test in overlay pixel space (same coords as the drawn path).
    const ids = rowsRef.current
      .filter((r) => {
        const px = dataToOverlayPx(view, overlay, fields.x, fields.y, r);
        if (!px) return false;
        return pointInPolygon(px.x, px.y, closed);
      })
      .map((r) => String(r[idField] ?? r.id));

    onSelectionChange(sourceId, ids);
  };

  const pointerPos = (e: React.PointerEvent): Pt => {
    const svg = overlayRef.current!;
    const rect = svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (selectionMode !== "lasso") return;
    // Shift-drag is reserved for pan (Vega zoom_pan).
    if (e.shiftKey) return;
    const wrap = chartWrapRef.current;
    const svg = overlayRef.current;
    if (!wrap || !svg) return;
    e.preventDefault();
    wrap.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pt = pointerPos(e);
    lassoPtsRef.current = [pt];
    setLassoPts([pt]);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || selectionMode !== "lasso") return;
    const pt = pointerPos(e);
    const prev = lassoPtsRef.current;
    const last = prev[prev.length - 1];
    if (last && Math.hypot(last.x - pt.x, last.y - pt.y) < 2) return;
    const next = [...prev, pt];
    lassoPtsRef.current = next;
    setLassoPts(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drawingRef.current || selectionMode !== "lasso") return;
    const wrap = chartWrapRef.current;
    if (wrap) {
      try {
        wrap.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    }
    const poly = lassoPtsRef.current;
    finishLasso(poly);
  };

  if (error) {
    return <p className="text-rose-300 text-xs p-2">{error}</p>;
  }

  const pathD =
    lassoPts.length > 0
      ? `M ${lassoPts.map((p) => `${p.x},${p.y}`).join(" L ")} Z`
      : "";

  return (
    <div ref={measureRef} className="w-full min-w-0">
      {selectionMode === "lasso" ? (
        <p className="text-[10px] text-slate-400 mb-1">
          Drag to lasso · scroll to zoom · Shift-drag to pan · red = selection ·
          green = action queue
        </p>
      ) : null}
      {spec && size.width > 0 ? (
        <div
          ref={chartWrapRef}
          className="overflow-hidden relative"
          style={{
            width: size.width,
            minHeight: size.height,
            touchAction: selectionMode === "lasso" ? "none" : undefined,
            cursor: selectionMode === "lasso" ? "crosshair" : undefined,
          }}
          onPointerDown={selectionMode === "lasso" ? onPointerDown : undefined}
          onPointerMove={selectionMode === "lasso" ? onPointerMove : undefined}
          onPointerUp={selectionMode === "lasso" ? onPointerUp : undefined}
          onPointerCancel={selectionMode === "lasso" ? onPointerUp : undefined}
        >
          <VegaEmbed
            spec={spec}
            options={{ actions: false, renderer: "canvas" }}
            onEmbed={onEmbed}
          />
          {selectionMode === "lasso" ? (
            <svg
              ref={overlayRef}
              className="absolute inset-0 z-10"
              width="100%"
              height="100%"
              style={{ pointerEvents: "none" }}
            >
              {pathD ? (
                <path
                  d={pathD}
                  fill="rgba(56,189,248,0.18)"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ) : null}
            </svg>
          ) : null}
        </div>
      ) : (
        <p className="text-slate-500 text-xs">Loading chart…</p>
      )}
    </div>
  );
}

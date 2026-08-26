import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import { loadCratePreview } from "../lib/arrayPreview";
import {
  floatToGrayImageData,
  maskToRgbaImageData,
} from "../lib/downsample";
import {
  legendColorFn,
  resolveMaskLegend,
  type MaskLegend,
} from "../lib/maskLegend";
import type { CrateMetadata } from "../lib/tiledCrates";
import type { ClassMaskBinding, ParsedSchema } from "../lib/schema";
import { primaryClassMaskBinding } from "../lib/schema";

export type PreviewViewerConfig = {
  /** Baseline downsample factor at zoom=1 (source edge / preview edge). */
  stride?: number;
  /** Fetch denser than display before Gaussian/majority filter. */
  oversample?: number;
  /** Overlay semantic mask when present. */
  mask_overlay?: boolean;
  /** Mask overlay opacity 0–1. */
  mask_opacity?: number;
  /** LinkML enum name for the mask legend. */
  mask_legend_enum?: string;
  /** Facility color overrides. */
  mask_colors?: Record<string, string>;
};

type Props = {
  uuid: string;
  imageChild: string;
  maskChild?: string | null;
  config?: PreviewViewerConfig;
  /** Schema + crate metadata used to resolve the mask legend. */
  schema?: ParsedSchema | null;
  crateMeta?: CrateMetadata | null;
  label?: string;
  className?: string;
};

type LevelCache = {
  imageData: ImageData;
  mask: Uint8Array | null;
  w: number;
  h: number;
  info: string;
  classIds: number[];
  fetchStep: number;
};

/** Effective stride shrinks as zoom grows (more pixels on screen). */
function strideForZoom(baseStride: number, zoom: number): number {
  const s = Math.round(baseStride / Math.max(zoom, 0.5));
  return Math.min(baseStride, Math.max(1, s));
}

const REFINE_DEBOUNCE_MS = 180;

/**
 * Pan/zoom crate preview: Gaussian-downsampled image + colored mask overlay.
 * Zoom CSS-scales immediately; after a short debounce we re-fetch a finer
 * (or coarser) level so resolution tracks zoom. Cheap for 2560² float32 locally.
 */
export default function ZoomableTiledImage({
  uuid,
  imageChild,
  maskChild = null,
  config,
  schema = null,
  crateMeta = null,
  label,
  className = "",
}: Props) {
  const baseStride = config?.stride ?? 8;
  const oversample = config?.oversample ?? 4;
  const defaultOverlay = config?.mask_overlay !== false;
  const defaultOpacity = config?.mask_opacity ?? 0.45;
  const legendEnum = config?.mask_legend_enum;
  const colorOverrides = config?.mask_colors;
  const binding: ClassMaskBinding | null = useMemo(() => {
    const fromSchema = primaryClassMaskBinding(schema);
    if (fromSchema) return fromSchema;
    if (imageChild && maskChild) {
      return {
        primary_child: imageChild,
        mask_child: maskChild,
        legend_enum: legendEnum,
      };
    }
    return null;
  }, [schema, imageChild, maskChild, legendEnum]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cacheRef = useRef<Map<number, LevelCache>>(new Map());
  const loadedStrideRef = useRef<number | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [overlayOn, setOverlayOn] = useState(defaultOverlay);
  const [opacity, setOpacity] = useState(defaultOpacity);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string>("");
  const [hasMask, setHasMask] = useState(false);
  const [classIds, setClassIds] = useState<number[]>([]);
  const [loadedStride, setLoadedStride] = useState<number | null>(null);

  const legend: MaskLegend = useMemo(
    () =>
      resolveMaskLegend({
        schema,
        meta: crateMeta,
        binding,
        enumName: legendEnum ?? binding?.legend_enum,
        observedIds: classIds.length > 0 ? classIds : undefined,
        colorOverrides,
      }),
    [schema, crateMeta, binding, legendEnum, classIds, colorOverrides],
  );

  const colorOf = useMemo(() => legendColorFn(legend), [legend]);

  const drag = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ active: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const imageDataRef = useRef<ImageData | null>(null);
  const maskDataRef = useRef<Uint8Array | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  const wantStride = useMemo(
    () => strideForZoom(baseStride, zoom),
    [baseStride, zoom],
  );

  const applyLevel = useCallback((stride: number, level: LevelCache) => {
    imageDataRef.current = level.imageData;
    maskDataRef.current = level.mask;
    sizeRef.current = { w: level.w, h: level.h };
    loadedStrideRef.current = stride;
    setLoadedStride(stride);
    setHasMask(Boolean(level.mask));
    setClassIds(level.classIds);
    setInfo(level.info);
    setStatus("ready");
    setError(null);
  }, []);

  const paintComposite = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageDataRef.current;
    if (!canvas || !img) return;
    const { w, h } = sizeRef.current;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = document.createElement("canvas");
    base.width = w;
    base.height = h;
    const bctx = base.getContext("2d");
    if (!bctx) return;
    bctx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base, 0, 0);

    if (overlayOn && maskDataRef.current) {
      const overlay = maskToRgbaImageData(
        maskDataRef.current,
        h,
        w,
        opacity,
        colorOf,
      );
      const oc = document.createElement("canvas");
      oc.width = w;
      oc.height = h;
      const octx = oc.getContext("2d");
      if (!octx) return;
      octx.putImageData(overlay, 0, 0);
      ctx.drawImage(oc, 0, 0);
    }
  }, [opacity, overlayOn, colorOf]);

  useEffect(() => {
    paintComposite();
  }, [paintComposite, loadedStride]);

  // Reset cache when the crate / children / base settings change
  useEffect(() => {
    cacheRef.current.clear();
    loadedStrideRef.current = null;
    setLoadedStride(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setStatus("loading");
    setError(null);
  }, [uuid, imageChild, maskChild, baseStride, oversample]);

  // Load (or refine) the level for the current zoom stride
  useEffect(() => {
    let cancelled = false;
    const cached = cacheRef.current.get(wantStride);
    if (cached) {
      applyLevel(wantStride, cached);
      setRefining(false);
      return;
    }

    const hasSomething = loadedStrideRef.current != null;
    const timer = window.setTimeout(async () => {
      if (cancelled) return;
      if (hasSomething) setRefining(true);
      else setStatus("loading");

      try {
        const preview = await loadCratePreview({
          uuid,
          imageChild,
          maskChild,
          stride: wantStride,
          oversample,
        });
        if (cancelled) return;
        if (!preview.image) throw new Error("No image samples");

        const imageData = floatToGrayImageData(
          preview.image,
          preview.height,
          preview.width,
        );
        const level: LevelCache = {
          imageData,
          mask: preview.mask ?? null,
          w: preview.width,
          h: preview.height,
          fetchStep: preview.fetchStep,
          classIds: preview.mask
            ? [...new Set(preview.mask)].sort((a, b) => a - b)
            : [],
          info: `${preview.sourceShape[0]}×${preview.sourceShape[1]} → ${preview.width}×${preview.height} · fetch ::${preview.fetchStep} · stride ${wantStride}`,
        };
        cacheRef.current.set(wantStride, level);
        applyLevel(wantStride, level);
      } catch (e) {
        if (cancelled) return;
        if (!hasSomething) {
          setStatus("error");
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setRefining(false);
      }
    }, hasSomething ? REFINE_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    uuid,
    imageChild,
    maskChild,
    wantStride,
    oversample,
    applyLevel,
  ]);

  const clampZoom = useCallback(
    (z: number) => Math.min(16, Math.max(0.5, z)),
    [],
  );

  // Ctrl+Shift+wheel zooms. Plain wheel scrolls the page. Native non-passive
  // listener so preventDefault actually blocks page scroll while zooming
  // (React's onWheel is often passive and cannot).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey && e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();

      let dy = e.deltaY;
      if (dy === 0) dy = e.deltaX;
      if (dy === 0) return;

      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        dy *= 16;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        dy *= window.innerHeight;
      }

      // Scroll up (negative dy on most mice) → zoom in; down → zoom out.
      const factor = Math.exp(-dy * 0.002);
      setZoom((z) => clampZoom(z * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [clampZoom]);

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!drag.current.active) return;
    setOffset({
      x: drag.current.origX + (e.clientX - drag.current.startX),
      y: drag.current.origY + (e.clientY - drag.current.startY),
    });
  };

  const endDrag = () => {
    drag.current.active = false;
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const legendItems = useMemo(
    () =>
      legend.entries
        // Hide fully transparent entries (typical background class).
        .filter((e) => e.color[3] > 0)
        .filter((e) => classIds.length === 0 || classIds.includes(e.classId))
        .map((e) => ({
          id: e.classId,
          label: e.title,
          color: e.color,
        })),
    [legend, classIds],
  );

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>{label ?? imageChild}</span>
        <div className="flex items-center gap-2">
          {hasMask && (
            <>
              <label className="inline-flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={overlayOn}
                  onChange={(e) => setOverlayOn(e.target.checked)}
                  className="accent-sky-500"
                />
                Overlay
              </label>
              <label className="inline-flex items-center gap-1 tabular-nums">
                α
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={opacity}
                  disabled={!overlayOn}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="w-16 accent-sky-500"
                />
              </label>
            </>
          )}
          <button
            type="button"
            className="p-1 rounded hover:bg-slate-700 text-slate-200"
            onClick={() => setZoom((z) => clampZoom(z / 1.25))}
            aria-label="Zoom out"
          >
            <MagnifyingGlassMinus size={16} />
          </button>
          <span className="tabular-nums w-14 text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            type="button"
            className="p-1 rounded hover:bg-slate-700 text-slate-200"
            onClick={() => setZoom((z) => clampZoom(z * 1.25))}
            aria-label="Zoom in"
          >
            <MagnifyingGlassPlus size={16} />
          </button>
          <button
            type="button"
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
            onClick={resetView}
          >
            Reset
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="relative flex items-center justify-center overflow-hidden rounded-md border border-slate-700 bg-slate-950 cursor-grab active:cursor-grabbing select-none"
        style={{ width: "100%", aspectRatio: "1 / 1" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {status === "loading" && (
          <p className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm z-10">
            Loading preview…
          </p>
        )}
        {status === "error" && (
          <p className="absolute inset-0 flex items-center justify-center text-rose-300 text-sm p-4 text-center z-10">
            {error}
          </p>
        )}
        {refining && (
          <p className="absolute top-2 right-2 z-10 rounded bg-slate-900/80 px-2 py-0.5 text-[10px] text-sky-300">
            Refining… stride {wantStride}
          </p>
        )}
        <canvas
          ref={canvasRef}
          className="pointer-events-none max-w-full max-h-full"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            width: "100%",
            height: "100%",
            objectFit: "contain",
          }}
        />
      </div>

      {legendItems.length > 0 && overlayOn && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          {legendItems.map((item) => (
            <li key={item.id} className="inline-flex items-center gap-1">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm border border-slate-600"
                style={{
                  backgroundColor: `rgba(${item.color[0]},${item.color[1]},${item.color[2]},0.9)`,
                }}
              />
              <span
                style={{
                  color: `rgb(${item.color[0]},${item.color[1]},${item.color[2]})`,
                }}
              >
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!legend.consistent && legend.issues.length > 0 && (
        <p className="text-[11px] text-amber-400/90">
          Mask legend inconsistent with schema/{legend.enumName}:{" "}
          {legend.issues.slice(0, 3).join("; ")}
          {legend.issues.length > 3 ? "…" : ""}
        </p>
      )}

      <p className="text-[11px] text-slate-500">
        Ctrl+Shift+scroll to zoom · drag to pan
        {info ? ` · ${info}` : ""}
        {loadedStride != null
          ? ` · zoom stride ${loadedStride}${wantStride !== loadedStride ? `→${wantStride}` : ""}`
          : ""}
        {hasMask
          ? legend.consistent
            ? ` · legend from ${legend.enumName} (consistent)`
            : " · mask overlay (legend fallback / check warnings)"
          : " · no mask child"}
      </p>
    </div>
  );
}

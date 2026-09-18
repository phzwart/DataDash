import { recordSessionEvent } from "./sessionLog";
import type { CombineMode } from "./bookContext";

const STORAGE_KEY = "lambda.plot_selection";
const CHANGE_EVENT = "lambda-plot-selection-changed";

export type PlotBrush = {
  title: string;
  ids: string[];
};

export type PlotSelection = {
  ids: string[];
  source: string | null;
  mode: CombineMode;
  brushes: Record<string, PlotBrush>;
};

function empty(): PlotSelection {
  return { ids: [], source: null, mode: "or", brushes: {} };
}

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function foldBrushes(
  brushes: Record<string, PlotBrush>,
  mode: CombineMode,
): { ids: string[]; source: string | null } {
  const active = Object.values(brushes).filter((b) => b.ids.length > 0);
  if (!active.length) return { ids: [], source: null };
  const titles = active.map((b) => b.title);
  const join = mode === "and" ? " ∩ " : " ∪ ";
  const source = `${mode.toUpperCase()} · ${titles.join(join)}`;
  if (mode === "or") {
    return { ids: [...new Set(active.flatMap((b) => b.ids))], source };
  }
  let ids = new Set(active[0].ids);
  for (const brush of active.slice(1)) {
    const keep = new Set(brush.ids);
    ids = new Set([...ids].filter((id) => keep.has(id)));
  }
  return { ids: [...ids], source };
}

function read(): PlotSelection {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<PlotSelection>;
    const ids = Array.isArray(parsed.ids)
      ? [...new Set(parsed.ids.filter((x): x is string => typeof x === "string"))]
      : [];
    const source =
      typeof parsed.source === "string" && parsed.source.trim()
        ? parsed.source.trim()
        : null;
    const mode: CombineMode = parsed.mode === "and" ? "and" : "or";
    const brushes: Record<string, PlotBrush> = {};
    if (parsed.brushes && typeof parsed.brushes === "object") {
      for (const [key, val] of Object.entries(parsed.brushes)) {
        if (!val || typeof val !== "object") continue;
        const title = typeof val.title === "string" ? val.title : key;
        const brushIds = Array.isArray(val.ids)
          ? val.ids.filter((x): x is string => typeof x === "string")
          : [];
        if (brushIds.length) brushes[key] = { title, ids: brushIds };
      }
    }
    return { ids, source, mode, brushes };
  } catch {
    return empty();
  }
}

function write(sel: PlotSelection): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ids: [...new Set(sel.ids)],
      source: sel.source,
      mode: sel.mode,
      brushes: sel.brushes,
    }),
  );
  notify();
}

function commitFold(prev: PlotSelection): void {
  const folded = foldBrushes(prev.brushes, prev.mode);
  write({
    ...prev,
    ids: folded.ids,
    source: folded.source,
  });
  if (folded.ids.length > 0) {
    recordSessionEvent({
      type: "selection",
      crateIds: folded.ids,
      detail: { source: folded.source, count: folded.ids.length, mode: prev.mode },
    });
  }
}

export function getPlotSelection(): PlotSelection {
  return read();
}

export function setPlotSelection(ids: string[], source: string | null): void {
  const prev = read();
  const unique = [...new Set(ids)];
  const brushes =
    source && unique.length
      ? { ...prev.brushes, [source]: { title: source, ids: unique } }
      : unique.length
        ? prev.brushes
        : {};
  write({
    ids: unique,
    source: unique.length > 0 ? source : null,
    mode: prev.mode,
    brushes,
  });
  if (unique.length > 0) {
    recordSessionEvent({
      type: "selection",
      crateIds: unique,
      detail: { source: source ?? null, count: unique.length },
    });
  }
}

/** Record one plot's brush and fold union (OR) or intersection (AND). */
export function setPlotBrush(plotId: string, title: string, ids: string[]): void {
  const prev = read();
  const unique = [...new Set(ids)];
  const brushes = { ...prev.brushes };
  if (!unique.length) delete brushes[plotId];
  else brushes[plotId] = { title, ids: unique };
  commitFold({ ...prev, brushes });
}

export function setCombineMode(mode: CombineMode): void {
  const prev = read();
  if (prev.mode === mode) return;
  commitFold({ ...prev, mode });
}

export function getPlotBrushes(): Record<string, PlotBrush> {
  return read().brushes;
}

export function getCombineMode(): CombineMode {
  return read().mode;
}

export function clipPlotSelectionToUniverse(universeIds: string[]): void {
  const prev = read();
  const allow = new Set(universeIds);
  const brushes: Record<string, PlotBrush> = {};
  let brushesChanged = false;
  for (const [key, brush] of Object.entries(prev.brushes)) {
    const ids = brush.ids.filter((id) => allow.has(id));
    if (ids.length !== brush.ids.length) brushesChanged = true;
    if (ids.length) brushes[key] = { ...brush, ids };
    else brushesChanged = true;
  }
  const folded = foldBrushes(brushes, prev.mode);
  const idsChanged =
    folded.ids.length !== prev.ids.length ||
    folded.ids.some((id) => !prev.ids.includes(id));
  if (!brushesChanged && !idsChanged && folded.source === prev.source) return;
  write({
    ids: folded.ids,
    source: folded.source,
    mode: prev.mode,
    brushes,
  });
}

export function clearPlotSelection(): void {
  const prev = read();
  write({ ids: [], source: null, mode: prev.mode, brushes: {} });
  if (prev.ids.length) {
    recordSessionEvent({
      type: "selection",
      crateIds: [],
      detail: { source: null, count: 0, cleared: true },
    });
  }
}

/** Remove one experiment from the active plot selection. */
export function removeFromPlotSelection(id: string): void {
  const prev = read();
  const brushes: Record<string, PlotBrush> = {};
  for (const [key, brush] of Object.entries(prev.brushes)) {
    const ids = brush.ids.filter((x) => x !== id);
    if (ids.length) brushes[key] = { ...brush, ids };
  }
  commitFold({ ...prev, brushes });
}

export function subscribePlotSelection(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export { STORAGE_KEY, CHANGE_EVENT };

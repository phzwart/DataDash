import { recordSessionEvent } from "./sessionLog";

const STORAGE_KEY = "lambda.plot_selection";
const CHANGE_EVENT = "lambda-plot-selection-changed";

export type PlotSelection = {
  ids: string[];
  source: string | null;
};

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function read(): PlotSelection {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ids: [], source: null };
    const parsed = JSON.parse(raw) as Partial<PlotSelection>;
    const ids = Array.isArray(parsed.ids)
      ? [...new Set(parsed.ids.filter((x): x is string => typeof x === "string"))]
      : [];
    const source =
      typeof parsed.source === "string" && parsed.source.trim()
        ? parsed.source.trim()
        : null;
    return { ids, source };
  } catch {
    return { ids: [], source: null };
  }
}

function write(sel: PlotSelection): void {
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ids: [...new Set(sel.ids)],
      source: sel.source,
    }),
  );
  notify();
}

export function getPlotSelection(): PlotSelection {
  return read();
}

export function setPlotSelection(ids: string[], source: string | null): void {
  const unique = [...new Set(ids)];
  write({
    ids: unique,
    source: unique.length > 0 ? source : null,
  });
  if (unique.length > 0) {
    recordSessionEvent({
      type: "selection",
      crateIds: unique,
      detail: { source: source ?? null, count: unique.length },
    });
  }
}

export function clearPlotSelection(): void {
  const prev = read();
  write({ ids: [], source: null });
  if (prev.ids.length) {
    recordSessionEvent({
      type: "selection",
      crateIds: [],
      detail: { source: null, count: 0, cleared: true },
    });
  }
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

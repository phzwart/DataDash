import { useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

const STORAGE_KEY = "lambda.book_context.v1";
const CHANGE_EVENT = "lambda-book-context-changed";

export type OrganizeScope = "inbox" | "project" | "all";
export type CombineMode = "or" | "and";

export type BookContext = {
  projectId: string | null;
  subId: string | null;
  scope: OrganizeScope;
  instrument: string;
  dateFrom: string;
  dateTo: string;
  combine: CombineMode;
};

const DEFAULTS: BookContext = {
  projectId: null,
  subId: null,
  scope: "project",
  instrument: "",
  dateFrom: "",
  dateTo: "",
  combine: "or",
};

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function parse(raw: unknown): BookContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const r = raw as Record<string, unknown>;
  const scope: OrganizeScope =
    r.scope === "project" || r.scope === "all" || r.scope === "inbox"
      ? r.scope
      : "inbox";
  const combine: CombineMode = r.combine === "and" ? "and" : "or";
  return {
    projectId: typeof r.projectId === "string" && r.projectId ? r.projectId : null,
    subId: typeof r.subId === "string" && r.subId ? r.subId : null,
    scope,
    instrument: typeof r.instrument === "string" ? r.instrument : "",
    dateFrom: typeof r.dateFrom === "string" ? r.dateFrom : "",
    dateTo: typeof r.dateTo === "string" ? r.dateTo : "",
    combine,
  };
}

let cachedRaw: string | null = null;
let cached: BookContext = { ...DEFAULTS };

function read(): BookContext {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === cachedRaw) return cached;
    cachedRaw = raw;
    cached = raw ? parse(JSON.parse(raw)) : { ...DEFAULTS };
    return cached;
  } catch {
    cachedRaw = null;
    cached = { ...DEFAULTS };
    return cached;
  }
}

function write(next: BookContext): BookContext {
  let ctx = next;
  if (!ctx.projectId && ctx.scope === "project") {
    ctx = { ...ctx, scope: "inbox" };
  }
  const serialized = JSON.stringify(ctx);
  if (serialized === cachedRaw) return cached;
  sessionStorage.setItem(STORAGE_KEY, serialized);
  cachedRaw = serialized;
  cached = ctx;
  notify();
  return ctx;
}

export function readBookContext(): BookContext {
  return read();
}

export function writeBookContext(patch: Partial<BookContext>): BookContext {
  const prev = read();
  return write({ ...prev, ...patch });
}

export function subscribeBookContext(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useBookContext(): [BookContext, (patch: Partial<BookContext>) => BookContext] {
  const ctx = useSyncExternalStore(subscribeBookContext, read, read);
  return [ctx, writeBookContext];
}

/** Persist ?project= / ?sub= and keep the URL in sync with the book. */
export function useBookSearchSync(): BookContext {
  const [params, setParams] = useSearchParams();
  const [ctx, setBook] = useBookContext();
  const urlProject = params.get("project");
  const urlSub = params.get("sub");

  useEffect(() => {
    if (urlProject) {
      const nextSub = urlSub || null;
      if (urlProject !== ctx.projectId || nextSub !== ctx.subId) {
        setBook({ projectId: urlProject, subId: nextSub });
      }
      return;
    }
    if (ctx.projectId) {
      const next = new URLSearchParams();
      next.set("project", ctx.projectId);
      if (ctx.subId) next.set("sub", ctx.subId);
      setParams(next, { replace: true });
    }
  }, [urlProject, urlSub, ctx.projectId, ctx.subId, setBook, setParams]);

  return ctx;
}

export function bookQueryString(ctx: Pick<BookContext, "projectId" | "subId">): string {
  const q = new URLSearchParams();
  if (ctx.projectId) q.set("project", ctx.projectId);
  if (ctx.subId) q.set("sub", ctx.subId);
  const s = q.toString();
  return s ? `?${s}` : "";
}

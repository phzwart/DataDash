import { getStoredDashboardUri } from "./dashboardConfig";
import { getTiledApiKey, getTiledOrigin } from "./tiledServer";

export type SessionEventType =
  | "note"
  | "push"
  | "selection"
  | "cart_add"
  | "cart_replace"
  | "cart_remove"
  | "cart_clear"
  | "session_download"
  | "session_push";

export type SessionEvent = {
  id: string;
  type: SessionEventType;
  at: number;
  text?: string;
  crateIds?: string[];
  crateLabels?: string[];
  detail?: Record<string, unknown>;
};

export type SessionDocument = {
  schema: "lambda.session_log/v1";
  session_id: string;
  started_at: string;
  exported_at: string;
  source: {
    tiled_origin: string;
    dashboard_uri: string | null;
  };
  snapshot: {
    cart_ids: string[];
    selection: { ids: string[]; source: string | null };
  };
  events: SessionEvent[];
};

const SESSION_META_KEY = "lambda.session_meta";
const EVENTS_KEY = "lambda.session_events";
/** Legacy notes key — migrated once into session events. */
const LEGACY_NOTES_KEY = "lambda.notes_log";
const CART_KEY = "lambda.crate_cart";
const SELECTION_KEY = "lambda.plot_selection";
const CHANGE_EVENT = "lambda-session-changed";

const SCHEMA = "lambda.session_log/v1" as const;

type SessionMeta = {
  sessionId: string;
  startedAt: number;
};

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readMeta(): SessionMeta {
  try {
    const raw = localStorage.getItem(SESSION_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SessionMeta>;
      if (
        typeof parsed.sessionId === "string" &&
        typeof parsed.startedAt === "number"
      ) {
        return {
          sessionId: parsed.sessionId,
          startedAt: parsed.startedAt,
        };
      }
    }
  } catch {
    /* fall through */
  }
  const meta: SessionMeta = {
    sessionId: newId(),
    startedAt: Date.now(),
  };
  localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
  return meta;
}

function writeMeta(meta: SessionMeta): void {
  localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta));
}

function isEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.type === "string" &&
    typeof e.at === "number"
  );
}

function migrateLegacyNotes(): void {
  try {
    const existing = localStorage.getItem(EVENTS_KEY);
    if (existing) return;
    const raw = localStorage.getItem(LEGACY_NOTES_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    const events: SessionEvent[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const n = item as Record<string, unknown>;
      if (typeof n.id !== "string" || typeof n.createdAt !== "number") continue;
      const crateIds = Array.isArray(n.crateIds)
        ? n.crateIds.filter((x): x is string => typeof x === "string")
        : [];
      const crateLabels = Array.isArray(n.crateLabels)
        ? n.crateLabels.filter((x): x is string => typeof x === "string")
        : [];
      const text = typeof n.text === "string" ? n.text : "";
      events.push({
        id: n.id,
        type: crateIds.length > 0 && !text ? "push" : "note",
        at: n.createdAt,
        text: text || undefined,
        crateIds: crateIds.length ? crateIds : undefined,
        crateLabels: crateLabels.length ? crateLabels : undefined,
      });
    }
    if (events.length) {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
    }
  } catch {
    /* ignore */
  }
}

export function getSessionEvents(): SessionEvent[] {
  migrateLegacyNotes();
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvent);
  } catch {
    return [];
  }
}

function writeEvents(events: SessionEvent[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  notify();
}

export function getSessionMeta(): SessionMeta {
  return readMeta();
}

/** Append a session event (newest first). */
export function recordSessionEvent(
  partial: Omit<SessionEvent, "id" | "at"> & { id?: string; at?: number },
): SessionEvent {
  const event: SessionEvent = {
    id: partial.id ?? newId(),
    type: partial.type,
    at: partial.at ?? Date.now(),
    text: partial.text?.trim() || undefined,
    crateIds: partial.crateIds?.length
      ? [...new Set(partial.crateIds)]
      : undefined,
    crateLabels: partial.crateLabels?.length ? partial.crateLabels : undefined,
    detail: partial.detail,
  };
  writeEvents([event, ...getSessionEvents()]);
  return event;
}

export function removeSessionEvent(id: string): void {
  writeEvents(getSessionEvents().filter((e) => e.id !== id));
}

export function clearSessionEvents(): void {
  writeEvents([]);
}

/** Start a fresh session (new id); keeps or clears events based on flag. */
export function startNewSession(clearEvents = true): SessionMeta {
  const meta: SessionMeta = {
    sessionId: newId(),
    startedAt: Date.now(),
  };
  writeMeta(meta);
  if (clearEvents) writeEvents([]);
  else notify();
  return meta;
}

export function subscribeSessionLog(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function buildSessionDocument(): SessionDocument {
  const meta = readMeta();
  return {
    schema: SCHEMA,
    session_id: meta.sessionId,
    started_at: new Date(meta.startedAt).toISOString(),
    exported_at: new Date().toISOString(),
    source: {
      tiled_origin: getTiledOrigin(),
      dashboard_uri: getStoredDashboardUri(),
    },
    snapshot: {
      cart_ids: readCartIds(),
      selection: readSelection(),
    },
    events: getSessionEvents(),
  };
}

function readCartIds(): string[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string"))];
  } catch {
    return [];
  }
}

function readSelection(): { ids: string[]; source: string | null } {
  try {
    const raw = sessionStorage.getItem(SELECTION_KEY);
    if (!raw) return { ids: [], source: null };
    const parsed = JSON.parse(raw) as {
      ids?: unknown;
      source?: unknown;
    };
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

export function downloadSessionDocument(doc?: SessionDocument): string {
  const payload = doc ?? buildSessionDocument();
  recordSessionEvent({
    type: "session_download",
    detail: { event_count: payload.events.length },
  });
  // Re-build so the download event is included.
  const finalDoc = buildSessionDocument();
  const filename = `session_${finalDoc.session_id.slice(0, 8)}_${stamp()}.json`;
  const blob = new Blob([JSON.stringify(finalDoc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export type SessionPushResult = {
  ok: boolean;
  filename?: string;
  path?: string;
  detail: string;
};

/**
 * POST session JSON to the Tiled host at `/session-logs`.
 * Auth: same Apikey as Tiled reads.
 */
export async function pushSessionDocumentToServer(
  doc?: SessionDocument,
): Promise<SessionPushResult> {
  const document = doc ?? buildSessionDocument();
  const origin = getTiledOrigin();
  const apiKey = getTiledApiKey();
  try {
    const res = await fetch(`${origin}/session-logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Apikey ${apiKey}` } : {}),
      },
      body: JSON.stringify(document),
    });
    const body = (await res.json().catch(() => ({}))) as {
      filename?: string;
      path?: string;
      detail?: string;
      error?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        detail:
          body.detail ||
          body.error ||
          `HTTP ${res.status} — is the server running with session-logs support?`,
      };
    }
    recordSessionEvent({
      type: "session_push",
      detail: {
        filename: body.filename,
        path: body.path,
      },
    });
    return {
      ok: true,
      filename: body.filename,
      path: body.path,
      detail: body.filename
        ? `Saved ${body.filename}`
        : "Saved on server",
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Note helpers used by the Notes UI / Push button. */
export function addNote(
  text: string,
  crates: { id: string; label?: string }[] = [],
): SessionEvent {
  const cleaned = crates.filter((c) => c.id);
  return recordSessionEvent({
    type: cleaned.length > 0 && !text.trim() ? "push" : "note",
    text: text.trim() || undefined,
    crateIds: cleaned.map((c) => c.id),
    crateLabels: cleaned.map((c) => c.label?.trim() || c.id),
  });
}

export function pushCratesToLog(
  crates: { id: string; label?: string }[],
  text = "",
): SessionEvent | null {
  const cleaned = crates.filter((c) => typeof c.id === "string" && c.id);
  if (cleaned.length === 0 && !text.trim()) return null;
  return addNote(text, cleaned);
}

export { CHANGE_EVENT, EVENTS_KEY, SESSION_META_KEY, SCHEMA };

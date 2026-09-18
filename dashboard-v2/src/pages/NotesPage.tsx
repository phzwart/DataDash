import { useEffect, useState } from "react";
import {
  CloudArrowUp,
  DownloadSimple,
  NotePencil,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  addNote,
  clearNotesLog,
  getNotesLog,
  openCrateInMainWindow,
  removeNote,
  setNotesWindowWantOpen,
  subscribeNotesLog,
  type NotesLogEntry,
} from "../lib/notesLog";
import {
  downloadSessionDocument,
  getSessionMeta,
  pushSessionDocumentToServer,
  startNewSession,
} from "../lib/sessionLog";
import { shortId } from "../lib/tiledCrates";

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts);
  }
}

function typeLabel(type: string): string {
  switch (type) {
    case "note":
      return "note";
    case "push":
      return "push";
    case "selection":
      return "selection";
    case "cart_add":
      return "cart +";
    case "cart_replace":
      return "cart =";
    case "cart_remove":
      return "cart −";
    case "cart_clear":
      return "cart clear";
    case "session_download":
      return "download";
    case "session_push":
      return "pushed";
    default:
      return type;
  }
}

function LogEntryRow({
  entry,
  onRemove,
}: {
  entry: NotesLogEntry;
  onRemove: () => void;
}) {
  const crateIds = entry.crateIds ?? [];
  const crateLabels = entry.crateLabels ?? [];
  return (
    <li className="rounded-md border border-sky-100 bg-white p-2.5 space-y-1.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 shrink-0">
            {typeLabel(entry.type)}
          </span>
          <time className="text-[10px] uppercase tracking-wide text-slate-500">
            {formatTime(entry.at)}
          </time>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-400 hover:text-rose-600 p-0.5"
          title="Remove entry"
          aria-label="Remove entry"
        >
          <X size={12} />
        </button>
      </div>
      {entry.text ? (
        <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">
          {entry.text}
        </p>
      ) : null}
      {entry.detail &&
        (entry.type === "selection" || entry.type.startsWith("cart")) && (
          <p className="text-[11px] text-slate-500 font-mono truncate">
            {typeof entry.detail.source === "string"
              ? `from ${entry.detail.source} · `
              : ""}
            {crateIds.length} crate{crateIds.length === 1 ? "" : "s"}
          </p>
        )}
      {crateIds.length > 0 && crateIds.length <= 12 && (
        <ul className="flex flex-wrap gap-1">
          {crateIds.map((id, i) => {
            const label = crateLabels[i] || shortId(id);
            return (
              <li key={`${entry.id}-${id}`}>
                <button
                  type="button"
                  onClick={() => openCrateInMainWindow(id)}
                  className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 hover:bg-sky-100 font-mono border border-sky-100 cursor-pointer"
                  title={`Open ${id} in main window`}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {crateIds.length > 12 && (
        <p className="text-[11px] text-slate-500">
          {crateIds.length} crates (see exported JSON for full list)
        </p>
      )}
    </li>
  );
}

/**
 * Standalone Session / Notes UI for the separate OS popup window.
 * Light content shell matches Finch main panel; header matches sidebar sky-950.
 */
export default function NotesPage() {
  const [entries, setEntries] = useState<NotesLogEntry[]>(() => getNotesLog());
  const [meta, setMeta] = useState(() => getSessionMeta());
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = "Session log · Lambda MX";
    document.documentElement.classList.add("notes-popup");
    document.body.classList.add("notes-popup");
    setNotesWindowWantOpen(true);
    const onUnload = () => setNotesWindowWantOpen(false);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.documentElement.classList.remove("notes-popup");
      document.body.classList.remove("notes-popup");
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  useEffect(
    () =>
      subscribeNotesLog(() => {
        setEntries(getNotesLog());
        setMeta(getSessionMeta());
      }),
    [],
  );

  const submitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    addNote(text);
    setDraft("");
  };

  const onDownload = () => {
    try {
      const filename = downloadSessionDocument();
      setStatus(`Downloaded ${filename}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const onPush = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result = await pushSessionDocumentToServer();
      setStatus(result.detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full min-h-screen flex flex-col bg-sky-50 text-slate-800">
      <header className="flex items-center gap-2 px-3 py-2.5 bg-sky-950 border-b border-sky-900 shrink-0">
        <NotePencil size={18} className="text-sky-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold truncate text-slate-100">
            Session log
          </h1>
          <p className="text-[10px] text-sky-300/80 truncate font-mono">
            {meta.sessionId.slice(0, 8)}…
          </p>
        </div>
        <span className="text-xs text-sky-200/90 tabular-nums">
          {entries.length}
        </span>
      </header>

      <div className="p-3 border-b border-sky-100 space-y-2 shrink-0 bg-white">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submitDraft();
            }
          }}
          rows={2}
          placeholder="Add a note… (⌘/Ctrl+Enter)"
          className="w-full resize-none rounded-md text-sm px-2 py-1.5 border border-slate-300"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!draft.trim()}
            onClick={submitDraft}
            className="px-2 py-1.5 rounded-md bg-sky-700 text-white text-xs font-medium hover:bg-sky-600 disabled:opacity-40"
          >
            Add note
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="px-2 py-1.5 rounded-md bg-slate-200 text-slate-800 text-xs hover:bg-slate-300 inline-flex items-center gap-1"
            title="Download session JSON"
          >
            <DownloadSimple size={12} />
            JSON
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onPush()}
            className="px-2 py-1.5 rounded-md bg-sky-700 text-white text-xs hover:bg-sky-600 disabled:opacity-40 inline-flex items-center gap-1"
            title="Push session JSON to server (data_root/session_logs)"
          >
            <CloudArrowUp size={12} />
            {busy ? "Pushing…" : "Push to server"}
          </button>
          <button
            type="button"
            disabled={entries.length === 0}
            onClick={() => {
              clearNotesLog();
              setStatus(null);
            }}
            className="px-2 py-1.5 rounded-md bg-slate-100 text-slate-600 text-xs hover:bg-slate-200 disabled:opacity-40 inline-flex items-center gap-1 border border-slate-200"
            title="Clear events"
          >
            <Trash size={12} />
            Clear
          </button>
          <button
            type="button"
            onClick={() => {
              setMeta(startNewSession(true));
              setStatus("Started a new session");
            }}
            className="px-2 py-1.5 rounded-md bg-slate-100 text-slate-600 text-xs hover:bg-slate-200 border border-slate-200"
            title="New session id and empty log"
          >
            New session
          </button>
        </div>
        {status && (
          <p className="text-[11px] text-sky-800 break-words">{status}</p>
        )}
        <p className="text-[10px] text-slate-500 leading-snug">
          Auto-records selections and cart changes.{" "}
          <span className="text-sky-700 font-medium">Push</span> tags crates.
          Export includes cart + selection snapshot as JSON under{" "}
          <code className="text-sky-700">session_logs/</code>.
        </p>
      </div>

      <ul className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0 bg-sky-50">
        {entries.length === 0 ? (
          <li className="text-xs text-slate-500 py-8 text-center">
            Session is empty. Select on Organize, use cart, Push a crate, or type a
            note.
          </li>
        ) : (
          entries.map((entry) => (
            <LogEntryRow
              key={entry.id}
              entry={entry}
              onRemove={() => removeNote(entry.id)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

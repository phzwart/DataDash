/**
 * Notes window helpers + thin re-exports for the session log.
 * Free-text notes and Push actions are session events (see sessionLog.ts).
 */

export {
  addNote,
  pushCratesToLog,
  removeSessionEvent as removeNote,
  clearSessionEvents as clearNotesLog,
  getSessionEvents as getNotesLog,
  subscribeSessionLog as subscribeNotesLog,
  type SessionEvent as NotesLogEntry,
} from "./sessionLog";

/** Named window so reopen focuses the same OS window. */
export const NOTES_WINDOW_NAME = "lambda-notes";

/** Remember that the user wants the notes popup kept open. */
const WINDOW_PREF_KEY = "lambda.notes_window_want_open";

const DEFAULT_FEATURES =
  "popup=yes,width=380,height=640,left=80,top=80,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";

export function isNotesPopupWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.name === NOTES_WINDOW_NAME) return true;
  try {
    return new URLSearchParams(window.location.search).get("popup") === "1";
  } catch {
    return false;
  }
}

export function notesPopupUrl(): string {
  return `${window.location.origin}/notes?popup=1`;
}

export function getNotesWindowWantOpen(): boolean {
  try {
    return localStorage.getItem(WINDOW_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNotesWindowWantOpen(want: boolean): void {
  try {
    localStorage.setItem(WINDOW_PREF_KEY, want ? "1" : "0");
  } catch {
    /* ignore */
  }
}

let notesWindowRef: Window | null = null;

/**
 * Open (or focus) the Notes OS popup window outside the main browser panel.
 * Must be called from a user gesture when the browser blocks automatic popups.
 */
export function openNotesWindow(): Window | null {
  setNotesWindowWantOpen(true);
  try {
    if (notesWindowRef && !notesWindowRef.closed) {
      notesWindowRef.focus();
      return notesWindowRef;
    }
  } catch {
    notesWindowRef = null;
  }

  const win = window.open(
    notesPopupUrl(),
    NOTES_WINDOW_NAME,
    DEFAULT_FEATURES,
  );
  if (win) {
    notesWindowRef = win;
    try {
      win.focus();
    } catch {
      /* ignore */
    }
  }
  return win;
}

/** Focus an existing notes window if we still hold a reference. */
export function focusNotesWindow(): void {
  try {
    if (notesWindowRef && !notesWindowRef.closed) {
      notesWindowRef.focus();
    }
  } catch {
    notesWindowRef = null;
  }
}

/**
 * Open a crate in the main dashboard window (opener), keeping the notes popup put.
 */
export function openCrateInMainWindow(crateId: string): void {
  const path = `/crates/${encodeURIComponent(crateId)}`;
  try {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      opener.focus();
      opener.location.assign(path);
      return;
    }
  } catch {
    /* cross-origin or gone */
  }
  window.open(`${window.location.origin}${path}`, "lambda-main");
}

export { WINDOW_PREF_KEY };

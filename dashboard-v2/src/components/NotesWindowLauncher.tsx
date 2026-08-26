import { useEffect, useState } from "react";
import { NotePencil } from "@phosphor-icons/react";
import {
  getNotesWindowWantOpen,
  openNotesWindow,
} from "../lib/notesLog";

/**
 * Keeps a reopen control in the main app and tries to restore the Notes
 * OS popup when the user previously had it open (may be blocked without a gesture).
 */
export default function NotesWindowLauncher() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!getNotesWindowWantOpen()) return;
    const win = openNotesWindow();
    if (!win) setBlocked(true);
  }, []);

  return (
    <button
      type="button"
      onClick={() => {
        const win = openNotesWindow();
        setBlocked(!win);
      }}
      className="fixed bottom-4 right-4 z-[1000] relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-800/80 bg-sky-950 text-sky-100 shadow-lg shadow-black/40 hover:bg-sky-900"
      title={
        blocked
          ? "Session log — click to open (popup was blocked)"
          : "Open Session log in a separate window"
      }
      aria-label="Open Session log"
    >
      <NotePencil size={18} className="text-sky-300" />
      {blocked ? (
        <span
          className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-sky-950"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

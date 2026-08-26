import { PushPin } from "@phosphor-icons/react";
import { openNotesWindow, pushCratesToLog } from "../lib/notesLog";

type CrateRef = { id: string; label?: string };

type Props = {
  crates: CrateRef[];
  /** Optional note text attached to the push. */
  text?: string;
  className?: string;
  label?: string;
  disabled?: boolean;
};

/**
 * Push crate(s) into the Notes log and focus/open the separate Notes window.
 */
export default function PushToNotesButton({
  crates,
  text = "",
  className = "",
  label = "Push",
  disabled = false,
}: Props) {
  const empty = crates.length === 0;
  return (
    <button
      type="button"
      disabled={disabled || empty}
      onClick={() => {
        pushCratesToLog(crates, text);
        openNotesWindow();
      }}
      className={
        className ||
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-700 text-slate-100 text-sm hover:bg-sky-600 disabled:opacity-40"
      }
      title="Push into Notes window"
    >
      <PushPin size={14} weight="fill" />
      {label}
    </button>
  );
}

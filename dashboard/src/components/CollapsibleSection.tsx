import { useId, type ReactNode } from "react";
import { CaretDown, CaretRight } from "@phosphor-icons/react";

type Props = {
  id?: string;
  title: string;
  summary?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
};

export default function CollapsibleSection({
  id,
  title,
  summary,
  open,
  onOpenChange,
  children,
  className = "",
}: Props) {
  const panelId = useId();

  return (
    <section
      id={id}
      className={`rounded-md border border-slate-700 bg-slate-900/70 overflow-hidden ${className}`}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/50"
      >
        {open ? (
          <CaretDown size={16} className="shrink-0 text-sky-400" />
        ) : (
          <CaretRight size={16} className="shrink-0 text-slate-500" />
        )}
        <span className="text-sm font-medium text-slate-100">{title}</span>
        {!open && summary ? (
          <span className="text-xs text-slate-500 truncate ml-auto max-w-[55%]">
            {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id={panelId} className="px-4 pb-4 pt-1 space-y-4 border-t border-slate-800">
          {children}
        </div>
      ) : null}
    </section>
  );
}

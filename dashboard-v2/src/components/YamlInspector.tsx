import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOut, CaretDown, CaretRight, Copy } from "@phosphor-icons/react";

type Props = {
  /** Absolute URL of a YAML (or other text) file. */
  uri: string | null | undefined;
  title?: string;
  /** Start expanded. */
  defaultOpen?: boolean;
  className?: string;
};

async function fetchText(uri: string): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to fetch ${uri} (${res.status})`);
  return res.text();
}

/**
 * Collapsible raw YAML inspector — fetch + show file contents with open/copy.
 */
export default function YamlInspector({
  uri,
  title,
  defaultOpen = false,
  className = "",
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  const query = useQuery({
    queryKey: ["yaml-inspect", uri],
    queryFn: () => fetchText(uri!),
    enabled: Boolean(uri?.trim()) && open,
    staleTime: 15_000,
    retry: false,
  });

  const label = useMemo(() => {
    if (title) return title;
    if (!uri) return "YAML";
    try {
      const path = new URL(uri).pathname;
      return path.split("/").filter(Boolean).pop() ?? uri;
    } catch {
      return uri;
    }
  }, [title, uri]);

  if (!uri?.trim()) {
    return (
      <p className={`text-xs text-slate-500 ${className}`}>No URI to inspect</p>
    );
  }

  async function copyBody() {
    if (!query.data) return;
    try {
      await navigator.clipboard.writeText(query.data);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`rounded-md border border-slate-700 bg-slate-950/80 overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-800">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-200 hover:text-sky-300 min-w-0 flex-1 text-left"
          aria-expanded={open}
        >
          {open ? (
            <CaretDown size={14} className="shrink-0 text-sky-400" />
          ) : (
            <CaretRight size={14} className="shrink-0 text-slate-500" />
          )}
          <span className="font-medium truncate">{label}</span>
          <span className="text-[10px] text-slate-500 font-mono truncate hidden sm:inline">
            {uri}
          </span>
        </button>
        <a
          href={uri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide bg-slate-800 text-sky-300 hover:bg-slate-700 no-underline"
          title="Open in new tab"
        >
          <ArrowSquareOut size={12} />
          Open
        </a>
        {open && query.data && (
          <button
            type="button"
            onClick={() => void copyBody()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] uppercase tracking-wide bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            <Copy size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-[28rem] overflow-auto">
          {query.isLoading && (
            <p className="p-3 text-xs text-slate-500">Loading…</p>
          )}
          {query.error && (
            <p className="p-3 text-xs text-rose-300">{String(query.error)}</p>
          )}
          {query.data && (
            <pre className="m-0 p-3 text-[11px] leading-relaxed font-mono text-slate-800 bg-slate-100 whitespace-pre overflow-x-auto">
              {query.data}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

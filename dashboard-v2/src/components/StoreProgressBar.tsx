import { hydrateProgressPercent, type HydrateProgress } from "../lib/hydrateApi";

type Props = {
  progress: HydrateProgress | null;
  pending: boolean;
  className?: string;
};

export default function StoreProgressBar({
  progress,
  pending,
  className = "",
}: Props) {
  if (!pending && !progress) return null;

  const pct = hydrateProgressPercent(progress);
  const label =
    progress?.message ||
    (pending ? "Starting store to local Tiled…" : "");
  const uuid = progress?.uuid;

  return (
    <div
      className={`rounded-md border border-emerald-700/40 bg-emerald-950/40 p-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-emerald-100">{label}</span>
        <span className="tabular-nums text-emerald-300/90">
          {progress?.current != null && progress?.total != null
            ? `${progress.current}/${progress.total}`
            : null}
          {pct > 0 ? ` · ${pct}%` : null}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-950">
        <div
          className="h-full rounded-full bg-emerald-400 transition-[width] duration-200 ease-out"
          style={{ width: `${Math.max(pct, pending ? 3 : 0)}%` }}
        />
      </div>
      {uuid ? (
        <p className="mt-1.5 truncate font-mono text-[11px] text-emerald-200/70">
          {uuid}
        </p>
      ) : null}
    </div>
  );
}

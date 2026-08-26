import { useEffect, useState } from "react";
import {
  COLOR_TAG_OPTIONS,
  getCrateMarkerStore,
  subscribeCrateMarkers,
  type CrateColorTagFilter,
  type CrateStarRating,
  type MarkerSortMode,
} from "../lib/crateMarkers";

export type MarkerFilters = {
  minStars: CrateStarRating;
  colorTag: CrateColorTagFilter;
  sort: MarkerSortMode;
};

type Props = {
  filters: MarkerFilters;
  onChange: (next: MarkerFilters) => void;
  showSort?: boolean;
  className?: string;
};

export default function MarkerFilterBar({
  filters,
  onChange,
  showSort = true,
  className = "",
}: Props) {
  const [, bump] = useState(0);
  useEffect(() => subscribeCrateMarkers(() => bump((n) => n + 1)), []);

  const markedCount = Object.keys(getCrateMarkerStore()).length;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-md border border-slate-700/80 bg-slate-900/50 px-3 py-2 text-xs ${className}`}
    >
      <span className="font-medium text-slate-400 shrink-0">
        Markers
        {markedCount > 0 ? (
          <span className="ml-1 tabular-nums text-slate-500">({markedCount})</span>
        ) : null}
      </span>

      <label className="inline-flex items-center gap-1.5 text-slate-400">
        Stars ≥
        <select
          value={filters.minStars}
          onChange={(e) =>
            onChange({
              ...filters,
              minStars: Number(e.target.value) as CrateStarRating,
            })
          }
          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
        >
          <option value={0}>Any</option>
          <option value={1}>1+</option>
          <option value={2}>2+</option>
          <option value={3}>3+</option>
          <option value={4}>4</option>
        </select>
      </label>

      <label className="inline-flex items-center gap-1.5 text-slate-400">
        Color
        <select
          value={filters.colorTag}
          onChange={(e) =>
            onChange({
              ...filters,
              colorTag: e.target.value as CrateColorTagFilter,
            })
          }
          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
        >
          <option value="any">Any</option>
          <option value="none">Untagged</option>
          {COLOR_TAG_OPTIONS.filter((o) => o.id != null).map((opt) => (
            <option key={opt.id} value={opt.id!}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {showSort ? (
        <label className="inline-flex items-center gap-1.5 text-slate-400">
          Sort
          <select
            value={filters.sort}
            onChange={(e) =>
              onChange({
                ...filters,
                sort: e.target.value as MarkerSortMode,
              })
            }
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
          >
            <option value="default">Sample name</option>
            <option value="stars">Stars (high first)</option>
            <option value="color">Color tag</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}

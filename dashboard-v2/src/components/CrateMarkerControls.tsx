import { useEffect, useState } from "react";
import { Star } from "@phosphor-icons/react";
import {
  COLOR_TAG_OPTIONS,
  clearCrateColorTags,
  colorTagFill,
  crateHasColorTag,
  getCrateMarker,
  setCrateStars,
  subscribeCrateMarkers,
  toggleCrateColorTag,
  type CrateColorTag,
  type CrateStarRating,
} from "../lib/crateMarkers";

type Props = {
  crateId: string;
  /** compact = smaller controls for dense cards */
  size?: "compact" | "cozy";
  className?: string;
};

export default function CrateMarkerControls({
  crateId,
  size = "cozy",
  className = "",
}: Props) {
  const [, bump] = useState(0);
  useEffect(() => subscribeCrateMarkers(() => bump((n) => n + 1)), []);

  const marker = getCrateMarker(crateId);
  const starIcon = size === "compact" ? 12 : 15;

  function onStarClick(stars: CrateStarRating) {
    setCrateStars(crateId, marker.stars === stars ? 0 : stars);
  }

  function onColorClick(color: CrateColorTag | null) {
    if (color === null) {
      clearCrateColorTags(crateId);
      return;
    }
    toggleCrateColorTag(crateId, color);
  }

  return (
    <div
      className={`crate-marker-bar ${
        size === "compact" ? "crate-marker-bar--compact" : ""
      } ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="crate-marker-stars"
        role="group"
        aria-label={`Star rating for ${crateId}`}
      >
        {([1, 2, 3, 4] as const).map((n) => {
          const filled = marker.stars >= n;
          return (
            <button
              key={n}
              type="button"
              title={`${n} star${n === 1 ? "" : "s"}`}
              aria-label={`Rate ${n} of 4 stars`}
              aria-pressed={marker.stars === n}
              onClick={() => onStarClick(n)}
              className="crate-marker-star-btn"
            >
              <Star
                size={starIcon}
                weight={filled ? "fill" : "regular"}
                className={filled ? "text-amber-400" : "text-slate-500"}
              />
            </button>
          );
        })}
      </div>
      <div
        className="crate-marker-colors"
        role="group"
        aria-label={`Color tag for ${crateId}`}
      >
        {COLOR_TAG_OPTIONS.map((opt) => {
          const active =
            opt.id === null
              ? marker.colors.length === 0
              : crateHasColorTag(marker, opt.id);
          const isClear = opt.id === null;
          return (
            <button
              key={opt.label}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={active}
              onClick={() => onColorClick(opt.id)}
              className={`crate-marker-color-btn ${
                isClear ? "crate-marker-color-btn--clear" : ""
              } ${active ? "is-active" : ""}`}
              style={
                isClear
                  ? { opacity: active ? 1 : 0.75 }
                  : { backgroundColor: colorTagFill(opt.hex, active) }
              }
            />
          );
        })}
      </div>
    </div>
  );
}

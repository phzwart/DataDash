import { Link } from "react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  enumDisplay,
  slotLabel,
  type GalleryFactSpec,
  type ParsedSchema,
  type ResolvedGallery,
} from "../lib/schema";
import { COLOR_TAG_HEX, getCrateMarker, subscribeCrateMarkers } from "../lib/crateMarkers";
import { shortId, str, type CrateSummary } from "../lib/tiledCrates";
import CrateMarkerControls from "./CrateMarkerControls";

type Props = {
  crate: CrateSummary;
  gallery: ResolvedGallery;
  schema?: ParsedSchema | null;
  to: string;
  state?: { backTo: string; backLabel: string };
  /** Extra content overlaid on the card (e.g. remove-from-cart). */
  overlay?: ReactNode;
  className?: string;
};

function displayValue(
  schema: ParsedSchema | null | undefined,
  slot: string,
  meta: Record<string, unknown>,
): string {
  const raw = meta[slot];
  if (schema) return enumDisplay(schema, slot, raw);
  return str(meta, slot);
}

function formatCellValue(raw: unknown): string {
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(n)) {
    // Angles often near 90; lengths need a bit more precision.
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  return String(raw);
}

function factLabel(
  fact: GalleryFactSpec,
  schema: ParsedSchema | null | undefined,
): string {
  return (
    fact.label ??
    (schema ? slotLabel(schema, fact.slot) : fact.slot.replace(/_/g, " "))
  );
}

/**
 * Config-driven crate card for gallery / cart / selection.
 * Field slots + density come from dashboard gallery YAML.
 */
export default function CrateCard({
  crate,
  gallery,
  schema,
  to,
  state,
  overlay,
  className = "",
}: Props) {
  const [, bump] = useState(0);
  useEffect(() => subscribeCrateMarkers(() => bump((n) => n + 1)), []);

  const m = crate.metadata;
  const compact = gallery.density === "compact";
  const title = displayValue(schema, gallery.title, m);
  const badges = gallery.badges
    .map((slot) => ({ slot, value: displayValue(schema, slot, m) }))
    .filter((b) => b.value && b.value !== "—");
  const subtitle = gallery.subtitle
    ? displayValue(schema, gallery.subtitle, m)
    : null;
  const marker = getCrateMarker(crate.id);

  const markerPad = compact ? "0.75rem" : "0.875rem";

  return (
    <div className={`relative isolate flex min-w-0 h-full flex-col ${className}`}>
      <article
        className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-md shadow-lg border border-sky-400/70 ring-1 ring-sky-400/40 hover:border-sky-300 hover:ring-sky-300/60 transition-shadow bg-slate-900/60"
      >
        <div
          className="crate-card-color-strip"
          aria-hidden
        >
          {marker.colors.length === 0 ? (
            <div className="crate-card-color-strip-band" style={{ backgroundColor: "#ffffff" }} />
          ) : (
            marker.colors.map((color) => (
              <div
                key={color}
                className="crate-card-color-strip-band"
                style={{ backgroundColor: COLOR_TAG_HEX[color] }}
              />
            ))
          )}
        </div>
        <div
          className={`crate-card-markers ${compact ? "px-4" : "px-6"}`}
          style={{ paddingTop: markerPad }}
        >
          <CrateMarkerControls
            crateId={crate.id}
            size={compact ? "compact" : "cozy"}
          />
          <div
            className="border-b border-slate-700/60"
            style={{ marginTop: markerPad }}
            aria-hidden
          />
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <Link
            to={to}
            state={state}
            className={`crate-card-link block flex-1 no-underline ${
              compact ? "px-4 py-4" : "px-6 py-5"
            } ${overlay ? "pr-10" : ""}`}
          >
            <div className="flex items-start justify-between gap-3">
              <h2
                className={`font-medium text-slate-100 truncate ${
                  compact ? "text-sm" : "text-base"
                }`}
              >
                {title !== "—" ? title : shortId(crate.id)}
              </h2>
              {badges.length > 0 && (
                <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[50%]">
                  {badges.map((b) => (
                    <span
                      key={b.slot}
                      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-sky-900/60 text-sky-200"
                      title={schema ? slotLabel(schema, b.slot) : b.slot}
                    >
                      {b.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {gallery.show_id ? (
              <p
                className={`text-slate-400 font-mono ${
                  compact ? "text-[10px] mt-2" : "text-xs mt-3"
                }`}
              >
                {shortId(crate.id)}
              </p>
            ) : null}
            {gallery.cell_line.length > 0 ? (
              <p
                className={`font-mono tabular-nums text-slate-300 truncate ${
                  compact ? "mt-2.5 text-[10px]" : "mt-3 text-xs"
                }`}
              >
                (
                {gallery.cell_line
                  .map((fact) => formatCellValue(m[fact.slot]))
                  .join(", ")}
                )
              </p>
            ) : null}
            {gallery.facts.length > 0 &&
              (gallery.fact_labels ? (
                <dl
                  className={`text-slate-300 ${
                    compact ? "mt-3 space-y-1.5 text-xs" : "mt-5 space-y-2 text-sm"
                  }`}
                >
                  {gallery.facts.map((fact) => (
                    <div
                      key={fact.slot}
                      className="flex justify-between gap-2 min-w-0"
                    >
                      <dt className="text-slate-400 shrink-0">
                        {factLabel(fact, schema)}
                      </dt>
                      <dd className="text-right truncate text-slate-100 tabular-nums">
                        {displayValue(schema, fact.slot, m)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p
                  className={`tabular-nums text-slate-100 ${
                    compact ? "mt-3 text-xs" : "mt-5 text-sm"
                  }`}
                >
                  {gallery.facts
                    .map((fact) => {
                      const value = displayValue(schema, fact.slot, m);
                      if (!value || value === "—") return null;
                      const label = factLabel(fact, schema);
                      return (
                        <span key={fact.slot} title={label}>
                          <span className="text-slate-400">{label}</span>
                          {"\u00A0"}
                          {value}
                        </span>
                      );
                    })
                    .filter(Boolean)
                    .reduce<ReactNode[]>((acc, node, i) => {
                      if (i > 0) {
                        acc.push(
                          <span key={`gap-${i}`}>{"\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0"}</span>,
                        );
                      }
                      acc.push(node);
                      return acc;
                    }, [])}
                </p>
              ))}
            {subtitle && subtitle !== "—" && (
              <p
                className={`text-slate-500 truncate ${
                  compact ? "mt-1.5 text-[10px]" : "mt-3 text-xs"
                }`}
              >
                {subtitle}
              </p>
            )}
          </Link>
          {overlay ? (
            <div className="pointer-events-auto absolute top-3 right-3 z-40">
              {overlay}
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

/** Build search haystack from gallery.search_slots + id. */
export function crateSearchHaystack(
  crate: CrateSummary,
  gallery: ResolvedGallery,
  schema?: ParsedSchema | null,
): string {
  const parts = [
    crate.id,
    ...gallery.search_slots.map((s) => displayValue(schema, s, crate.metadata)),
  ];
  return parts.join(" ").toLowerCase();
}

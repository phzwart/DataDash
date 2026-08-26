/**
 * Compact label|value metrics table for the crate detail preview column.
 */

import {
  formatSlotValue,
  slotLabel,
  type CrateMetricsConfig,
  type ParsedSchema,
} from "../lib/schema";
import type { CrateMetadata } from "../lib/tiledCrates";

export default function CompactMetricsTable({
  metrics,
  schema,
  meta,
}: {
  metrics: CrateMetricsConfig;
  schema: ParsedSchema | undefined;
  meta: CrateMetadata;
}) {
  return (
    <div className="w-full min-w-0">
      {metrics.title ? (
        <h3 className="text-base font-semibold uppercase tracking-wide text-sky-200 mb-2">
          {metrics.title}
        </h3>
      ) : null}
      <table className="w-full text-base border-collapse">
        <tbody>
          {metrics.items.map((slot) => {
            const label = schema ? slotLabel(schema, slot) : slot.replace(/_/g, " ");
            const value = schema
              ? formatSlotValue(schema, slot, meta[slot])
              : meta[slot] == null || meta[slot] === ""
                ? "—"
                : String(meta[slot]);
            return (
              <tr
                key={slot}
                className="border-b border-slate-700/80 last:border-0"
              >
                <th
                  scope="row"
                  className="py-2 pr-3 text-left font-medium text-slate-200 whitespace-nowrap align-top w-[1%]"
                >
                  {label}
                </th>
                <td className="py-2 text-slate-50 tabular-nums font-mono text-right break-all">
                  {value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

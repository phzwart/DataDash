import { useState } from "react";
import { slotLabel, type ParsedSchema } from "../lib/schema";
import {
  enumNames,
  formSlotsForSection,
  isLongSlot,
  itemsPerRowGrid,
  type LedgerSection,
  type ResolvedBookLayout,
} from "../lib/projectBookApi";

type Props = {
  schema: ParsedSchema;
  section: LedgerSection;
  onSubmit: (payload: Record<string, unknown>) => Promise<void> | void;
  busy?: boolean;
  layout?: ResolvedBookLayout;
};

export default function LedgerEntryForm({
  schema,
  section,
  onSubmit,
  busy,
  layout,
}: Props) {
  const slots = formSlotsForSection(schema, section);
  const [values, setValues] = useState<Record<string, string>>({});
  const perRow = layout?.items_per_row ?? 3;
  const ownLine = layout?.textbox_own_line !== false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const slot of slots) {
      const v = (values[slot] ?? "").trim();
      if (v) payload[slot] = v;
    }
    await onSubmit(payload);
    setValues({});
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="pt-2 items-end"
      style={itemsPerRowGrid(perRow, layout?.form_gap ?? "0.85rem")}
    >
      {slots.map((slot) => {
        const enums = enumNames(schema, slot);
        const label = slotLabel(schema, slot);
        const required = schema.slots[slot]?.required === true;
        const wide = isLongSlot(slot, layout?.wide_slots);
        const textbox = !enums;
        const fullRow = wide || (ownLine && textbox);
        const common =
          "rounded-md bg-slate-950/80 border border-slate-600 text-slate-100 text-base px-3 py-2 leading-5";
        return (
          <label
            key={slot}
            className="space-y-1.5 min-w-0"
            style={fullRow ? { gridColumn: "1 / -1" } : undefined}
          >
            <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              {label}
              {required ? " *" : ""}
            </span>
            {enums ? (
              <select
                className={`${common} w-full`}
                value={values[slot] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [slot]: e.target.value }))
                }
                required={required}
              >
                <option value="">Select…</option>
                {enums.map((name) => (
                  <option key={name} value={name}>
                    {schema.enums[schema.slots[slot]?.range ?? ""]
                      ?.permissible_values?.[name]?.description ?? name}
                  </option>
                ))}
              </select>
            ) : wide ? (
              <textarea
                className={`${common} w-full min-h-[4.5rem] font-mono text-sm`}
                value={values[slot] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [slot]: e.target.value }))
                }
                required={required}
              />
            ) : (
              <input
                className={`${common} w-full`}
                value={values[slot] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [slot]: e.target.value }))
                }
                required={required}
              />
            )}
          </label>
        );
      })}
      <button
        type="submit"
        disabled={busy}
        className="px-3.5 py-2 rounded-md bg-sky-700 text-white text-base hover:bg-sky-600 disabled:opacity-50 justify-self-start"
      >
        {busy ? "Saving…" : `Add ${section.title.replace(/s$/, "")}`}
      </button>
    </form>
  );
}

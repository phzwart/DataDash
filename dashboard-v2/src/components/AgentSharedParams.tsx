/**
 * Shared (non-crate) agent parameter controls for the action-queue bulk run UI.
 */

import type { ParamBinding } from "../lib/agentApi";
import type { FieldResolution } from "../lib/agentRequest";

const UNIT_CELL_LABELS = ["a", "b", "c", "α", "β", "γ"] as const;

const controlClass =
  "w-full rounded-md border border-slate-600 bg-slate-950/70 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-sky-500 focus:ring-1 focus:ring-sky-500/40";

export function fieldLabel(f: FieldResolution | { name: string; binding: ParamBinding }): string {
  const desc = f.binding.description?.trim();
  if (desc) {
    const head = desc.split(/\s+[—–-]\s+/)[0]?.trim();
    if (head) return head;
  }
  return f.name.replace(/_/g, " ");
}

export function fieldToDraftValue(value: unknown, typeName?: string): string {
  if (value == null) return "";
  if (typeName === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(" ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function draftToValue(raw: string, typeName?: string): unknown {
  const t = typeName ?? "auto";
  if (t === "boolean") {
    return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  }
  if (t === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (t === "array") {
    try {
      if (raw.trim().startsWith("[")) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return raw
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => {
        const n = Number(part);
        return Number.isFinite(n) ? n : part;
      });
  }
  if (raw.trim().startsWith("[") || raw.trim().startsWith("{")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function isUnitCellField(f: FieldResolution): boolean {
  return (
    f.name === "cell" ||
    (f.binding.type === "array" &&
      Boolean(f.binding.description?.toLowerCase().includes("unit cell")))
  );
}

function SourcePill({
  source,
}: {
  source: FieldResolution["source"] | "override";
}) {
  const map = {
    from: { text: "From crate", className: "bg-emerald-950 text-emerald-300" },
    default: { text: "Default", className: "bg-slate-800 text-slate-300" },
    override: { text: "Edited", className: "bg-sky-950 text-sky-300" },
    missing: { text: "Needed", className: "bg-amber-950 text-amber-200" },
  } as const;
  const { text, className } = map[source];
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${className}`}
    >
      {text}
    </span>
  );
}

export function ParamControl({
  field,
  draft,
  onEdit,
}: {
  field: FieldResolution;
  draft: string;
  onEdit: (raw: string) => void;
}) {
  const typeName = field.binding.type ?? "auto";

  if (typeName === "boolean") {
    const on = (draft || "false") === "true";
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onEdit(on ? "false" : "true")}
        className={`inline-flex items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition ${
          on
            ? "border-teal-600/70 bg-teal-950/50 text-teal-100"
            : "border-slate-600 bg-slate-950/70 text-slate-300"
        }`}
      >
        <span
          className={`relative h-5 w-9 shrink-0 rounded-full transition ${
            on ? "bg-teal-500" : "bg-slate-600"
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
              on ? "left-4" : "left-0.5"
            }`}
          />
        </span>
        {on ? "On" : "Off"}
      </button>
    );
  }

  if (isUnitCellField(field)) {
    const parts = draft.trim()
      ? draft.trim().split(/[\s,]+/)
      : ["", "", "", "", "", ""];
    while (parts.length < 6) parts.push("");
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {UNIT_CELL_LABELS.map((label, i) => (
          <label key={label} className="block min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </span>
            <input
              type="number"
              step="any"
              value={parts[i] ?? ""}
              onChange={(e) => {
                const next = [...parts];
                next[i] = e.target.value;
                onEdit(next.join(" "));
              }}
              className={`${controlClass} font-mono tabular-nums`}
            />
          </label>
        ))}
      </div>
    );
  }

  if (typeName === "number") {
    return (
      <input
        type="number"
        step="any"
        value={draft}
        onChange={(e) => onEdit(e.target.value)}
        className={`${controlClass} font-mono tabular-nums`}
      />
    );
  }

  if (
    field.name === "sequence" ||
    (typeName === "string" && draft.length > 80)
  ) {
    return (
      <textarea
        rows={4}
        value={draft}
        onChange={(e) => onEdit(e.target.value)}
        spellCheck={false}
        className={`${controlClass} font-mono leading-relaxed`}
      />
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => onEdit(e.target.value)}
      className={controlClass}
    />
  );
}

type SharedParamsFormProps = {
  fields: FieldResolution[];
  draftText: Record<string, string>;
  overrides: Record<string, unknown>;
  onEdit: (name: string, raw: string, typeName?: string) => void;
};

export function SharedParamsForm({
  fields,
  draftText,
  overrides,
  onEdit,
}: SharedParamsFormProps) {
  if (!fields.length) {
    return (
      <p className="text-sm text-slate-500">
        This action has no shared settings — crate metadata fills the rest.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fields.map((f) => {
        const src = overrides[f.name] != null ? "override" : f.source;
        const wide =
          isUnitCellField(f) ||
          f.name === "sequence" ||
          (f.binding.type === "string" &&
            (draftText[f.name] ?? "").length > 80);
        return (
          <label
            key={f.name}
            className={`block space-y-1.5 ${wide ? "md:col-span-2" : ""}`}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-slate-200">
                {fieldLabel(f)}
                {f.binding.required ? (
                  <span className="ml-1 text-rose-400">*</span>
                ) : null}
              </span>
              <SourcePill source={src} />
            </span>
            <ParamControl
              field={f}
              draft={draftText[f.name] ?? ""}
              onEdit={(raw) => onEdit(f.name, raw, f.binding.type)}
            />
          </label>
        );
      })}
    </div>
  );
}

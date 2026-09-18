/**
 * Assemble agent job submit JSON from agent.request bindings + crate metadata.
 * Mirrors agent_server.request_assemble (client-side).
 *
 * FLAG: `request:` currently lives in agent.yaml (UI-adjacent coupling).
 * Acceptable for now; may move to facility dashboard YAML later — see
 * agent_server/skills/AGENT_BUILD_SPEC.md §3 (flagged coupling).
 */

import type { AgentSummary, ParamBinding, RequestSpec } from "./agentApi";
import type { CrateMetadata } from "./tiledCrates";

function metaGet(meta: CrateMetadata, ...keys: string[]): unknown {
  for (const key of keys) {
    const v = meta[key];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

export function resolveCrateSource(
  source: string,
  crateUuid: string,
  metadata: CrateMetadata,
): unknown {
  if (source === "crate.uuid") return crateUuid;
  if (source === "crate.sample_code") {
    return metaGet(metadata, "sample_code", "sample_id");
  }
  if (source === "crate.title") {
    return metaGet(metadata, "title", "name");
  }
  if (source === "crate.summary.space_group") {
    return metaGet(metadata, "space_group");
  }
  if (source === "crate.summary.unit_cell") {
    const keys = [
      "unit_cell_a",
      "unit_cell_b",
      "unit_cell_c",
      "unit_cell_alpha",
      "unit_cell_beta",
      "unit_cell_gamma",
    ] as const;
    const vals: number[] = [];
    for (const k of keys) {
      const v = metaGet(metadata, k);
      if (v == null) return undefined;
      vals.push(Number(v));
    }
    return vals;
  }
  if (source.startsWith("crate.summary.unit_cell_")) {
    const key = source.slice("crate.summary.".length);
    const v = metaGet(metadata, key);
    return v == null ? undefined : Number(v);
  }
  if (source.startsWith("crate.summary.")) {
    return metaGet(metadata, source.slice("crate.summary.".length));
  }
  if (source.startsWith("crate.")) {
    return metaGet(metadata, source.slice("crate.".length));
  }
  return undefined;
}

function coerce(value: unknown, typeName: string): unknown {
  if (value == null || typeName === "auto" || typeName === "") return value;
  if (typeName === "number") return Number(value);
  if (typeName === "string") return String(value);
  if (typeName === "boolean") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    }
    return Boolean(value);
  }
  if (typeName === "array") {
    return Array.isArray(value) ? value : [value];
  }
  return value;
}

export type FieldResolution = {
  name: string;
  value: unknown;
  source: "override" | "from" | "default" | "missing";
  binding: ParamBinding;
};

export function resolveBinding(
  binding: ParamBinding,
  crateUuid: string,
  metadata: CrateMetadata,
  userOverrides: Record<string, unknown> = {},
): FieldResolution {
  if (
    Object.prototype.hasOwnProperty.call(userOverrides, binding.name) &&
    userOverrides[binding.name] != null
  ) {
    return {
      name: binding.name,
      value: coerce(userOverrides[binding.name], binding.type ?? "auto"),
      source: "override",
      binding,
    };
  }

  let value: unknown;
  let source: FieldResolution["source"] = "missing";
  const fromSrc = binding.from;
  if (fromSrc != null) {
    const sources = Array.isArray(fromSrc) ? fromSrc : [fromSrc];
    for (const src of sources) {
      value = resolveCrateSource(src, crateUuid, metadata);
      if (value != null) {
        source = "from";
        break;
      }
    }
  }

  if (value == null && binding.default != null) {
    value = binding.default;
    source = "default";
  }

  if (value != null) {
    value = coerce(value, binding.type ?? "auto");
  }

  return { name: binding.name, value, source, binding };
}

export type AssembleResult = {
  parameters: Record<string, unknown>;
  fields: FieldResolution[];
  missingRequired: string[];
};

export function assembleParameters(
  request: RequestSpec,
  crateUuid: string,
  metadata: CrateMetadata,
  userOverrides: Record<string, unknown> = {},
): AssembleResult {
  const fields = request.parameters.map((b) =>
    resolveBinding(b, crateUuid, metadata, userOverrides),
  );
  const parameters: Record<string, unknown> = {};
  const missingRequired: string[] = [];
  for (const f of fields) {
    if (f.value == null) {
      if (f.binding.required) missingRequired.push(f.name);
      continue;
    }
    parameters[f.name] = f.value;
  }
  return { parameters, fields, missingRequired };
}

export type JobSubmitBody = {
  agent_uuid: string;
  inputs: Record<string, unknown>;
  options?: { facility_url?: string; crate_source_url?: string };
};

export function buildAgentJobRequest(
  agent: AgentSummary,
  crateUuid: string,
  metadata: CrateMetadata,
  userOverrides: Record<string, unknown> = {},
  facilityUrl?: string,
  crateSourceUrl?: string,
): { body: JobSubmitBody; assemble: AssembleResult | null; error?: string } {
  const inputs: Record<string, unknown> = {};
  const request = agent.request ?? null;
  const crateInput = request?.crate_input ?? "source_crate";
  const paramsInput = request?.parameters_input ?? "parameters";

  const hasCrateInput =
    agent.input_items?.some((i) => i.name === crateInput) ||
    agent.input_items?.some((i) => i.type === "rocrate_ref");
  if (hasCrateInput) {
    const name =
      agent.input_items?.find((i) => i.name === crateInput)?.name ??
      agent.input_items?.find((i) => i.type === "rocrate_ref")?.name ??
      crateInput;
    inputs[name] = { type: "rocrate_ref", uuid: crateUuid };
  }

  let assemble: AssembleResult | null = null;
  if (request?.parameters?.length) {
    assemble = assembleParameters(request, crateUuid, metadata, userOverrides);
    if (assemble.missingRequired.length) {
      return {
        body: { agent_uuid: agent.agent_uuid, inputs },
        assemble,
        error: `Missing required parameters: ${assemble.missingRequired.join(", ")}`,
      };
    }
    inputs[paramsInput] = { type: "json", value: assemble.parameters };
  } else if (
    agent.input_items?.some((i) => i.name === paramsInput && i.type === "json") &&
    Object.keys(userOverrides).length
  ) {
    inputs[paramsInput] = { type: "json", value: { ...userOverrides } };
  }

  const body: JobSubmitBody = {
    agent_uuid: agent.agent_uuid,
    inputs,
  };
  const options: NonNullable<JobSubmitBody["options"]> = {};
  if (facilityUrl) options.facility_url = facilityUrl;
  // Prefer hydrate/client_store for crates from the local working set.
  if (crateSourceUrl) options.crate_source_url = crateSourceUrl;
  if (Object.keys(options).length) body.options = options;
  return { body, assemble };
}

/** Fields the UI should show (user:true, or required still missing). */
export function formFields(
  assemble: AssembleResult | null,
  request: RequestSpec | null | undefined,
): FieldResolution[] {
  if (!assemble || !request) return [];
  return assemble.fields.filter(
    (f) => f.binding.user || f.source === "missing" || f.binding.required,
  );
}

/** True when a binding pulls values from crate metadata. */
export function isCrateDependentBinding(binding: ParamBinding): boolean {
  const fromSrc = binding.from;
  if (fromSrc == null) return false;
  const sources = Array.isArray(fromSrc) ? fromSrc : [fromSrc];
  return sources.some(
    (src) => typeof src === "string" && src.startsWith("crate."),
  );
}

/**
 * Parameters that are shared across a bulk run (not filled from crate metadata).
 * Shown once next to the agent picker on Work.
 */
export function sharedParamBindings(
  request: RequestSpec | null | undefined,
): ParamBinding[] {
  if (!request?.parameters?.length) return [];
  return request.parameters.filter(
    (b) => (b.user || b.required) && !isCrateDependentBinding(b),
  );
}

/** Resolve shared bindings against defaults + user overrides (no crate). */
export function resolveSharedFields(
  request: RequestSpec | null | undefined,
  userOverrides: Record<string, unknown> = {},
): FieldResolution[] {
  return sharedParamBindings(request).map((binding) =>
    resolveBinding(binding, "", {}, userOverrides),
  );
}

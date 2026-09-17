/**
 * Agent orchestration server API (job registry + skills).
 * Setup registers one active origin; jobs UI can consume this later.
 */

const URL_KEY = "lambda_v2.agent_api_url";
export const AGENT_SERVER_CHANGED = "lambda-v2-agent-server-changed";

export const ENV_AGENT_API_URL =
  import.meta.env.VITE_AGENT_API_URL ?? "http://127.0.0.1:8780";

function readStorage(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Agent server origin without trailing slash (not …/api/v1). */
export function normalizeAgentUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(u)) {
    u = `http://${u}`;
  }
  if (/\/api\/v1$/i.test(u)) {
    u = u.replace(/\/api\/v1$/i, "");
  } else if (/\/api$/i.test(u)) {
    u = u.replace(/\/api$/i, "");
  }
  return u;
}

export function getStoredAgentUrl(): string | null {
  return readStorage(URL_KEY);
}

export function getAgentUrl(): string {
  return normalizeAgentUrl(getStoredAgentUrl() ?? ENV_AGENT_API_URL);
}

export function setStoredAgentUrl(url: string): void {
  localStorage.setItem(URL_KEY, normalizeAgentUrl(url));
  window.dispatchEvent(new Event(AGENT_SERVER_CHANGED));
}

export function clearStoredAgentUrl(): void {
  localStorage.removeItem(URL_KEY);
  window.dispatchEvent(new Event(AGENT_SERVER_CHANGED));
}

export type AgentHealth = {
  ok: boolean;
  detail: string;
  agents?: number;
  jobs_running?: number;
  jobs_pending?: number;
};

export async function agentHealth(
  baseUrl = getAgentUrl(),
): Promise<AgentHealth> {
  const base = normalizeAgentUrl(baseUrl);
  try {
    const res = await fetch(`${base}/api/v1/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as {
      status?: string;
      role?: string;
      agents?: number;
      jobs_running?: number;
      jobs_pending?: number;
    };
    if (body.role && body.role !== "agent_server") {
      return {
        ok: false,
        detail: `Unexpected role: ${body.role}`,
      };
    }
    const parts = [
      body.status ?? "ok",
      typeof body.agents === "number" ? `${body.agents} agents` : null,
      typeof body.jobs_running === "number"
        ? `${body.jobs_running} running`
        : null,
    ].filter(Boolean);
    return {
      ok: true,
      detail: parts.join(" · "),
      agents: body.agents,
      jobs_running: body.jobs_running,
      jobs_pending: body.jobs_pending,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export type AgentInputItem = {
  name: string;
  type: string;
  required?: boolean;
  cardinality?: string;
};

export type ParamBinding = {
  name: string;
  from?: string | string[];
  default?: unknown;
  required?: boolean;
  user?: boolean;
  type?: string;
  description?: string;
};

export type RequestSpec = {
  crate_input?: string;
  parameters_input?: string;
  parameters: ParamBinding[];
};

export type AgentSummary = {
  agent_uuid: string;
  name: string;
  version: string;
  description: string;
  /** When false, agent is for tests/internal use and omitted from Actions UI. */
  listed?: boolean;
  runner_type?: string;
  input_items?: AgentInputItem[];
  output?: {
    required_files?: string[];
    root_dir?: string;
    profile?: Record<string, string>;
  };
  request?: RequestSpec | null;
};

export async function listAgents(
  baseUrl = getAgentUrl(),
): Promise<AgentSummary[]> {
  const base = normalizeAgentUrl(baseUrl);
  const res = await fetch(`${base}/api/v1/agents`);
  if (!res.ok) {
    throw new Error(`List agents failed (${res.status})`);
  }
  const body = (await res.json()) as { agents?: AgentSummary[] };
  const agents = Array.isArray(body.agents) ? body.agents : [];
  // Hide smoke-test / unlisted agents even if an older agent_server omits `listed`.
  return agents.filter(
    (a) =>
      a.listed !== false &&
      a.name !== "level-zero-agent" &&
      a.agent_uuid !== "550e8400-e29b-41d4-a716-446655440000",
  );
}

export async function getAgent(
  agentUuid: string,
  baseUrl = getAgentUrl(),
): Promise<AgentSummary> {
  const base = normalizeAgentUrl(baseUrl);
  const res = await fetch(`${base}/api/v1/agents/${agentUuid}`);
  if (!res.ok) {
    throw new Error(`Get agent failed (${res.status})`);
  }
  return (await res.json()) as AgentSummary;
}

export type JobSubmitResponse = {
  job_uuid: string;
  status: string;
  phase?: string;
  is_terminal?: boolean;
  error_message?: string | null;
  output_crate_uuid?: string | null;
  links?: Record<string, string>;
};

export async function submitJob(
  body: {
    agent_uuid: string;
    inputs: Record<string, unknown>;
    options?: { facility_url?: string; crate_source_url?: string };
    job_uuid?: string;
  },
  baseUrl = getAgentUrl(),
): Promise<JobSubmitResponse> {
  const base = normalizeAgentUrl(baseUrl);
  const res = await fetch(`${base}/api/v1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `Submit failed (${res.status})`;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) message = err.detail;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as JobSubmitResponse;
}

export async function getJob(
  jobUuid: string,
  baseUrl = getAgentUrl(),
): Promise<JobSubmitResponse & Record<string, unknown>> {
  const base = normalizeAgentUrl(baseUrl);
  const res = await fetch(`${base}/api/v1/jobs/${jobUuid}`);
  if (!res.ok) {
    throw new Error(`Get job failed (${res.status})`);
  }
  return (await res.json()) as JobSubmitResponse & Record<string, unknown>;
}

/** Poll until the job reaches a terminal status (or timeout). */
export async function waitForJob(
  jobUuid: string,
  options?: {
    baseUrl?: string;
    intervalMs?: number;
    timeoutMs?: number;
    onUpdate?: (job: JobSubmitResponse & Record<string, unknown>) => void;
  },
): Promise<JobSubmitResponse & Record<string, unknown>> {
  const baseUrl = options?.baseUrl ?? getAgentUrl();
  const intervalMs = options?.intervalMs ?? 500;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const terminal = new Set([
    "completed",
    "failed",
    "cancelled",
    "timed_out",
  ]);
  const started = Date.now();
  for (;;) {
    const job = await getJob(jobUuid, baseUrl);
    options?.onUpdate?.(job);
    if (job.is_terminal || terminal.has(String(job.status))) return job;
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `Timed out waiting for job ${jobUuid} (last status: ${job.status})`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export type JobListItem = JobSubmitResponse & {
  agent_uuid?: string;
  created_at?: string;
  finished_at?: string | null;
  input_refs?: Array<{
    name?: string;
    type?: string;
    ref?: string;
    local_path?: string;
  }>;
};

export async function listJobs(
  options?: {
    crateUuid?: string;
    agentUuid?: string;
    status?: string;
    limit?: number;
  },
  baseUrl = getAgentUrl(),
): Promise<JobListItem[]> {
  const base = normalizeAgentUrl(baseUrl);
  const params = new URLSearchParams();
  if (options?.crateUuid) params.set("crate_uuid", options.crateUuid);
  if (options?.agentUuid) params.set("agent_uuid", options.agentUuid);
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const res = await fetch(`${base}/api/v1/jobs${qs ? `?${qs}` : ""}`);
  if (!res.ok) {
    throw new Error(`List jobs failed (${res.status})`);
  }
  const body = (await res.json()) as { jobs?: JobListItem[] };
  return Array.isArray(body.jobs) ? body.jobs : [];
}

export type JobOutputFileMeta = {
  path: string;
  size: number;
  suffix: string;
};

export async function listJobOutputFiles(
  jobUuid: string,
  baseUrl = getAgentUrl(),
): Promise<JobOutputFileMeta[]> {
  const base = normalizeAgentUrl(baseUrl);
  const res = await fetch(`${base}/api/v1/jobs/${jobUuid}/output/files`);
  if (!res.ok) {
    throw new Error(`List output files failed (${res.status})`);
  }
  const body = (await res.json()) as { files?: JobOutputFileMeta[] };
  return Array.isArray(body.files) ? body.files : [];
}

export type JobOutputFilePayload = {
  path: string;
  content_type?: string;
  data?: unknown;
  text?: string;
  base64?: string;
  truncated?: boolean;
  size?: number;
  error?: string;
};

export async function getJobOutputFile(
  jobUuid: string,
  path: string,
  baseUrl = getAgentUrl(),
): Promise<JobOutputFilePayload> {
  const base = normalizeAgentUrl(baseUrl);
  const qs = new URLSearchParams({ path });
  const res = await fetch(
    `${base}/api/v1/jobs/${jobUuid}/output/file?${qs.toString()}`,
  );
  if (!res.ok) {
    let message = `Get output file failed (${res.status})`;
    try {
      const err = (await res.json()) as { detail?: string };
      if (err.detail) message = err.detail;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return (await res.json()) as JobOutputFilePayload;
}

/** Absolute URL for streaming a job output file as raw bytes (PDB, MAP, MTZ). */
export function jobOutputRawUrl(
  jobUuid: string,
  path: string,
  baseUrl = getAgentUrl(),
): string {
  // Same-origin /agent proxy in Vite DEV avoids cross-origin blob/CORS quirks.
  const useDevProxy =
    typeof window !== "undefined" &&
    import.meta.env.DEV &&
    window.location.origin.includes("5175");
  const base = useDevProxy ? "" : normalizeAgentUrl(baseUrl);
  const prefix = useDevProxy ? "/agent" : "";
  const qs = new URLSearchParams({ path });
  return `${base}${prefix}/api/v1/jobs/${jobUuid}/output/raw?${qs.toString()}`;
}

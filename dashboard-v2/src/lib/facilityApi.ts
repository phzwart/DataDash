/**
 * Facility search API (remote LAMBDA server).
 * Search only — crates land in the local client store via hydrate/Pull.
 */

const URL_KEY = "lambda_v2.facility_api_url";
export const FACILITY_SERVER_CHANGED = "lambda-v2-facility-server-changed";

export const ENV_FACILITY_API_URL =
  import.meta.env.VITE_FACILITY_API_URL ?? "http://127.0.0.1:8767";

function readStorage(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Facility origin without trailing slash (not …/api/v1). */
export function normalizeFacilityUrl(raw: string): string {
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

export function getStoredFacilityUrl(): string | null {
  return readStorage(URL_KEY);
}

export function getFacilityUrl(): string {
  return normalizeFacilityUrl(getStoredFacilityUrl() ?? ENV_FACILITY_API_URL);
}

/** Base URL for browser fetches to the facility API. */
export function getFacilityFetchBase(baseUrl = getFacilityUrl()): string {
  // In Vite dev, go through the same-origin `/facility` proxy (vite.config.ts)
  // so Search works even when CORS / direct :8767 is flaky.
  if (import.meta.env.DEV) {
    const stored = getStoredFacilityUrl();
    // Only proxy the default local facility; honor an explicit override as-is.
    if (!stored || normalizeFacilityUrl(stored) === normalizeFacilityUrl(ENV_FACILITY_API_URL)) {
      return "/facility";
    }
  }
  return normalizeFacilityUrl(baseUrl);
}

export function setStoredFacilityUrl(url: string): void {
  localStorage.setItem(URL_KEY, normalizeFacilityUrl(url));
  window.dispatchEvent(new Event(FACILITY_SERVER_CHANGED));
}

export function clearStoredFacilityUrl(): void {
  localStorage.removeItem(URL_KEY);
  window.dispatchEvent(new Event(FACILITY_SERVER_CHANGED));
}

export type FacilitySearchParams = {
  seguid?: string;
  protein_name?: string;
  technique?: string;
  facility?: string;
  instrument?: string;
  is_public?: string;
  creation_date_start?: string;
  creation_date_end?: string;
};

export type FacilitySearchHit = {
  experiment_id: string;
  facility?: string;
  facility_endpoint?: string;
  is_public?: boolean;
  technique?: string | null;
  instrument?: string | null;
  protein_name?: string;
  creation_date?: string;
  pid?: string;
  size?: number;
  seguid?: string[];
  PI?: Record<string, unknown>;
};

export type FacilitySearchResponse = {
  results: FacilitySearchHit[];
  count: number;
};

export async function facilityHealth(
  baseUrl = getFacilityUrl(),
): Promise<{ ok: boolean; detail: string }> {
  const base = getFacilityFetchBase(baseUrl);
  try {
    const res = await fetch(`${base}/api/v1/health`);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = (await res.json()) as { status?: string; facility?: string };
    return {
      ok: true,
      detail: `${body.status ?? "ok"}${body.facility ? ` (${body.facility})` : ""}`,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function facilitySearch(
  params: FacilitySearchParams = {},
  baseUrl = getFacilityUrl(),
): Promise<FacilitySearchResponse> {
  const base = getFacilityFetchBase(baseUrl);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== "") {
      qs.set(k, String(v).trim());
    }
  }
  const url = `${base}/api/v1/search${qs.toString() ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Facility search is not reachable (${detail}). Is the facility server up?`,
    );
  }
  if (!res.ok) {
    let message = `Search failed (${res.status})`;
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      message = "Facility search is not up yet — wait for the index, then retry.";
    }
    try {
      const err = (await res.json()) as { message?: string };
      if (err.message) message = err.message;
    } catch {
      if (res.status === 500) {
        message =
          "Facility search is not up yet (proxy 500). Wait until :8767 is listening, then retry.";
      }
    }
    throw new Error(message);
  }
  const body = (await res.json()) as FacilitySearchResponse;
  return {
    results: Array.isArray(body.results) ? body.results : [],
    count:
      typeof body.count === "number"
        ? body.count
        : (body.results?.length ?? 0),
  };
}

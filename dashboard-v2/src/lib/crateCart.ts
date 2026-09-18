import { readBookContext, subscribeBookContext } from "./bookContext";
import { recordSessionEvent } from "./sessionLog";

/** v2 cart — separate from legacy dashboard cart. */
const STORAGE_KEY = "lambda_v2.crate_cart";
const CHANGE_EVENT = "lambda-v2-cart-changed";
const NO_PROJECT = "__none__";

type CartStoreV2 = {
  v: 2;
  byProject: Record<string, string[]>;
};

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function projectKey(projectId?: string | null): string {
  if (projectId) return projectId;
  return readBookContext().projectId || NO_PROJECT;
}

function emptyStore(): CartStoreV2 {
  return { v: 2, byProject: {} };
}

function persistMigrated(store: CartStoreV2): CartStoreV2 {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return store;
}

function readStore(): CartStoreV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as unknown;
    // Pre-project carts were a flat id list. Drop them — they leak across projects.
    if (Array.isArray(parsed)) return persistMigrated(emptyStore());
    if (!parsed || typeof parsed !== "object") return persistMigrated(emptyStore());
    const rec = parsed as { v?: unknown; byProject?: unknown };
    if (rec.v !== 2 || !rec.byProject || typeof rec.byProject !== "object") {
      return persistMigrated(emptyStore());
    }
    const byProject: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(
      rec.byProject as Record<string, unknown>,
    )) {
      if (!Array.isArray(value)) continue;
      byProject[key] = [
        ...new Set(value.filter((x): x is string => typeof x === "string")),
      ];
    }
    return { v: 2, byProject };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CartStoreV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  notify();
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

function writeProject(ids: string[], projectId?: string | null): void {
  const key = projectKey(projectId);
  const store = readStore();
  const next = [...new Set(ids)];
  if (sameIds(store.byProject[key] ?? [], next)) return;
  store.byProject[key] = next;
  writeStore(store);
}

/** Cart ids for the current project (or `projectId` when passed). */
export function getCartIds(projectId?: string | null): string[] {
  const key = projectKey(projectId);
  return readStore().byProject[key] ?? [];
}

/** Union ids into this project's cart. */
export function addToCart(ids: string[], projectId?: string | null): void {
  const before = new Set(getCartIds(projectId));
  const added = [...new Set(ids)].filter((id) => !before.has(id));
  writeProject([...before, ...ids], projectId);
  if (added.length) {
    recordSessionEvent({
      type: "cart_add",
      crateIds: added,
      detail: { cart_size: getCartIds(projectId).length },
    });
  }
}

export function replaceCart(ids: string[], projectId?: string | null): void {
  const unique = [...new Set(ids)];
  if (sameIds(getCartIds(projectId), unique)) return;
  writeProject(unique, projectId);
  recordSessionEvent({
    type: "cart_replace",
    crateIds: unique,
    detail: { cart_size: unique.length },
  });
}

export function removeFromCart(id: string, projectId?: string | null): void {
  writeProject(
    getCartIds(projectId).filter((x) => x !== id),
    projectId,
  );
  recordSessionEvent({
    type: "cart_remove",
    crateIds: [id],
    detail: { cart_size: getCartIds(projectId).length },
  });
}

export function clearCart(projectId?: string | null): void {
  const prev = getCartIds(projectId);
  writeProject([], projectId);
  if (prev.length) {
    recordSessionEvent({
      type: "cart_clear",
      crateIds: prev,
      detail: { cleared: prev.length },
    });
  }
}

/** Drop ids that are not in the current project's allow-list. */
export function clipCartToAllowlist(
  allow: Iterable<string>,
  projectId?: string | null,
): void {
  const allowSet = new Set(allow);
  const ids = getCartIds(projectId);
  const next = ids.filter((id) => allowSet.has(id));
  if (next.length === ids.length) return;
  writeProject(next, projectId);
}

export function subscribeCart(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

if (typeof window !== "undefined") {
  subscribeBookContext(() => notify());
}

export { STORAGE_KEY, CHANGE_EVENT };

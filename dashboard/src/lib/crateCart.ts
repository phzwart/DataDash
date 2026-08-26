import { recordSessionEvent } from "./sessionLog";

const STORAGE_KEY = "lambda.crate_cart";
const CHANGE_EVENT = "lambda-cart-changed";

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function getCartIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((x): x is string => typeof x === "string"))];
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  notify();
}

/** Union ids into the cart. */
export function addToCart(ids: string[]): void {
  const before = new Set(getCartIds());
  const next = [...before, ...ids];
  const added = [...new Set(ids)].filter((id) => !before.has(id));
  write(next);
  if (added.length) {
    recordSessionEvent({
      type: "cart_add",
      crateIds: added,
      detail: { cart_size: getCartIds().length },
    });
  }
}

export function replaceCart(ids: string[]): void {
  const unique = [...new Set(ids)];
  write(unique);
  recordSessionEvent({
    type: "cart_replace",
    crateIds: unique,
    detail: { cart_size: unique.length },
  });
}

export function removeFromCart(id: string): void {
  write(getCartIds().filter((x) => x !== id));
  recordSessionEvent({
    type: "cart_remove",
    crateIds: [id],
    detail: { cart_size: getCartIds().length },
  });
}

export function clearCart(): void {
  const prev = getCartIds();
  write([]);
  if (prev.length) {
    recordSessionEvent({
      type: "cart_clear",
      crateIds: prev,
      detail: { cleared: prev.length },
    });
  }
}

export function subscribeCart(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export { STORAGE_KEY, CHANGE_EVENT };

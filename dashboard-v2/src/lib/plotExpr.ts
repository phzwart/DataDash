/**
 * Safe numeric expressions for dashboard plot YAML.
 *
 * Supported:
 *   - field paths: tissue_fractions.cortex, slice_index
 *   - numbers: 1, 0.5, 1e-3
 *   - operators: + - * / and parentheses
 *   - unary minus
 *
 * Not supported (intentionally): function calls, indexing, JS eval.
 */

export type MetaRecord = Record<string, unknown>;

type Tok =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" };

const OP_CHARS = new Set(["+", "-", "*", "/", "(", ")"]);

/** True when the string is a bare metadata path (no arithmetic). */
export function isPlainFieldPath(s: string): boolean {
  return /^[A-Za-z_][\w.]*$/.test(s.trim());
}

export function looksLikePlotExpr(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (isPlainFieldPath(t)) return false;
  return /[+\-*/()]/.test(t);
}

function tokenize(input: string): Tok[] {
  const s = input.trim();
  const tokens: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (OP_CHARS.has(ch)) {
      tokens.push({
        kind: "op",
        value: ch as "+" | "-" | "*" | "/" | "(" | ")",
      });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error(`Bad number at ${i} in "${input}"`);
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[\w.]/.test(s[j])) j++;
      tokens.push({ kind: "id", value: s.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character '${ch}' in plot expression "${input}"`);
  }
  return tokens;
}

function resolvePath(meta: MetaRecord, path: string): number | null {
  const parts = path.split(".");
  if (parts.length === 2) {
    const [root, key] = parts;
    const obj = meta[root];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const n = Number((obj as MetaRecord)[key]);
      return Number.isFinite(n) ? n : null;
    }
  }
  let cur: unknown = meta;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) {
      return null;
    }
    cur = (cur as MetaRecord)[p];
  }
  if (typeof cur === "number" && Number.isFinite(cur)) return cur;
  const n = Number(cur);
  return Number.isFinite(n) ? n : null;
}

type Parser = {
  tokens: Tok[];
  i: number;
  meta: MetaRecord;
};

function peek(p: Parser): Tok | undefined {
  return p.tokens[p.i];
}

function consume(p: Parser): Tok {
  const t = p.tokens[p.i++];
  if (!t) throw new Error("Unexpected end of plot expression");
  return t;
}

function parseExpr(p: Parser): number | null {
  let left = parseTerm(p);
  while (true) {
    const t = peek(p);
    if (!t || t.kind !== "op" || (t.value !== "+" && t.value !== "-")) break;
    consume(p);
    const right = parseTerm(p);
    if (left == null || right == null) left = null;
    else left = t.value === "+" ? left + right : left - right;
  }
  return left;
}

function parseTerm(p: Parser): number | null {
  let left = parseUnary(p);
  while (true) {
    const t = peek(p);
    if (!t || t.kind !== "op" || (t.value !== "*" && t.value !== "/")) break;
    consume(p);
    const right = parseUnary(p);
    if (left == null || right == null) left = null;
    else if (t.value === "/") left = right === 0 ? null : left / right;
    else left = left * right;
  }
  return left;
}

function parseUnary(p: Parser): number | null {
  const t = peek(p);
  if (t?.kind === "op" && t.value === "-") {
    consume(p);
    const v = parseUnary(p);
    return v == null ? null : -v;
  }
  if (t?.kind === "op" && t.value === "+") {
    consume(p);
    return parseUnary(p);
  }
  return parsePrimary(p);
}

function parsePrimary(p: Parser): number | null {
  const t = peek(p);
  if (!t) throw new Error("Unexpected end of plot expression");
  if (t.kind === "num") {
    consume(p);
    return t.value;
  }
  if (t.kind === "id") {
    consume(p);
    return resolvePath(p.meta, t.value);
  }
  if (t.kind === "op" && t.value === "(") {
    consume(p);
    const v = parseExpr(p);
    const close = consume(p);
    if (close.kind !== "op" || close.value !== ")") {
      throw new Error("Expected ')' in plot expression");
    }
    return v;
  }
  throw new Error(`Unexpected token in plot expression`);
}

/**
 * Evaluate a plot field string against crate metadata.
 * Plain paths resolve as before; arithmetic expressions are parsed safely.
 */
export function evalPlotField(
  meta: MetaRecord,
  field: string,
): number | null {
  const raw = field.trim();
  if (!raw) return null;
  if (isPlainFieldPath(raw)) return resolvePath(meta, raw);
  try {
    const tokens = tokenize(raw);
    if (tokens.length === 0) return null;
    const p: Parser = { tokens, i: 0, meta };
    const v = parseExpr(p);
    if (p.i !== tokens.length) {
      throw new Error("Trailing tokens in plot expression");
    }
    return v != null && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Pretty label for axis / plot title from an expression or path. */
export function plotFieldLabel(field: string): string {
  return field.trim().replace(/\s+/g, " ");
}

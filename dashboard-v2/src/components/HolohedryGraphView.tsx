import type { DisplayGraphModule } from "../lib/displayModule";
import { resolveJsonPath } from "../lib/displayModule";

type GraphNode = {
  id: string;
  label: string;
  order?: number;
  kurlin_deficiency_A?: number | null;
  assigned?: boolean;
  depth: number;
  off_chain: boolean;
  sg_number?: number;
  sg_hm?: string;
  extended_hm?: string;
  reference_cell?: number[];
  cob_to_reference?: string | null;
};

type GraphEdge = {
  from: string;
  to: string;
  relation?: string;
  index?: number;
};

function formatCell(cell: number[] | undefined): string | undefined {
  if (!cell?.length) return undefined;
  const [a, b, c, al, be, ga] = cell;
  const len = (x: number | undefined) =>
    typeof x === "number" ? x.toFixed(2) : "—";
  const ang = (x: number | undefined) =>
    typeof x === "number" ? x.toFixed(1) : "—";
  return `${len(a)}  ${len(b)}  ${len(c)}    ${ang(al)}  ${ang(be)}  ${ang(ga)}`;
}

function parseGraphData(
  data: unknown,
  mod: DisplayGraphModule,
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  caption?: string;
  rich: boolean;
} | null {
  const raw = resolveJsonPath(data, mod.from);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const g = raw as Record<string, unknown>;
  const idKey = mod.node_id ?? "id";
  const labelKey = mod.node_label ?? "label";
  const nodesRaw = Array.isArray(g.nodes) ? g.nodes : [];
  const edgesRaw = Array.isArray(g.edges) ? g.edges : [];
  const ef = mod.edges_from ?? "from";
  const et = mod.edges_to ?? "to";

  const chain = Array.isArray(g.primary_chain)
    ? g.primary_chain.filter((x): x is string => typeof x === "string")
    : [];
  const chainIndex = new Map(chain.map((id, i) => [id, i]));

  const draft: Array<Omit<GraphNode, "depth" | "off_chain"> & {
    depth?: number | null;
    off_chain?: boolean;
  }> = [];

  for (const n of nodesRaw) {
    if (!n || typeof n !== "object" || Array.isArray(n)) continue;
    const r = n as Record<string, unknown>;
    const id = r[idKey];
    if (typeof id !== "string") continue;
    const labelRaw = r[labelKey];
    const sgHm = typeof r.sg_hm === "string" ? r.sg_hm : undefined;
    const extended =
      typeof r.extended_hm === "string" ? r.extended_hm : undefined;
    const label =
      typeof labelRaw === "string" && labelRaw.trim()
        ? labelRaw
        : extended ?? sgHm ?? id;
    const cellRaw = r.reference_cell;
    const reference_cell = Array.isArray(cellRaw)
      ? cellRaw.filter((x): x is number => typeof x === "number")
      : undefined;
    draft.push({
      id,
      label,
      order: typeof r.order === "number" ? r.order : undefined,
      kurlin_deficiency_A:
        typeof r.kurlin_deficiency_A === "number" ? r.kurlin_deficiency_A : null,
      assigned: r.assigned === true,
      depth: typeof r.depth === "number" ? r.depth : r.depth === null ? null : undefined,
      off_chain: r.off_chain === true,
      sg_number: typeof r.sg_number === "number" ? r.sg_number : undefined,
      sg_hm: sgHm,
      extended_hm: extended,
      reference_cell:
        reference_cell && reference_cell.length >= 6
          ? reference_cell.slice(0, 6)
          : undefined,
      cob_to_reference:
        typeof r.cob_to_reference === "string"
          ? r.cob_to_reference
          : r.cob_to_reference === null
            ? null
            : typeof r.cob === "string"
              ? r.cob
              : undefined,
    });
  }

  if (!draft.length) return null;

  const rich = draft.some(
    (n) => n.reference_cell?.length || n.sg_hm || n.extended_hm,
  );

  const hasExplicitDepth = draft.some((n) => typeof n.depth === "number");
  const orderRanks = new Map<number, number>();
  if (!hasExplicitDepth && !chain.length) {
    const orders = [
      ...new Set(
        draft
          .map((n) => n.order)
          .filter((o): o is number => typeof o === "number"),
      ),
    ].sort((a, b) => b - a);
    orders.forEach((o, i) => orderRanks.set(o, i));
  }

  const chainOrderAtDepth = new Map<number, number>();
  for (const n of draft) {
    const di = chainIndex.get(n.id);
    if (di != null && typeof n.order === "number") {
      chainOrderAtDepth.set(di, n.order);
    }
  }

  const nodes: GraphNode[] = draft.map((n) => {
    let depth: number;
    let offChain: boolean;

    if (typeof n.depth === "number") {
      depth = n.depth;
      offChain = n.off_chain === true;
    } else if (chain.length) {
      const ci = chainIndex.get(n.id);
      if (ci != null) {
        depth = ci;
        offChain = false;
      } else {
        offChain = true;
        let matched: number | undefined;
        if (typeof n.order === "number") {
          for (const [d, ord] of chainOrderAtDepth) {
            if (ord === n.order) {
              matched = d;
              break;
            }
          }
        }
        depth = matched ?? Math.max(chain.length - 1, 0);
      }
    } else if (typeof n.order === "number" && orderRanks.has(n.order)) {
      depth = orderRanks.get(n.order)!;
      offChain = false;
    } else {
      depth = 0;
      offChain = n.off_chain === true;
    }

    return { ...n, depth, off_chain: offChain };
  });

  const edges: GraphEdge[] = [];
  for (const e of edgesRaw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const r = e as Record<string, unknown>;
    if (typeof r[ef] !== "string" || typeof r[et] !== "string") continue;
    edges.push({
      from: r[ef] as string,
      to: r[et] as string,
      relation: typeof r.relation === "string" ? r.relation : undefined,
      index: typeof r.index === "number" ? r.index : undefined,
    });
  }

  const caption =
    typeof g.note === "string" && g.note.trim() ? g.note.trim() : undefined;

  return { nodes, edges, caption, rich };
}

const PAD = 28;
const COL_GAP = 40;
const ROW_GAP = 52;

function estimateTextWidth(text: string, fontSize: number): number {
  // ui-monospace is roughly 0.62em wide on average for digits/spaces.
  return Math.ceil(text.length * fontSize * 0.62);
}

function layoutNodes(nodes: GraphNode[], rich: boolean) {
  const nodeH = rich ? 120 : 56;

  let contentW = rich ? 280 : 160;
  for (const n of nodes) {
    const title = titleLine(n);
    const cell = formatCell(n.reference_cell);
    const ext =
      n.extended_hm && n.extended_hm !== n.sg_hm
        ? `ext ${n.extended_hm}`
        : "";
    const cob = n.cob_to_reference ? `CoB ${n.cob_to_reference}` : "";
    if (rich) {
      contentW = Math.max(
        contentW,
        estimateTextWidth(title, 14),
        estimateTextWidth(ext, 12),
        estimateTextWidth(cell ?? "", 12),
        estimateTextWidth(cob, 12),
      );
    } else {
      contentW = Math.max(contentW, estimateTextWidth(n.label, 13));
    }
  }
  const nodeW = rich
    ? Math.min(440, Math.max(320, contentW + 32))
    : Math.min(320, Math.max(160, contentW + 24));

  const byDepth = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const list = byDepth.get(n.depth) ?? [];
    list.push(n);
    byDepth.set(n.depth, list);
  }
  for (const list of byDepth.values()) {
    list.sort((a, b) => {
      if (a.off_chain !== b.off_chain) return a.off_chain ? 1 : -1;
      if ((a.order ?? 0) !== (b.order ?? 0)) {
        return (b.order ?? 0) - (a.order ?? 0);
      }
      return (a.sg_hm ?? a.label).localeCompare(b.sg_hm ?? b.label);
    });
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();

  depths.forEach((d, row) => {
    const rowNodes = byDepth.get(d) ?? [];
    rowNodes.forEach((n, col) => {
      positions.set(n.id, {
        x: PAD + col * (nodeW + COL_GAP),
        y: PAD + row * (nodeH + ROW_GAP),
      });
    });
  });

  let maxX = PAD + nodeW;
  let maxY = PAD + nodeH;
  for (const p of positions.values()) {
    maxX = Math.max(maxX, p.x + nodeW);
    maxY = Math.max(maxY, p.y + nodeH);
  }

  return { positions, width: maxX + PAD, height: maxY + PAD, nodeW, nodeH };
}

function titleLine(n: GraphNode): string {
  if (n.sg_number != null && n.sg_hm) return `${n.sg_number}: ${n.sg_hm}`;
  if (n.sg_hm) return n.sg_hm;
  return n.label;
}

export default function HolohedryGraphView({
  mod,
  data,
}: {
  mod: DisplayGraphModule;
  data: unknown;
}) {
  const parsed = parseGraphData(data, mod);
  if (!parsed) {
    return (
      <p className="text-base text-slate-400">
        {mod.title ?? "Graph"}: no node data
      </p>
    );
  }

  const { nodes, edges, caption, rich } = parsed;
  const highlightKey = mod.highlight_field ?? "assigned";
  const { positions, width, height, nodeW, nodeH } = layoutNodes(nodes, rich);
  const markerId = `graph-arrow-${mod.from.replace(/\W+/g, "-")}`;

  const hasKurlin = nodes.some((n) => n.kurlin_deficiency_A != null);
  const legend = hasKurlin
    ? "Solid arrows: metric holohedry chain · dashed boxes: off-chain systems"
    : "HM + cell are in the reference (ITA) setting · dashed boxes: off primary chain · [n] = subgroup index";

  return (
    <div className="space-y-2">
      {mod.title ? (
        <h3 className="text-lg font-semibold text-slate-100">{mod.title}</h3>
      ) : null}
      <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-4 overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="min-w-[24rem]"
          role="img"
          aria-label={mod.title ?? "Graph"}
        >
          <defs>
            <marker
              id={markerId}
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#64748b" />
            </marker>
          </defs>

          {edges.map((e) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return null;
            const sameRow = Math.abs(a.y - b.y) < 1;
            const x1 = sameRow ? a.x + nodeW : a.x + nodeW / 2;
            const y1 = sameRow ? a.y + nodeH / 2 : a.y + nodeH;
            const x2 = sameRow ? b.x : b.x + nodeW / 2;
            const y2 = sameRow ? b.y + nodeH / 2 : b.y;
            return (
              <g key={`${e.from}-${e.to}`}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#64748b"
                  strokeWidth={2}
                  markerEnd={`url(#${markerId})`}
                />
                {e.index != null ? (
                  <text
                    x={(x1 + x2) / 2 + 8}
                    y={(y1 + y2) / 2}
                    fill="#94a3b8"
                    fontSize={12}
                    fontFamily="ui-monospace, monospace"
                  >
                    [{e.index}]
                  </text>
                ) : null}
              </g>
            );
          })}

          {nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const highlighted =
              highlightKey === "assigned"
                ? n.assigned
                : (n as Record<string, unknown>)[highlightKey] === true;
            const title = titleLine(n);
            const cell = formatCell(n.reference_cell);
            const showExtended =
              Boolean(n.extended_hm) &&
              n.extended_hm !== n.sg_hm &&
              n.cob_to_reference;
            const meta = [
              n.order != null ? `order ${n.order}` : null,
              n.kurlin_deficiency_A != null
                ? `Δ ${n.kurlin_deficiency_A.toExponential(2)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <g key={n.id}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={nodeW}
                  height={nodeH}
                  rx={8}
                  fill={
                    highlighted ? "#064e3b" : n.off_chain ? "#1e293b" : "#0f172a"
                  }
                  stroke={
                    highlighted
                      ? "#34d399"
                      : n.off_chain
                        ? "#475569"
                        : "#64748b"
                  }
                  strokeWidth={highlighted ? 2.5 : 1.5}
                  strokeDasharray={n.off_chain ? "4 3" : undefined}
                />
                <text
                  x={p.x + 12}
                  y={p.y + 22}
                  fill="#f8fafc"
                  fontSize={14}
                  fontWeight={700}
                  fontFamily="ui-monospace, monospace"
                >
                  {title}
                </text>
                {rich ? (
                  <>
                    {showExtended ? (
                      <text
                        x={p.x + 12}
                        y={p.y + 42}
                        fill="#7dd3fc"
                        fontSize={12}
                        fontFamily="ui-monospace, monospace"
                      >
                        {`ext ${n.extended_hm}`}
                      </text>
                    ) : meta ? (
                      <text
                        x={p.x + 12}
                        y={p.y + 42}
                        fill="#94a3b8"
                        fontSize={12}
                        fontFamily="ui-monospace, monospace"
                      >
                        {meta}
                      </text>
                    ) : null}
                    {cell ? (
                      <text
                        x={p.x + 12}
                        y={p.y + (showExtended || meta ? 62 : 48)}
                        fill="#e2e8f0"
                        fontSize={12}
                        fontFamily="ui-monospace, monospace"
                      >
                        {cell}
                      </text>
                    ) : null}
                    {n.cob_to_reference ? (
                      <text
                        x={p.x + 12}
                        y={p.y + (cell ? 82 : 62)}
                        fill="#cbd5e1"
                        fontSize={12}
                        fontFamily="ui-monospace, monospace"
                      >
                        {`CoB ${n.cob_to_reference}`}
                      </text>
                    ) : showExtended || meta ? null : (
                      <text
                        x={p.x + 12}
                        y={p.y + 62}
                        fill="#64748b"
                        fontSize={11}
                      >
                        reference setting
                      </text>
                    )}
                    {showExtended && meta ? (
                      <text
                        x={p.x + nodeW - 12}
                        y={p.y + 22}
                        textAnchor="end"
                        fill="#94a3b8"
                        fontSize={11}
                        fontFamily="ui-monospace, monospace"
                      >
                        {meta}
                      </text>
                    ) : null}
                  </>
                ) : (
                  meta && (
                    <text
                      x={p.x + nodeW / 2}
                      y={p.y + 40}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize={12}
                      fontFamily="ui-monospace, monospace"
                    >
                      {meta}
                    </text>
                  )
                )}
              </g>
            );
          })}
        </svg>
        <p className="text-sm text-slate-500 mt-3">{legend}</p>
        {caption ? (
          <p className="text-sm text-slate-500 mt-1 max-w-4xl leading-relaxed">
            {caption}
          </p>
        ) : null}
      </div>
    </div>
  );
}

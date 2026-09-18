import { itemsPerRowGrid, type Subproject } from "../lib/projectBookApi";

type Props = {
  nodes: Subproject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  chipGap?: string;
  itemsPerRow?: number;
};

function childrenOf(nodes: Subproject[], parentId: string | null): Subproject[] {
  return nodes
    .filter((n) => (n.parent_id ?? null) === parentId)
    .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
}

function NodeList({
  nodes,
  parentId,
  depth,
  selectedId,
  onSelect,
  chipGap,
  itemsPerRow,
}: {
  nodes: Subproject[];
  parentId: string | null;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  chipGap: string;
  itemsPerRow: number;
}) {
  const kids = childrenOf(nodes, parentId);
  if (!kids.length) return null;
  return (
    <ul
      className={depth > 0 ? "mt-3 pl-4 border-l border-slate-700" : undefined}
      style={itemsPerRowGrid(itemsPerRow, chipGap)}
    >
      {kids.map((node) => {
        const selected = node.id === selectedId;
        const hasKids = childrenOf(nodes, node.id).length > 0;
        return (
          <li key={node.id} className={hasKids ? "w-full" : undefined}>
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className={`inline-flex items-baseline gap-2 px-3.5 py-2.5 rounded-lg text-base ${
                selected
                  ? "bg-sky-800/80 text-sky-50 ring-1 ring-sky-400/70"
                  : "bg-slate-800/80 text-slate-100 hover:bg-slate-700"
              }`}
            >
              <span className="font-medium">{node.title}</span>
              <span className="text-sm text-slate-400">
                {node.crate_uuids.length}
              </span>
            </button>
            <NodeList
              nodes={nodes}
              parentId={node.id}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              chipGap={chipGap}
              itemsPerRow={itemsPerRow}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default function SubprojectTree({
  nodes,
  selectedId,
  onSelect,
  chipGap = "0.65rem",
  itemsPerRow = 3,
}: Props) {
  if (!nodes.length) {
    return <p className="text-base text-slate-500">No subprojects yet.</p>;
  }
  return (
    <NodeList
      nodes={nodes}
      parentId={null}
      depth={0}
      selectedId={selectedId}
      onSelect={onSelect}
      chipGap={chipGap}
      itemsPerRow={itemsPerRow}
    />
  );
}

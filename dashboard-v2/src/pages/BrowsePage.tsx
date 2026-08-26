import { TiledLookup } from "@blueskyproject/finch";

export default function BrowsePage() {
  return (
    <div className="flex flex-col w-full min-h-[24rem]">
      <p className="text-xs text-slate-500 pb-2 shrink-0">
        Raw Tiled catalog tree — start at{" "}
        <code className="text-sky-300">crates</code>.
      </p>
      <div className="flex-1 min-h-[20rem]">
        <TiledLookup backgroundClassName="text-slate-700" />
      </div>
    </div>
  );
}

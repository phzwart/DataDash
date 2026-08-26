import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ResolvedPlotLayout } from "../lib/schema";
import type { ThreePlotSpec } from "../lib/schema";
import { getPlotSelection, subscribePlotSelection } from "../lib/plotSelection";

type CrateLike = { id: string; metadata: Record<string, unknown> };

type CellParams = {
  id: string;
  label: string;
  colorKey: string;
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
};

const PALETTE = [
  0x38bdf8, 0xa78bfa, 0x34d399, 0xfbbf24, 0xf87171, 0xe879f9, 0x94a3b8,
];

function num(meta: Record<string, unknown>, key: string): number | null {
  const v = meta[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function cellFromCrate(
  crate: CrateLike,
  fields: NonNullable<ThreePlotSpec["fields"]>,
): CellParams | null {
  const a = num(crate.metadata, fields.a ?? "unit_cell_a");
  const b = num(crate.metadata, fields.b ?? "unit_cell_b");
  const c = num(crate.metadata, fields.c ?? "unit_cell_c");
  if (a == null || b == null || c == null) return null;
  const alpha = num(crate.metadata, fields.alpha ?? "unit_cell_alpha") ?? 90;
  const beta = num(crate.metadata, fields.beta ?? "unit_cell_beta") ?? 90;
  const gamma = num(crate.metadata, fields.gamma ?? "unit_cell_gamma") ?? 90;
  const labelKey = fields.label ?? "sample_code";
  const colorKey = fields.color ?? "space_group";
  return {
    id: crate.id,
    label: String(crate.metadata[labelKey] ?? crate.id.slice(0, 8)),
    colorKey: String(crate.metadata[colorKey] ?? "default"),
    a,
    b,
    c,
    alpha,
    beta,
    gamma,
  };
}

/** Crystallographic cell → Cartesian edge vectors (Å). */
function cellVectors(p: CellParams): {
  va: THREE.Vector3;
  vb: THREE.Vector3;
  vc: THREE.Vector3;
} {
  const alpha = (p.alpha * Math.PI) / 180;
  const beta = (p.beta * Math.PI) / 180;
  const gamma = (p.gamma * Math.PI) / 180;
  const va = new THREE.Vector3(p.a, 0, 0);
  const vb = new THREE.Vector3(p.b * Math.cos(gamma), p.b * Math.sin(gamma), 0);
  const cx = p.c * Math.cos(beta);
  const cy =
    (p.c * (Math.cos(alpha) - Math.cos(beta) * Math.cos(gamma))) /
    Math.sin(gamma);
  const czSq = p.c * p.c - cx * cx - cy * cy;
  const cz = Math.sqrt(Math.max(0, czSq));
  const vc = new THREE.Vector3(cx, cy, cz);
  return { va, vb, vc };
}

function makeWireCell(
  p: CellParams,
  color: number,
  selected: boolean,
): THREE.LineSegments {
  const { va, vb, vc } = cellVectors(p);
  const o = new THREE.Vector3(0, 0, 0);
  const corners = [
    o.clone(),
    va.clone(),
    vb.clone(),
    vc.clone(),
    va.clone().add(vb),
    va.clone().add(vc),
    vb.clone().add(vc),
    va.clone().add(vb).add(vc),
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 4],
    [1, 5],
    [2, 4],
    [2, 6],
    [3, 5],
    [3, 6],
    [4, 7],
    [5, 7],
    [6, 7],
  ];
  const positions: number[] = [];
  for (const [i, j] of edges) {
    positions.push(corners[i].x, corners[i].y, corners[i].z);
    positions.push(corners[j].x, corners[j].y, corners[j].z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: selected ? 0xfbbf24 : color,
    linewidth: selected ? 2 : 1,
    transparent: true,
    opacity: selected ? 1 : 0.75,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.userData.crateId = p.id;
  lines.userData.label = p.label;
  return lines;
}

export default function UnitCell3DView({
  panel,
  crates,
  layout,
  fill = false,
  sourceId,
  onSelectionChange,
}: {
  panel: ThreePlotSpec;
  crates: CrateLike[];
  layout: ResolvedPlotLayout;
  fill?: boolean;
  sourceId: string;
  onSelectionChange: (source: string, ids: string[]) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const fields = panel.fields ?? {};

  const cells = useMemo(() => {
    const out: CellParams[] = [];
    for (const c of crates) {
      const cell = cellFromCrate(c, fields);
      if (cell) out.push(cell);
    }
    return out;
  }, [crates, fields]);

  const colorIndex = useMemo(() => {
    const keys = [...new Set(cells.map((c) => c.colorKey))];
    const map = new Map<string, number>();
    keys.forEach((k, i) => map.set(k, PALETTE[i % PALETTE.length]));
    return map;
  }, [cells]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const avail = fill
      ? mount.clientWidth
      : Math.round(
          (mount.parentElement?.clientWidth ?? mount.clientWidth) *
            layout.widthFraction,
        );
    const width = Math.max(fill ? 140 : 280, avail || 280);
    const height = Math.max(140, Math.round(width / layout.aspectRatio));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 2000);
    camera.position.set(120, 90, 140);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(50, 80, 40);
    scene.add(dir);

    const axes = new THREE.AxesHelper(40);
    scene.add(axes);

    const group = new THREE.Group();
    scene.add(group);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    // LineSegments need threshold for picking
    raycaster.params.Line = { threshold: 1.5 };

    let selected = new Set(getPlotSelection().ids);
    const meshById = new Map<string, THREE.LineSegments>();

    const rebuild = () => {
      while (group.children.length) {
        const ch = group.children.pop();
        ch?.traverse((o) => {
          if (o instanceof THREE.LineSegments) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
      }
      meshById.clear();

      // Layout cells in a grid offset so they don't overlap.
      const n = cells.length;
      const cols = Math.ceil(Math.sqrt(n)) || 1;
      const gap = 30;
      cells.forEach((cell, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const wire = makeWireCell(
          cell,
          colorIndex.get(cell.colorKey) ?? 0x38bdf8,
          selected.has(cell.id),
        );
        // Center each cell locally then offset in the grid
        const { va, vb, vc } = cellVectors(cell);
        const center = va.clone().add(vb).add(vc).multiplyScalar(0.5);
        wire.position.set(col * (gap + 20) - center.x, -center.y, row * (gap + 20) - center.z);
        group.add(wire);
        meshById.set(cell.id, wire);

        // Tiny label sprite via canvas texture
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "rgba(15,23,42,0.0)";
          ctx.fillRect(0, 0, 256, 64);
          ctx.fillStyle = "#e2e8f0";
          ctx.font = "28px sans-serif";
          ctx.fillText(cell.label.slice(0, 16), 8, 40);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const sprMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
        const spr = new THREE.Sprite(sprMat);
        spr.scale.set(18, 4.5, 1);
        spr.position.copy(wire.position).add(new THREE.Vector3(0, 12, 0));
        group.add(spr);
      });

      // Fit camera
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      controls.target.copy(mid);
      const dist = Math.max(size.x, size.y, size.z, 40) * 1.8;
      camera.position.set(mid.x + dist * 0.7, mid.y + dist * 0.5, mid.z + dist);
      camera.lookAt(mid);
      controls.update();
    };

    rebuild();

    const unsub = subscribePlotSelection(() => {
      selected = new Set(getPlotSelection().ids);
      rebuild();
    });

    const onClick = (ev: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(group.children, true);
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object;
        while (obj && !obj.userData.crateId) obj = obj.parent;
        if (obj?.userData.crateId) {
          const id = String(obj.userData.crateId);
          const next = new Set(selected);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          onSelectionChange(sourceId, [...next]);
          return;
        }
      }
    };
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      if (!mount) return;
      const w = Math.max(
        fill ? 140 : 280,
        fill
          ? mount.clientWidth
          : Math.round(
              (mount.parentElement?.clientWidth ?? mount.clientWidth) *
                layout.widthFraction,
            ),
      );
      const h = Math.max(140, Math.round(w / layout.aspectRatio));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      unsub();
      ro.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      mount.innerHTML = "";
    };
  }, [
    cells,
    colorIndex,
    fill,
    layout.aspectRatio,
    layout.widthFraction,
    onSelectionChange,
    sourceId,
  ]);

  return (
    <div className="min-w-0 w-full">
      {panel.title ? (
        <h3 className="text-sm font-medium text-slate-200 mb-1 truncate">
          {panel.title}
        </h3>
      ) : null}
      <p className="text-[10px] text-slate-500 mb-1">
        Orbit drag · click cell to toggle selection · n={cells.length}
      </p>
      <div
        ref={mountRef}
        className="w-full rounded-md overflow-hidden border border-slate-700/80 bg-slate-950"
        style={{ minHeight: 140 }}
      />
    </div>
  );
}

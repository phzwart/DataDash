"""Symmetry exploration for the Lambda agent (agentsg-backed).

Computes metric holohedry, Niggli/Selling cells, Kurlin roots, Selling orbit,
deficiency spectrum, holohedry descent graph, and an ITA symmetry plate PNG.
"""
from __future__ import annotations

import json
from pathlib import Path

IDEAL_HOLOHEDRY = {
    "cubic": (5.0, 5.0, 5.0, 90.0, 90.0, 90.0),
    "tetragonal": (5.0, 5.0, 8.0, 90.0, 90.0, 90.0),
    "hexagonal": (5.0, 5.0, 8.0, 90.0, 90.0, 120.0),
    "trigonal": (5.0, 5.0, 5.0, 70.0, 70.0, 70.0),
    "orthorhombic": (5.0, 6.0, 7.0, 90.0, 90.0, 90.0),
    "monoclinic": (5.0, 6.0, 7.0, 90.0, 95.0, 90.0),
    "triclinic": (5.0, 6.0, 7.0, 80.0, 85.0, 95.0),
}

HOLOHEDRY_ORDER = {
    "triclinic": 2,
    "monoclinic": 4,
    "orthorhombic": 8,
    "trigonal": 12,
    "tetragonal": 16,
    "hexagonal": 24,
    "cubic": 48,
}

# Standard metric-symmetry descent chains (holohedry → … → triclinic).
HOLOHEDRY_CHAINS = {
    "cubic": ["cubic", "tetragonal", "orthorhombic", "monoclinic", "triclinic"],
    "hexagonal": ["hexagonal", "orthorhombic", "monoclinic", "triclinic"],
    "trigonal": ["trigonal", "monoclinic", "triclinic"],
    "tetragonal": ["tetragonal", "orthorhombic", "monoclinic", "triclinic"],
    "orthorhombic": ["orthorhombic", "monoclinic", "triclinic"],
    "monoclinic": ["monoclinic", "triclinic"],
    "triclinic": ["triclinic"],
}


def _build_holohedry_references(max_delta: float = 0.5):
    from agentsg.lattice_symmetry import lattice_symmetry

    refs = {}
    for name, cell in IDEAL_HOLOHEDRY.items():
        ls = lattice_symmetry(cell, max_delta=max_delta)
        refs[name] = {
            "cell": list(cell),
            "order": ls.order,
            "operations": [op.as_xyz() for op in ls.operations],
            "ops": ls.operations,
        }
    return refs


def _matrix_rows(M):
    if hasattr(M, "rows"):
        return [list(row) for row in M.rows]
    return [list(row) for row in M]


def _distinct_selling_orbit(cell, sg_hm: str):
    from agentsg.cell.selling_settings import selling_settings, distinct_settings

    all_settings = selling_settings(cell, sg_hm)
    distinct = distinct_settings(cell, sg_hm)
    orbit = []
    for ops_key, recs in distinct.items():
        rep = recs[0]
        orbit.append({
            "operator_index": rep.operator_index,
            "det": rep.det,
            "cob_string": rep.cob_string,
            "cell": list(rep.cell),
            "n_operators_equivalent": len(recs),
            "operations": list(rep.operations),
        })
    return {
        "n_selling_operators": len(all_settings),
        "n_distinct_settings": len(distinct),
        "distinct_settings": orbit,
    }


def _holohedry_graph(assigned: str, spectrum: dict[str, float]):
    chain = HOLOHEDRY_CHAINS.get(assigned, ["triclinic"])
    nodes = []
    for i, name in enumerate(chain):
        nodes.append({
            "id": name,
            "order": HOLOHEDRY_ORDER.get(name),
            "kurlin_deficiency_A": spectrum.get(name),
            "assigned": name == assigned,
            "depth": i,
        })
    edges = [
        {"from": chain[i], "to": chain[i + 1], "relation": "metric_subgroup"}
        for i in range(len(chain) - 1)
    ]
    # Full spectrum nodes not on the primary chain (sibling holohedries).
    for name, dist in sorted(spectrum.items(), key=lambda t: t[1]):
        if name not in chain:
            nodes.append({
                "id": name,
                "order": HOLOHEDRY_ORDER.get(name),
                "kurlin_deficiency_A": dist,
                "assigned": False,
                "depth": None,
                "off_chain": True,
            })
    return {
        "assigned_holohedry": assigned,
        "primary_chain": chain,
        "nodes": nodes,
        "edges": edges,
        "spectrum_sorted": [
            {"system": k, "kurlin_deficiency_A": v}
            for k, v in sorted(spectrum.items(), key=lambda t: t[1])
        ],
    }


def _op_key(op) -> str:
    return op.as_xyz()


def _ita_xyz(op) -> str:
    """ITA-style xyz with a space after each comma."""
    return ", ".join(part.strip() for part in op.as_xyz().split(","))


def _ordered_general_positions(ops) -> list[str]:
    """Identity first, then a stable (W, w) order — not frozenset iteration."""
    from agentsg.symmetry_op import SymmetryOp

    identity = SymmetryOp.identity()
    rest = [op for op in ops if op != identity]
    rest.sort(
        key=lambda op: (
            tuple(tuple(int(c) for c in row) for row in op.W.rows),
            tuple((t.numerator, t.denominator) for t in op.w.v),
        )
    )
    ordered = ([identity] if identity in ops else []) + rest
    return [_ita_xyz(op) for op in ordered]


def _closed_subgroups(ops):
    """All closed subgroups of ``ops`` under composition (same lattice).

    Pure operator algebra — no maximal-subgroup table. Enumerates by BFS:
    start from {identity}, close after adjoining one element at a time.
    """
    from agentsg.symmetry_op import SymmetryOp
    from agentsg.linalg import IDENTITY3, ZERO3
    from agentsg.group import close_group

    identity = SymmetryOp(IDENTITY3, ZERO3)
    universe = frozenset(ops)
    found = {frozenset([identity])}
    queue = [frozenset([identity])]
    while queue:
        H = queue.pop()
        for g in universe:
            if g in H:
                continue
            seeds = list(H | {g})
            try:
                K = frozenset(close_group(
                    seeds,
                    centering_vectors=[ZERO3],
                    max_order=len(universe) + 1,
                ))
            except RuntimeError:
                continue
            if not K.issubset(universe):
                continue
            if K not in found:
                found.add(K)
                if len(K) < len(universe):
                    queue.append(K)
    found.add(universe)
    return found


def _transform_cell(cell, cob):
    """Unit-cell parameters in the new basis: G' = Pᵀ G P."""
    from agentsg.cell.metric import UnitCell, params_from_metric

    G = UnitCell(*cell).metric_tensor()
    P = cob.P.rows
    Gp = [
        [sum(P[i][a] * G[i][k] * P[k][b] for i in range(3) for k in range(3))
         for b in range(3)]
        for a in range(3)
    ]
    return [round(float(x), 6) for x in params_from_metric(Gp)]


def _label_subgroup(ops_set, cell, *, cob_candidates=None):
    """Identify a closed op set; attach reference-setting HM + cell.

    Direct ``identify_space_group`` first. If that fails (e.g. unique-axis
    monoclinic setting), search a finite CoB group (default: Selling order-48)
    so that ``cob.apply_to_op`` maps the set onto a standard setting.

    Returns:
      * ``sg_hm`` / ``sg_number`` — reference (ITA standard) setting
      * ``extended_hm`` — HM with CoB when the subgroup is non-standard
      * ``reference_cell`` — query cell reindexed into the reference setting
        (G' = PᵀGP for the CoB that maps ops → standard)
      * ``cob_to_reference`` — that CoB as an ``(a,b,c)`` string (None if already
        standard)
    """
    from agentsg.identify import identify_space_group
    from agentsg.setting import format_cob
    from agentsg.cell.selling_group import selling_group
    from agentsg.change_of_basis import ChangeOfBasis
    from agentsg.linalg import IDENTITY3, ZERO3

    cell = tuple(float(x) for x in cell)
    result = identify_space_group(ops_set)
    if result is not None:
        return {
            "sg_number": result.number,
            "sg_hm": result.hermann_mauguin,
            "extended_hm": result.hermann_mauguin,
            "hall": result.hall,
            "cob": None,
            "cob_to_reference": None,
            "reference_cell": list(cell),
            "identified": True,
            "label": f"{result.number}:{result.hermann_mauguin}",
        }

    if cob_candidates is None:
        cob_candidates = selling_group()

    for cob in cob_candidates:
        transformed = frozenset(cob.apply_to_op(op) for op in ops_set)
        result = identify_space_group(transformed)
        if result is None:
            continue
        # cob maps H → standard; cell in reference setting uses the same P.
        inv = cob.inverse()
        cob_from_ref = format_cob(inv, "abc")       # extended-HM parenthetical
        cob_to_ref = format_cob(cob, "abc")         # current → reference
        extended = f"{result.hermann_mauguin} {cob_from_ref}"
        return {
            "sg_number": result.number,
            "sg_hm": result.hermann_mauguin,
            "extended_hm": extended,
            "hall": result.hall,
            "cob": cob_from_ref,
            "cob_to_reference": cob_to_ref,
            "reference_cell": _transform_cell(cell, cob),
            "identified": True,
            "label": f"{result.number}:{extended}",
        }

    return {
        "sg_number": None,
        "sg_hm": None,
        "extended_hm": None,
        "hall": None,
        "cob": None,
        "cob_to_reference": None,
        "reference_cell": list(cell),
        "identified": False,
        "label": f"closed_order_{len(ops_set)}",
    }


def _space_group_graph(sg_hm: str, cell) -> dict:
    """Hasse diagram of closed subgroups of the assigned space group down to P1.

    Edges are proper inclusions with no intermediate closed subgroup
    (translationengleiche / same-lattice only). Klassengleiche (lattice-
    changing) descents are out of scope without tabulated data.

    Each node carries the reference-setting HM and the query cell reindexed
    into that setting (for indexing inspection).
    """
    from agentsg.space_groups import space_group
    from agentsg.cell.selling_group import selling_group

    sg = space_group(sg_hm)
    universe = frozenset(sg.operations())
    subgroups = _closed_subgroups(universe)
    cob_candidates = selling_group()
    cell = tuple(float(x) for x in cell)

    nodes = []
    id_by_ops = {}
    for H in sorted(subgroups, key=lambda s: (-len(s), sorted(_op_key(o) for o in s))):
        label_info = _label_subgroup(H, cell, cob_candidates=cob_candidates)
        node_id = label_info["label"]
        base = node_id
        n = 1
        while node_id in id_by_ops.values():
            n += 1
            node_id = f"{base}#{n}"
        id_by_ops[H] = node_id
        nodes.append({
            "id": node_id,
            "order": len(H),
            "assigned": H == universe,
            "is_p1": len(H) == 1,
            "operations": sorted(_op_key(o) for o in H),
            **label_info,
            "label": node_id,
        })

    edges = []
    items = list(id_by_ops.items())
    for A, id_a in items:
        for B, id_b in items:
            if B >= A or not B.issubset(A):
                continue
            intermediate = False
            for C, _ in items:
                if C is A or C is B:
                    continue
                if B.issubset(C) and C.issubset(A) and B != C and C != A:
                    intermediate = True
                    break
            if not intermediate:
                edges.append({
                    "from": id_a,
                    "to": id_b,
                    "relation": "closed_subgroup",
                    "index": len(A) // len(B) if len(B) else None,
                })

    current = universe
    chain = [id_by_ops[current]]
    while len(current) > 1:
        candidates = [
            H for H in subgroups
            if H < current and H.issubset(current)
        ]
        if not candidates:
            break
        children = [
            H for H in candidates
            if any(e["from"] == id_by_ops[current] and e["to"] == id_by_ops[H]
                   for e in edges)
        ]
        pool = children or candidates
        nxt = max(pool, key=len)
        chain.append(id_by_ops[nxt])
        current = nxt

    return {
        "method": "closed_subgroups_of_ops",
        "scope": "translationengleiche_same_lattice",
        "note": (
            "Subgroups are closed subsets of the assigned group's operators "
            "(computed by composition). No Bilbao/ITA maximal-subgroup table. "
            "Each node lists reference-setting HM + unit cell (G'=PᵀGP). "
            "Klassengleiche (lattice-changing) subgroups are not included."
        ),
        "query_cell": list(cell),
        "assigned": id_by_ops[universe],
        "n_subgroups": len(subgroups),
        "primary_chain": chain,
        "nodes": nodes,
        "edges": edges,
    }


def _render_ita_plate(sg_hm: str, out_path: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from agentsg.space_groups import space_group
    from agentsg.cell.diagrams import ita_plate

    sg = space_group(sg_hm)
    fig = ita_plate(sg, legend=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def explore(
    cell,
    sg,
    *,
    max_delta: float = 3.0,
    output_dir: Path,
    source_crate_uuid: str | None = None,
    job_uuid: str | None = None,
) -> dict:
    """Run full symmetry exploration; write products under output_dir/data."""
    from agentsg.space_groups import space_group
    from agentsg.lattice_symmetry import lattice_symmetry
    from agentsg.cell.reduction import niggli_reduce, niggli_gk
    from agentsg.cell.rootform import root_invariant, root_products, conorms
    from agentsg.cell.g6 import kurlin_deficiency_spectrum
    from agentsg.cell.primitive import primitive_cell, lattice_letter
    from agentsg.cell.canonical import canonical_superbase

    sg_key = int(sg) if isinstance(sg, str) and sg.strip().isdigit() else sg
    sg_rec = space_group(sg_key)
    sg_number, sg_hm = sg_rec.number, sg_rec.hermann_mauguin
    general_positions = _ordered_general_positions(sg_rec.operations())
    cell = tuple(float(x) for x in cell)

    data_dir = output_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # Metric holohedry (Le Page gate).
    ls = lattice_symmetry(cell, max_delta=max_delta)
    refs = _build_holohedry_references()
    tol_ops = {name: ref["ops"] for name, ref in refs.items()}
    spectrum = kurlin_deficiency_spectrum(cell, tol_ops)

    # Cells.
    niggli, niggli_M = niggli_reduce(*cell)
    niggli_gk_cell, niggli_gk_M = niggli_gk(cell)
    prim = primitive_cell(cell, sg_hm)
    C, conorm_mat = canonical_superbase(cell)
    roots = root_invariant(prim)
    rprods = {f"{i}_{j}": v for (i, j), v in root_products(prim).items()}
    cnorms = {f"{i}_{j}": v for (i, j), v in conorms(prim).items()}

    selling_orbit = _distinct_selling_orbit(cell, sg_hm)

    # ITA plate.
    plate_path = data_dir / "ita_plate.png"
    _render_ita_plate(sg_hm, plate_path)

    graph = _holohedry_graph(ls.crystal_system, spectrum)
    sg_graph = _space_group_graph(sg_hm, cell)

    report = {
        "job_uuid": job_uuid,
        "source_crate_uuid": source_crate_uuid,
        "query": {
            "cell": list(cell),
            "sg": sg,
            "sg_number": sg_number,
            "sg_hm": sg_hm,
            "hall": sg_rec.hall,
            "centering": lattice_letter(sg_hm),
            "max_delta_deg": max_delta,
        },
        "space_group": {
            "number": sg_number,
            "hm": sg_hm,
            "hall": sg_rec.hall,
            "order": len(general_positions),
            "general_positions": general_positions,
        },
        "metric_symmetry": {
            "crystal_system": ls.crystal_system,
            "order": ls.order,
            "n_operations": len(ls.operations),
            "operations": [op.as_xyz() for op in ls.operations],
            "two_folds": [
                {
                    "le_page_delta_deg": s.le_page_delta,
                    "kurlin_distance_A": s.kurlin_distance,
                    "matrix": s.matrix,
                }
                for s in ls.two_fold_scores
            ],
        },
        "cells": {
            "input": list(cell),
            "primitive": list(prim),
            "niggli": list(niggli),
            "niggli_change_of_basis": _matrix_rows(niggli_M),
            "niggli_gk": list(niggli_gk_cell),
            "niggli_gk_change_of_basis": _matrix_rows(niggli_gk_M),
            "canonical_superbase_coords": [list(row) for row in C],
            "conorm_matrix": [list(row) for row in conorm_mat],
        },
        "kurlin_roots": {
            "invariant": list(roots),
            "root_products": rprods,
            "conorms": cnorms,
        },
        "deficiency_spectrum_A": spectrum,
        "holohedry_graph": graph,
        "space_group_graph": sg_graph,
        "selling_orbit": selling_orbit,
        "files": {
            "ita_plate": "data/ita_plate.png",
            "symmetry_table": "data/symmetry_table.csv",
            "space_group_graph": "data/space_group_graph.csv",
        },
    }

    # CSV table: deficiency spectrum + holohedry chain.
    import csv
    csv_path = data_dir / "symmetry_table.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "system", "order", "kurlin_deficiency_A", "on_primary_chain",
            "assigned",
        ])
        chain_set = set(graph["primary_chain"])
        for row in graph["spectrum_sorted"]:
            name = row["system"]
            w.writerow([
                name,
                HOLOHEDRY_ORDER.get(name, ""),
                f"{row['kurlin_deficiency_A']:.6f}" if row["kurlin_deficiency_A"] is not None else "",
                name in chain_set,
                name == ls.crystal_system,
            ])

    sg_csv = data_dir / "space_group_graph.csv"
    with sg_csv.open("w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow([
            "id", "order", "sg_number", "sg_hm_reference", "extended_hm",
            "cob_to_reference",
            "a", "b", "c", "alpha", "beta", "gamma",
            "assigned", "is_p1", "on_primary_chain",
        ])
        chain_set = set(sg_graph["primary_chain"])
        for node in sg_graph["nodes"]:
            rc = node.get("reference_cell") or [None] * 6
            w.writerow([
                node["id"],
                node["order"],
                node.get("sg_number") or "",
                node.get("sg_hm") or "",
                node.get("extended_hm") or "",
                node.get("cob_to_reference") or "",
                *(rc if len(rc) == 6 else [""] * 6),
                node["assigned"],
                node["is_p1"],
                node["id"] in chain_set,
            ])
        w.writerow([])
        w.writerow(["from", "to", "relation", "index"])
        for e in sg_graph["edges"]:
            w.writerow([e["from"], e["to"], e["relation"], e.get("index", "")])

    json_path = data_dir / "symmetry_report.json"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    report["_paths"] = {
        "symmetry_report": json_path,
        "symmetry_table": csv_path,
        "space_group_graph": sg_csv,
        "ita_plate": plate_path,
    }
    return report

from pathlib import Path

import pytest

from lambda_client_store.project_book import ProjectBook
from lambda_client_store.schema_resolve import ledger_class_names, merge_overlay

SCHEMAS = Path(__file__).resolve().parents[1] / "data_root" / "schemas"


@pytest.fixture
def book(tmp_path: Path) -> ProjectBook:
    return ProjectBook(tmp_path / "project_book.db", SCHEMAS)


def test_dashboard_layout_block(book: ProjectBook) -> None:
    _, dash = book.resolved_schema()
    layout = dash["layout"]
    assert layout["density"] == "cozy"
    assert layout["ledger"]["columns"] == 2
    assert layout["items_per_row"] == 3
    assert layout["textbox_own_line"] is True
    assert "page_gap" in layout


def test_ledger_classes_from_schema_not_hardcoded(book: ProjectBook) -> None:
    schema, dash = book.resolved_schema()
    names = ledger_class_names(schema, base=dash["ledger_entry_base"])
    assert "LedgerEntry" not in names
    assert set(names) >= {"Collaborator", "Sequence", "Compound", "Condition"}


def test_create_project_makes_unsorted(book: ProjectBook) -> None:
    rec = book.create_project(title="ACP")
    assert rec["title"] == "ACP"
    assert rec["crate_membership"] == "exclusive"
    assert rec["schema_overlay"] is None
    titles = [s["title"] for s in rec["subprojects"]]
    assert titles == ["Unsorted"]


def test_ledger_validate_and_assign(book: ProjectBook) -> None:
    rec = book.create_project(title="ACP")
    pid = rec["id"]
    entry = book.add_ledger_entry(
        pid,
        class_name="Compound",
        payload={"label": "ligand A", "smiles": "CCO"},
    )
    assert entry["class_name"] == "Compound"
    assert entry["payload"]["smiles"] == "CCO"
    with pytest.raises(ValueError, match="unknown ledger class"):
        book.add_ledger_entry(pid, class_name="NotAKind", payload={"label": "x"})
    with pytest.raises(ValueError, match="enum"):
        book.add_ledger_entry(
            pid,
            class_name="Collaborator",
            payload={"label": "Pat", "role": "wizard"},
        )
    sid = rec["subprojects"][0]["id"]
    sub = book.set_subproject_ledger(sid, add=[entry["id"]])
    assert entry["id"] in sub["ledger_entry_ids"]


def test_exclusive_filing_moves_relation(book: ProjectBook) -> None:
    rec = book.create_project(title="ACP")
    a = rec["subprojects"][0]["id"]
    b = book.add_subproject(rec["id"], title="soaks")["id"]
    book.set_subproject_crates(a, add=["crate-1"])
    book.set_subproject_crates(b, add=["crate-1"])
    assert book.get_subproject(a)["crate_uuids"] == []
    assert book.get_subproject(b)["crate_uuids"] == ["crate-1"]


def test_shared_allows_two_homes(book: ProjectBook) -> None:
    rec = book.create_project(title="ACP", crate_membership="shared")
    a = rec["subprojects"][0]["id"]
    b = book.add_subproject(rec["id"], title="protocol-2")["id"]
    book.set_subproject_crates(a, add=["crate-1"])
    book.set_subproject_crates(b, add=["crate-1"])
    assert book.get_subproject(a)["crate_uuids"] == ["crate-1"]
    assert book.get_subproject(b)["crate_uuids"] == ["crate-1"]


def test_overlay_hook_adds_class_without_migration(book: ProjectBook) -> None:
    schema, _ = book.resolved_schema()
    overlay = {
        "classes": {
            "BufferStock": {
                "is_a": "LedgerEntry",
                "slots": ["label", "notes", "recipe"],
            }
        },
        "slots": {"recipe": {"range": "string"}},
    }
    merged = merge_overlay(schema, overlay)
    names = ledger_class_names(merged)
    assert "BufferStock" in names
    assert "Compound" in names

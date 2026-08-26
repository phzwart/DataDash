"""Request assembler tests."""

from __future__ import annotations

from pathlib import Path

from agent_server.registry.loader import load_agents_from_dir
from agent_server.request_assemble import assemble_job_request

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "skills"


def test_pdb_agent_autofill_from_crate_metadata() -> None:
    agent = load_agents_from_dir(SKILLS)["035c162b-c868-4fd7-bd7d-f9404dfb250c"]
    body = assemble_job_request(
        agent,
        crate_uuid="1d290518-63c7-58dd-b816-648d915ab3f7",
        metadata={
            "unit_cell_a": 62.414,
            "unit_cell_b": 69.211,
            "unit_cell_c": 92.006,
            "unit_cell_alpha": 90,
            "unit_cell_beta": 90,
            "unit_cell_gamma": 90,
            "space_group": "P21212",
        },
        user_overrides={"cutoff": 3.5},
    )
    params = body["inputs"]["parameters"]["value"]
    assert params["cell"] == [62.414, 69.211, 92.006, 90.0, 90.0, 90.0]
    assert params["sg"] == "P21212"
    assert params["cutoff"] == 3.5
    assert params["same_hm"] is True
    assert body["inputs"]["source_crate"]["uuid"] == (
        "1d290518-63c7-58dd-b816-648d915ab3f7"
    )

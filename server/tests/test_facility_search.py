"""Tests for LAMBDA Facility Search API and asset endpoints."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from rocrate_tiled.app import create_app
from rocrate_tiled.facility_index import FacilityIndex, index_data_root
from rocrate_tiled.facility_search import FacilitySearchError, parse_search_params, search_records

DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"


@pytest.fixture(scope="module")
def client(tmp_path_factory: pytest.TempPathFactory) -> TestClient:
    if not DATA_ROOT.is_dir():
        pytest.skip("data_root not found")
    work = tmp_path_factory.mktemp("facility-data")
    db_path = work / "facility_index.db"
    # Copy one dataset for fast isolated tests
    src_dirs = [
        p for p in DATA_ROOT.iterdir() if p.is_dir() and (p / "ro-crate-metadata.json").is_file()
    ]
    if not src_dirs:
        pytest.skip("no datasets in data_root")
    for src in src_dirs[:3]:
        shutil.copytree(src, work / src.name)
    index_data_root(work, db_path, force=True)
    app = create_app(data_root=work, db_path=db_path, use_tiled=False)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def sample_uuid(client: TestClient) -> str:
    resp = client.get("/api/v1/search")
    assert resp.status_code == 200
    results = resp.json()["results"]
    if not results:
        pytest.skip("no crate records indexed")
    return results[0]["experiment_id"]


def test_search_returns_all_records(client: TestClient) -> None:
    resp = client.get("/api/v1/search")
    assert resp.status_code == 200
    payload = resp.json()
    assert "results" in payload
    assert "count" in payload
    assert payload["count"] == len(payload["results"])
    assert payload["count"] > 0


def test_search_filter_instrument(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"instrument": "AMX"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] > 0
    for item in payload["results"]:
        assert "AMX" in item["instrument"]


def test_search_filter_facility(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"facility": "NSLS-II"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] > 0
    for item in payload["results"]:
        assert item["facility"] == "NSLS-II"


def test_search_filter_protein_name(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"protein_name": "EcCb"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] > 0


def test_search_filter_technique(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"technique": "MX"})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] > 0
    for item in payload["results"]:
        assert item["technique"] == "MX"


def test_search_invalid_technique(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"technique": "cryo-maybe"})
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 400
    assert "technique" in body["message"].lower()


def test_search_invalid_date(client: TestClient) -> None:
    resp = client.get(
        "/api/v1/search",
        params={"creation_date_start": "2025-03-15"},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 400


def test_search_seguid_rejected(client: TestClient) -> None:
    resp = client.get("/api/v1/search", params={"seguid": "abc123"})
    assert resp.status_code == 400
    body = resp.json()
    assert "SEGUID" in body["message"]


def test_search_empty_result(client: TestClient) -> None:
    resp = client.get(
        "/api/v1/search",
        params={"protein_name": "this-sample-definitely-does-not-exist-xyz"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["results"] == []
    assert payload["count"] == 0


def test_health(client: TestClient) -> None:
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] in {"healthy", "degraded"}
    assert body["facility"]
    assert body["api_version"] == "0.1.1"
    assert "database" in body["details"]


def test_rocrate_endpoint(client: TestClient, sample_uuid: str) -> None:
    resp = client.get(f"/api/v1/experiments/{sample_uuid}/rocrate")
    assert resp.status_code == 200
    body = resp.json()
    assert "@graph" in body or "@context" in body


def test_record_endpoint(client: TestClient, sample_uuid: str) -> None:
    resp = client.get(f"/api/v1/experiments/{sample_uuid}/record")
    assert resp.status_code == 200
    body = resp.json()
    assert body["dataset_uuid"] == sample_uuid


def test_sidecars_list_and_fetch(client: TestClient, sample_uuid: str) -> None:
    resp = client.get(f"/api/v1/experiments/{sample_uuid}/sidecars")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] > 0
    filename = body["sidecars"][0]["filename"]
    resp2 = client.get(
        f"/api/v1/experiments/{sample_uuid}/sidecars/{filename}"
    )
    assert resp2.status_code == 200
    assert isinstance(resp2.json(), dict)


def test_data_listing(tmp_path: Path) -> None:
    uuid = "550e8400-e29b-41d4-a716-446655440000"
    crate_dir = tmp_path / uuid
    data_dir = crate_dir / "data" / "images"
    data_dir.mkdir(parents=True)
    (data_dir / "frame_001.cbf").write_bytes(b"test")
    shutil.copy(
        DATA_ROOT / "1d290518-63c7-58dd-b816-648d915ab3f7" / "ro-crate-metadata.json",
        crate_dir / "ro-crate-metadata.json",
    )
    db_path = tmp_path / "facility_index.db"
    index_data_root(tmp_path, db_path, force=True)
    app = create_app(data_root=tmp_path, db_path=db_path, use_tiled=False)
    with TestClient(app) as client:
        resp = client.get(f"/api/v1/experiments/{uuid}/data")
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert body["files"][0]["path"] == "images/frame_001.cbf"
        resp2 = client.get(f"/api/v1/experiments/{uuid}/data/images/frame_001.cbf")
        assert resp2.status_code == 200


def test_invalid_uuid_rejected(client: TestClient) -> None:
    resp = client.get("/api/v1/experiments/../etc/rocrate")
    assert resp.status_code in {400, 404}


def test_parse_search_params_rejects_seguid() -> None:
    with pytest.raises(FacilitySearchError):
        parse_search_params({"seguid": "abc"})


def test_search_records_unit(tmp_path: Path) -> None:
    src_crate = DATA_ROOT / "1d290518-63c7-58dd-b816-648d915ab3f7"
    uuid = src_crate.name
    crate_dir = tmp_path / uuid
    crate_dir.mkdir()
    shutil.copy(src_crate / "ro-crate-metadata.json", crate_dir / "ro-crate-metadata.json")
    db_path = tmp_path / "facility_index.db"
    index_data_root(tmp_path, db_path, force=True)
    index = FacilityIndex(db_path)
    index.connect()
    params = parse_search_params({"technique": "MX", "instrument": "AMX"})
    payload = search_records(
        index,
        params,
        facility_endpoint="http://127.0.0.1:8000/api/v1",
    )
    assert payload["count"] == 1
    assert payload["results"][0]["experiment_id"] == uuid
    index.close()

"""FastAPI routes for the Project Book."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lambda_client_store.project_book import ProjectBook
from lambda_client_store.schema_resolve import ledger_class_names


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1)
    narrative: str = ""
    crate_membership: str = "exclusive"


class ProjectPatch(BaseModel):
    title: str | None = None
    narrative: str | None = None
    crate_membership: str | None = None


class LedgerCreate(BaseModel):
    class_name: str = Field(min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class LedgerPatch(BaseModel):
    payload: dict[str, Any] = Field(default_factory=dict)


class SubprojectCreate(BaseModel):
    title: str = Field(min_length=1)
    narrative: str = ""
    parent_id: str | None = None


class SubprojectPatch(BaseModel):
    title: str | None = None
    narrative: str | None = None
    parent_id: str | None = None
    sort_order: int | None = None


class IdList(BaseModel):
    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)


def _err(exc: Exception, not_found: bool = False) -> JSONResponse:
    if isinstance(exc, KeyError) or not_found:
        return JSONResponse({"error": "not found"}, status_code=404)
    if isinstance(exc, ValueError):
        return JSONResponse({"error": str(exc)}, status_code=400)
    raise exc


def mount_project_book(app: Any, *, db_path: Path, schemas_dir: Path) -> ProjectBook:
    book = ProjectBook(db_path, schemas_dir)
    app.state.project_book = book

    @app.get("/api/v1/project-book/schema")
    async def resolved_schema() -> JSONResponse:
        schema, dashboard = book.resolved_schema()
        return JSONResponse(
            {
                "schema": schema,
                "dashboard": dashboard,
                "ledger_classes": ledger_class_names(
                    schema,
                    base=str(dashboard.get("ledger_entry_base") or "LedgerEntry"),
                ),
            }
        )

    @app.get("/api/v1/project-book/placements")
    async def all_placements() -> JSONResponse:
        return JSONResponse({"placements": book.placements()})

    @app.get("/api/v1/project-book/placements/{crate_uuid}")
    async def one_placement(crate_uuid: str) -> JSONResponse:
        return JSONResponse({"placements": book.placements(crate_uuid)})

    @app.get("/api/v1/project-book/projects")
    async def list_projects() -> JSONResponse:
        return JSONResponse({"projects": book.list_projects()})

    @app.post("/api/v1/project-book/projects")
    async def create_project(body: ProjectCreate) -> JSONResponse:
        try:
            rec = book.create_project(
                title=body.title,
                narrative=body.narrative,
                crate_membership=body.crate_membership,
            )
        except ValueError as exc:
            return _err(exc)
        return JSONResponse(rec, status_code=201)

    @app.get("/api/v1/project-book/projects/{project_id}")
    async def get_project(project_id: str) -> JSONResponse:
        rec = book.get_project(project_id)
        if rec is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(rec)

    @app.patch("/api/v1/project-book/projects/{project_id}")
    async def patch_project(project_id: str, body: ProjectPatch) -> JSONResponse:
        fields = body.model_dump(exclude_none=True)
        try:
            rec = book.patch_project(project_id, fields)
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec)

    @app.delete("/api/v1/project-book/projects/{project_id}")
    async def delete_project(project_id: str) -> JSONResponse:
        try:
            book.delete_project(project_id)
        except KeyError:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse({"ok": True})

    @app.post("/api/v1/project-book/projects/{project_id}/ledger")
    async def add_ledger(project_id: str, body: LedgerCreate) -> JSONResponse:
        try:
            rec = book.add_ledger_entry(
                project_id, class_name=body.class_name, payload=body.payload
            )
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec, status_code=201)

    @app.patch("/api/v1/project-book/ledger/{entry_id}")
    async def patch_ledger(entry_id: str, body: LedgerPatch) -> JSONResponse:
        try:
            rec = book.patch_ledger_entry(entry_id, body.payload)
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec)

    @app.delete("/api/v1/project-book/ledger/{entry_id}")
    async def delete_ledger(entry_id: str) -> JSONResponse:
        try:
            book.delete_ledger_entry(entry_id)
        except KeyError:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse({"ok": True})

    @app.post("/api/v1/project-book/projects/{project_id}/subprojects")
    async def add_subproject(project_id: str, body: SubprojectCreate) -> JSONResponse:
        try:
            rec = book.add_subproject(
                project_id,
                title=body.title,
                narrative=body.narrative,
                parent_id=body.parent_id,
            )
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec, status_code=201)

    @app.get("/api/v1/project-book/subprojects/{subproject_id}")
    async def get_subproject(subproject_id: str) -> JSONResponse:
        rec = book.get_subproject(subproject_id)
        if rec is None:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse(rec)

    @app.patch("/api/v1/project-book/subprojects/{subproject_id}")
    async def patch_subproject(
        subproject_id: str, body: SubprojectPatch
    ) -> JSONResponse:
        fields = body.model_dump(exclude_unset=True)
        try:
            rec = book.patch_subproject(subproject_id, fields)
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec)

    @app.delete("/api/v1/project-book/subprojects/{subproject_id}")
    async def delete_subproject(subproject_id: str) -> JSONResponse:
        try:
            book.delete_subproject(subproject_id)
        except KeyError:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse({"ok": True})

    @app.put("/api/v1/project-book/subprojects/{subproject_id}/crates")
    async def set_crates(subproject_id: str, body: IdList) -> JSONResponse:
        try:
            rec = book.set_subproject_crates(
                subproject_id, add=body.add, remove=body.remove
            )
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec)

    @app.put("/api/v1/project-book/subprojects/{subproject_id}/ledger")
    async def set_assigned_ledger(subproject_id: str, body: IdList) -> JSONResponse:
        try:
            rec = book.set_subproject_ledger(
                subproject_id, add=body.add, remove=body.remove
            )
        except (KeyError, ValueError) as exc:
            return _err(exc, not_found=isinstance(exc, KeyError))
        return JSONResponse(rec)

    return book

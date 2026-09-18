"""PDB lattice search HTTP server with a DuckDB access lock.

agentsg.cell.pdb_server uses ThreadingHTTPServer against a shared DuckDB
connection and cKDTree. Concurrent POST /search hits have segfaulted
duckdb*.so (GPF). Health stays concurrent; only search_compatible is serialized.
"""
from __future__ import annotations

from threading import Lock

from agentsg.cell import pdb_server

_search_lock = Lock()
_orig_search = pdb_server.search_compatible


def _locked_search(*args, **kwargs):
    with _search_lock:
        return _orig_search(*args, **kwargs)


pdb_server.search_compatible = _locked_search


if __name__ == "__main__":
    raise SystemExit(pdb_server._cli())

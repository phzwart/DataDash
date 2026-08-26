"""Rewrite placeholder schema URIs to a locally hosted schema URL."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

DEFAULT_OLD_URI = "https://example.org/lambda-mx/schemas/lambda_mx_series.yaml"
DEFAULT_NEW_URI = "http://127.0.0.1:8000/schemas/lambda_mx_series.yaml"
DEFAULT_DATA_ROOT = Path(__file__).resolve().parents[2] / "data_root"

TARGET_GLOBS = (
    "schemas/lambda_mx_series.yaml",
    "schemas/lambda_mx_dashboard.yaml",
    "schemas/lambda_mx_collection.yaml",
    "*/lambda_mx_record.json",
    "*/ro-crate-metadata.json",
)


def iter_target_files(data_root: Path) -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for pattern in TARGET_GLOBS:
        for path in sorted(data_root.glob(pattern)):
            if path.is_file() and path not in seen:
                seen.add(path)
                files.append(path)
    return files


def rewrite_file(
    path: Path, old_uri: str, new_uri: str, *, apply: bool
) -> int:
    text = path.read_text(encoding="utf-8")
    count = text.count(old_uri)
    if count == 0:
        return 0
    if apply:
        path.write_text(text.replace(old_uri, new_uri), encoding="utf-8")
    return count


def rewrite(
    data_root: Path,
    *,
    old_uri: str = DEFAULT_OLD_URI,
    new_uri: str = DEFAULT_NEW_URI,
    apply: bool = False,
) -> dict[str, int]:
    data_root = data_root.resolve()
    if not data_root.is_dir():
        raise NotADirectoryError(data_root)

    files_changed = 0
    occurrences = 0
    for path in iter_target_files(data_root):
        n = rewrite_file(path, old_uri, new_uri, apply=apply)
        if n:
            files_changed += 1
            occurrences += n
            rel = path.relative_to(data_root)
            action = "updated" if apply else "would update"
            print(f"{action}: {rel} ({n})")

    return {
        "files_changed": files_changed,
        "occurrences": occurrences,
        "applied": int(apply),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Rewrite Lambda MX schema URIs from example.org to a local URL. "
            "Dry-run by default; pass --apply to write."
        )
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help=f"Collection root (default: {DEFAULT_DATA_ROOT})",
    )
    parser.add_argument("--old-uri", default=DEFAULT_OLD_URI)
    parser.add_argument("--new-uri", default=DEFAULT_NEW_URI)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes (default is dry-run)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.old_uri == args.new_uri:
        print("old and new URI are identical; nothing to do", file=sys.stderr)
        return 1
    summary = rewrite(
        args.data_root,
        old_uri=args.old_uri,
        new_uri=args.new_uri,
        apply=args.apply,
    )
    mode = "applied" if args.apply else "dry-run"
    print(
        f"{mode}: files={summary['files_changed']} "
        f"occurrences={summary['occurrences']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Export the FastAPI OpenAPI schema as the single source of truth for contracts.

The generated ``openapi.json`` is the canonical contract between the backend,
the Electron renderer, and any external consumer. Keep it in sync after any
route-model change by re-running this script (also enforced by CI).

Usage:
    python scripts/export_openapi.py [--out path/to/openapi.json]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def export(out_path: Path) -> Path:
    """Write the live OpenAPI schema to ``out_path`` and return it."""
    # Import triggers app construction (config read, CORS wiring).
    from mathweaver.api.app import app

    schema = app.openapi()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(schema, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    return out_path


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "openapi.json",
        help="Destination path for the exported OpenAPI schema.",
    )
    args = parser.parse_args()
    path = export(args.out)
    print(f"OpenAPI schema exported to {path}")


if __name__ == "__main__":
    main()

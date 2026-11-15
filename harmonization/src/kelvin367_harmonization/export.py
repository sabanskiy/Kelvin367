"""Export both daily harmonization policies and reproducibility metadata."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import numpy as np
import pyarrow

from .policies import Availability, harmonize_daily

DEFAULT_AVAILABILITY = {
    "MODIS": Availability(date(2000, 11, 1)),
    "SNPP": Availability(
        date(2012, 1, 20),
        date(2026, 11, 2),
        gaps=(
            (date(2022, 7, 27), date(2022, 8, 10)),
            (date(2024, 5, 30), date(2024, 6, 3)),
            (date(2024, 7, 10), date(2024, 7, 15)),
            (date(2024, 7, 25), date(2024, 7, 28)),
            (date(2024, 11, 3), date(2024, 11, 5)),
            (date(2026, 3, 10), date(2026, 3, 12)),
            (date(2026, 4, 28), date(2026, 6, 2)),
            (date(2026, 7, 11), date(2026, 7, 15)),
        ),
    ),
    "NOAA20": Availability(
        date(2018, 4, 1),
        gaps=(
            (date(2023, 7, 19), date(2023, 7, 22)),
            (date(2024, 2, 4), date(2024, 2, 5)),
        ),
    ),
}
DEFAULT_WEIGHTS = {"SNPP": 0.5760572840570874, "NOAA20": 0.42394271594291244}
WEIGHT_PROVENANCE = {
    "method": "train-only inverse-variance weights from SNPP-to-MODIS and SNPP-to-NOAA20 links",
    "train_end": "2020-12-31",
    "source": "spacechallenge alex_daily_metadata.json",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _commit() -> str:
    repository = Path(__file__).resolve().parents[3]
    if not (repository / "harmonization" / "pyproject.toml").is_file():
        return "unknown"
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repository,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _availability_metadata() -> dict:
    return {
        group: {
            "start": spec.start.isoformat(),
            "end": spec.end.isoformat() if spec.end else None,
            "gaps": [[start.isoformat(), end.isoformat()] for start, end in spec.gaps],
        }
        for group, spec in DEFAULT_AVAILABILITY.items()
    }


def export_harmonized(source: Path, output: Path, metadata_path: Path) -> dict:
    frame = pd.read_parquet(source) if source.suffix.lower() == ".parquet" else pd.read_csv(source)
    result = harmonize_daily(frame, DEFAULT_AVAILABILITY, DEFAULT_WEIGHTS)
    output.parent.mkdir(parents=True, exist_ok=True)
    result.to_parquet(output, index=False, compression="zstd")
    metadata = {
        "dataset_version": 1,
        "canonical_harmonization": "viirs_first_count_1d",
        "available_policies": ["equal_mix_count_1d", "viirs_first_count_1d"],
        "input_contract": "daily calibrated MODIS-equivalent group counts",
        "viirs_weights": DEFAULT_WEIGHTS,
        "weight_provenance": WEIGHT_PROVENANCE,
        "availability": _availability_metadata(),
        "availability_audit": {
            "verified_on": "2026-10-05",
            "scope": "S-NPP/NOAA-20 overlap from 2018-04-01; MODIS and earlier years were not audited",
            "method": "satellite-wide zero-day witness analysis",
        },
        "generator": {
            "package": "kelvin367-harmonization",
            "version": importlib.metadata.version("kelvin367-harmonization"),
            "commit": _commit(),
        },
        "versions": {"python": __import__("platform").python_version(), "numpy": np.__version__, "pandas": pd.__version__, "pyarrow": pyarrow.__version__},
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"path": source.name, "sha256": sha256(source)},
        "output": {"path": output.name, "rows": len(result), "sha256": sha256(output)},
    }
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="CSV or Parquet with calibrated MODIS/SNPP/NOAA20 daily groups")
    parser.add_argument("output", type=Path, help="Output Parquet")
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    export_harmonized(args.source, args.output, args.metadata)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

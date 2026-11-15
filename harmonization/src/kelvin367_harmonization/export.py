"""Export both daily harmonization policies and reproducibility metadata."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from .policies import Availability, harmonize_daily

DEFAULT_AVAILABILITY = {
    "MODIS": Availability(date(2003, 1, 1)),
    "SNPP": Availability(date(2012, 1, 20), date(2026, 11, 2)),
    "NOAA20": Availability(date(2018, 4, 1)),
}
DEFAULT_WEIGHTS = {"SNPP": 0.576, "NOAA20": 0.424}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


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
        "built_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": {"path": str(source), "sha256": sha256(source)},
        "output": {"path": str(output), "rows": len(result), "sha256": sha256(output)},
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

"""Download GFED5 monthly burned area (Chen et al. 2023, Zenodo record 7668424, CC BY 4.0) for the second reference of the 2012 test.

Files (sizes and MD5 from the Zenodo record):
  BA.zip       264,817,204 bytes   monthly files BAYYYYMM.nc, 1997-2020 (0.25 degree from 2001), layers Total / Crop / Norm / Defo / Peat in km2
  readme.html       13,696 bytes   description of the files

Only the members named BAYYYYMM.nc are extracted (the archive also holds a helper script that is neither needed nor run). No account is needed.
Nothing is downloaded without --download.

    python scripts/download_gfed5.py            # shows what would be downloaded
    python scripts/download_gfed5.py --download # data/raw/gfed5/BA.zip, readme.html, extracted to data/raw/gfed5/BA/
"""
from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "data" / "raw" / "gfed5"
RECORD = "7668424"
FILES = {"BA.zip": (264817204, "2fe4a5ced7e19823f78eafb73616d9f1"), "readme.html": (13696, "5adb9f7d2d9635b51c0650565b3f2adb")}
MEMBER = re.compile(r"^BA\d{6}\.nc$")


def url(name: str) -> str:
    return f"https://zenodo.org/api/records/{RECORD}/files/{name}/content"


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def wanted_members(names: list[str]) -> list[str]:
    """Archive members to extract: plain BAYYYYMM.nc files at the top level of the archive."""
    return [n for n in names if MEMBER.match(n)]


def fetch(name: str, dest: Path = DEST) -> Path:
    size, want = FILES[name]
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / name
    if path.exists() and path.stat().st_size == size and md5(path) == want:
        return path
    with urllib.request.urlopen(url(name), timeout=120) as r, open(path, "wb") as f:
        shutil.copyfileobj(r, f)
    if path.stat().st_size != size or md5(path) != want:
        path.unlink()
        raise ValueError(f"{name}: size or MD5 differs from the Zenodo record")
    return path


def extract(zip_path: Path, out: Path) -> int:
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(zip_path) as z:
        for m in wanted_members(z.namelist()):
            with z.open(m) as src, open(out / m, "wb") as dst:
                shutil.copyfileobj(src, dst)
            n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true")
    a = ap.parse_args()
    total = sum(s for s, _ in FILES.values())
    print(f"Zenodo record {RECORD} (DOI 10.5281/zenodo.{RECORD}, CC BY 4.0): {', '.join(FILES)}; {total / 1e6:.1f} MB; target {DEST}")
    if not a.download:
        print("nothing downloaded (pass --download)")
        return 0
    for name in FILES:
        print(f"  {name}: {fetch(name)}")
    print(f"  extracted {extract(DEST / 'BA.zip', DEST / 'BA')} monthly files to {DEST / 'BA'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

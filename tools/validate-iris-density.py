#!/usr/bin/env python3
"""Validate the generated, department-split IRIS population dataset.

Run from any directory:
    python tools/validate-iris-density.py
The check uses only Python's standard library and does not need source downloads.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEX = ROOT / "assets" / "population-iris-index.json"


def fail(message: str) -> None:
    raise SystemExit(f"ERREUR : {message}")


def valid_bbox(value: Any) -> bool:
    return (
        isinstance(value, list)
        and len(value) == 4
        and all(isinstance(item, (int, float)) and math.isfinite(item) for item in value)
        and value[0] <= value[2]
        and value[1] <= value[3]
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=DEFAULT_INDEX, help="Path to population-iris-index.json")
    args = parser.parse_args()

    try:
        index = json.loads(args.index.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"index illisible ({error})")

    departments = index.get("departments")
    if not isinstance(departments, list) or not departments:
        fail("l'index ne contient aucun département")

    total_features = 0
    matched_population = 0
    total_compressed_bytes = 0
    seen_codes: set[str] = set()
    seen_departments: set[str] = set()
    problems: list[str] = []

    for entry in departments:
        department = str(entry.get("department", ""))
        if department in seen_departments:
            problems.append(f"index: département dupliqué ({department})")
        seen_departments.add(department)
        if not valid_bbox(entry.get("bbox")):
            problems.append(f"{department or '?'}: bbox départementale absente ou invalide")
        relative_path = entry.get("url")
        if not department or not isinstance(relative_path, str):
            problems.append("entrée de département invalide")
            continue

        path = args.index.parent.parent / relative_path
        try:
            compressed_size = path.stat().st_size
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                collection = json.load(stream)
        except (OSError, EOFError, gzip.BadGzipFile, json.JSONDecodeError) as error:
            problems.append(f"{department}: fichier absent ou illisible ({error})")
            continue

        total_compressed_bytes += compressed_size
        if compressed_size != entry.get("bytesCompressed"):
            problems.append(
                f"{department}: taille compressée {compressed_size}, "
                f"index {entry.get('bytesCompressed')}"
            )
        if collection.get("type") != "FeatureCollection":
            problems.append(f"{department}: type GeoJSON différent de FeatureCollection")

        features = collection.get("features")
        if not isinstance(features, list):
            problems.append(f"{department}: liste features absente")
            continue
        if len(features) != entry.get("features"):
            problems.append(
                f"{department}: {len(features)} zones dans le fichier, "
                f"{entry.get('features')} dans l'index"
            )

        total_features += len(features)
        for position, feature in enumerate(features):
            props = feature.get("properties") or {}
            code = str(props.get("code") or feature.get("id") or "")
            label = f"{department}[{position}]"
            if not code:
                problems.append(f"{label}: code IRIS absent")
            elif code in seen_codes:
                problems.append(f"{label}: code IRIS dupliqué ({code})")
            else:
                seen_codes.add(code)

            if not valid_bbox(feature.get("bbox")):
                problems.append(f"{label}: bbox absente ou invalide")
            if not isinstance(feature.get("geometry"), dict):
                problems.append(f"{label}: géométrie absente")
            population = props.get("population")
            density = props.get("density")
            if population is not None:
                if (
                    isinstance(population, bool)
                    or not isinstance(population, (int, float))
                    or not math.isfinite(population)
                    or population < 0
                ):
                    problems.append(f"{label}: population invalide")
                else:
                    matched_population += 1
            if density is not None and (
                isinstance(density, bool)
                or not isinstance(density, (int, float))
                or not math.isfinite(density)
                or density < 0
            ):
                problems.append(f"{label}: densité invalide")
            if population is None and density is not None:
                problems.append(f"{label}: densité renseignée sans population")

    if total_compressed_bytes != index.get("bytesCompressed"):
        problems.append(
            f"total: {total_compressed_bytes} octets compressés, "
            f"index {index.get('bytesCompressed')}"
        )

    expected_features = index.get("features")
    expected_matched = index.get("matchedPopulation")
    if total_features != expected_features:
        problems.append(f"total: {total_features} zones, index {expected_features}")
    if matched_population != expected_matched:
        problems.append(
            f"population: {matched_population} valeurs, index {expected_matched}"
        )

    if problems:
        for problem in problems[:50]:
            print(f"- {problem}")
        if len(problems) > 50:
            print(f"- ... et {len(problems) - 50} autre(s) erreur(s)")
        fail(f"{len(problems)} contrôle(s) en échec")

    print(
        "OK : "
        f"{total_features} zones IRIS, "
        f"{matched_population} populations associées, "
        f"{len(departments)} départements, "
        "fichiers gzip/GeoJSON, tailles, bbox et codes vérifiés."
    )


if __name__ == "__main__":
    main()

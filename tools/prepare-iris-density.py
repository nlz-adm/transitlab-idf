#!/usr/bin/env python3
"""Build compact, department-scoped IRIS population density data for TransitLab IDF.

Inputs: IGN/INSEE Contours...IRIS 2024 GeoJSON export and the INSEE RP 2022
infracommunal CSV ZIP. Statistics are joined using the official 9-digit IRIS
code. GeoJSON is simplified by a few metres and split by department for lazy
loading in the browser.
"""

from __future__ import annotations

import argparse
import collections
import csv
import gzip
import io
import json
import math
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets" / "population-iris"
REGION_CODES = {"75", "77", "78", "91", "92", "93", "94", "95"}
EARTH_RADIUS_M = 6_371_008.8
SIMPLIFY_TOLERANCE = 0.000035


def perpendicular_distance(point: list[float], start: list[float], end: list[float]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(dx, dy)


def simplify_ring(closed: list[list[float]]) -> list[list[float]]:
    if len(closed) <= 5:
        return closed
    points = closed[:-1]
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        maximum, selected = 0.0, -1
        for index in range(first + 1, last):
            distance = perpendicular_distance(points[index], points[first], points[last])
            if distance > maximum:
                maximum, selected = distance, index
        if selected >= 0 and maximum > SIMPLIFY_TOLERANCE:
            keep.add(selected)
            stack.append((first, selected))
            stack.append((selected, last))
    result = [points[index] for index in sorted(keep)]
    if len(result) < 4:
        result = points[:4]
    result.append(result[0])
    return result


def ring_area_m2(ring: list[list[float]]) -> float:
    total = 0.0
    for first, second in zip(ring, ring[1:]):
        lon1, lat1 = map(math.radians, first[:2])
        lon2, lat2 = map(math.radians, second[:2])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total) * EARTH_RADIUS_M * EARTH_RADIUS_M / 2


def polygon_area_m2(rings: list[list[list[float]]]) -> float:
    return max(0.0, ring_area_m2(rings[0]) - sum(ring_area_m2(ring) for ring in rings[1:]))


def geometry_area_m2(geometry: dict[str, Any]) -> float:
    coordinates = geometry["coordinates"]
    polygons = [coordinates] if geometry["type"] == "Polygon" else coordinates
    return sum(polygon_area_m2(polygon) for polygon in polygons)


def simplify_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(ring) for ring in coordinates]}
    return {"type": "MultiPolygon", "coordinates": [[simplify_ring(ring) for ring in polygon] for polygon in coordinates]}


def geometry_bbox(geometry: dict[str, Any]) -> list[float]:
    coordinates = geometry["coordinates"]
    polygons = [coordinates] if geometry["type"] == "Polygon" else coordinates
    points = [point for polygon in polygons for ring in polygon for point in ring]
    return [min(point[0] for point in points), min(point[1] for point in points), max(point[0] for point in points), max(point[1] for point in points)]


def load_population(path: Path) -> dict[str, int]:
    with zipfile.ZipFile(path) as archive:
        csv_name = next(name for name in archive.namelist() if name.lower().endswith(".csv") and "meta" not in name.lower())
        with archive.open(csv_name) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            reader = csv.DictReader(text, delimiter=";")
            values = {}
            for row in reader:
                code = (row.get("IRIS") or "").strip()
                if len(code) == 9 and code[:2] in REGION_CODES:
                    raw_value = (row.get("P22_POP") or "").strip()
                    if raw_value:
                        values[code] = int(float(raw_value.replace(",", ".")))
            return values


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--geojson", type=Path, required=True, help="IGN/INSEE Contours IRIS 2024 GeoJSON")
    parser.add_argument("--population", type=Path, required=True, help="INSEE Population 2022 infracommunal CSV ZIP")
    args = parser.parse_args()
    population = load_population(args.population)
    by_department: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    matched = 0
    source = json.loads(args.geojson.read_text(encoding="utf-8"))
    for feature in source.get("features", []):
        props = feature.get("properties") or {}
        department = str(props.get("dep") or "")
        if department not in REGION_CODES:
            continue
        code = str(props.get("code_iris") or "")
        population_value = population.get(code)
        if population_value is not None:
            matched += 1
        area_km2 = geometry_area_m2(feature["geometry"]) / 1_000_000
        density = round(population_value / area_km2) if population_value is not None and area_km2 > 0 else None
        name = str(props.get("nom_iris") or props.get("nom_com") or "IRIS")
        geometry = simplify_geometry(feature["geometry"])
        by_department[department].append({
            "type": "Feature",
            "id": code,
            "bbox": [round(value, 6) for value in geometry_bbox(geometry)],
            "properties": {
                "code": code,
                "communeCode": str(props.get("insee_com") or ""),
                "commune": str(props.get("nom_com") or ""),
                "name": name,
                "irisType": str(props.get("typ_iris") or ""),
                "population": population_value,
                "areaKm2": round(area_km2, 4),
                "density": density,
                "source": "INSEE · Recensement de la population 2022",
            },
            "geometry": geometry,
        })

    OUTPUT.mkdir(parents=True, exist_ok=True)
    chunks = []
    total_bytes = 0
    for department in sorted(by_department):
        features = sorted(by_department[department], key=lambda item: item["id"])
        bounds = [math.inf, math.inf, -math.inf, -math.inf]
        for feature in features:
            coords = feature["geometry"]["coordinates"]
            polygons = [coords] if feature["geometry"]["type"] == "Polygon" else coords
            for polygon in polygons:
                for ring in polygon:
                    for lon, lat, *_ in ring:
                        bounds[0] = min(bounds[0], lon)
                        bounds[1] = min(bounds[1], lat)
                        bounds[2] = max(bounds[2], lon)
                        bounds[3] = max(bounds[3], lat)
        path = OUTPUT / f"{department}.geojson.gz"
        encoded = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with path.open("wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as compressed:
                compressed.write(encoded)
        size = path.stat().st_size
        total_bytes += size
        chunks.append({"department": department, "url": f"assets/population-iris/{department}.geojson.gz", "bbox": [round(value, 6) for value in bounds], "features": len(features), "bytesCompressed": size})

    index = {
        "version": "idf-iris-rp2022-2024-20261026",
        "generatedAt": "2026-10-26",
        "features": sum(len(features) for features in by_department.values()),
        "matchedPopulation": matched,
        "departments": chunks,
        "bytesCompressed": total_bytes,
        "sources": {
            "geometry": "IGN & INSEE · Contours...IRIS édition 2024, portail Open Data Île-de-France",
            "population": "INSEE · Recensement de la population 2022 · base infracommunale · géographie au 1er janvier 2024",
            "area": "Surface géodésique calculée depuis les polygones IRIS",
        },
        "limitation": "Les IRIS sont des quartiers statistiques, pas toujours des quartiers vécus. Les IRIS de type Z correspondent à des communes non découpées; leurs polygones sont donc des limites communales. Les zones d’activité et zones diverses peuvent être peu peuplées.",
        "license": "Licence Ouverte / Open Licence 2.0",
    }
    (ROOT / "assets" / "population-iris-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"features": index["features"], "matchedPopulation": matched, "departments": len(chunks), "compressedBytes": total_bytes}))


if __name__ == "__main__":
    main()

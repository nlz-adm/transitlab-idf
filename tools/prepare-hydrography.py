#!/usr/bin/env python3
"""Create a compact IDF hydrography layer from an Overpass JSON extract.

The extract should cover 47.9,1.3,49.4,3.75 and include river/canal ways plus
natural=water, landuse=reservoir and waterway=riverbank ways/relations.
The resulting GeoJSON is simplified and gzip-compressed for lazy browser load.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EARTH_RADIUS_M = 6_371_008.8
LINE_TOLERANCE = 0.0001
RING_TOLERANCE = 0.00008
MIN_WATER_AREA_KM2 = 0.02


def distance(point: list[float], start: list[float], end: list[float]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(dx, dy)


def simplify(points: list[list[float]], tolerance: float, closed: bool = False) -> list[list[float]]:
    if len(points) <= (5 if closed else 4):
        return points
    source = points[:-1] if closed and points[0] == points[-1] else points
    keep = {0, len(source) - 1}
    stack = [(0, len(source) - 1)]
    while stack:
        first, last = stack.pop()
        maximum, selected = 0.0, -1
        for index in range(first + 1, last):
            value = distance(source[index], source[first], source[last])
            if value > maximum:
                maximum, selected = value, index
        if selected >= 0 and maximum > tolerance:
            keep.add(selected)
            stack.extend(((first, selected), (selected, last)))
    result = [source[index] for index in sorted(keep)]
    if closed:
        if len(result) < 4:
            result = source[:4]
        result.append(result[0])
    return result


def area_km2(ring: list[list[float]]) -> float:
    total = 0.0
    for first, second in zip(ring, ring[1:]):
        lon1, lat1 = map(math.radians, first[:2])
        lon2, lat2 = map(math.radians, second[:2])
        total += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
    return abs(total) * EARTH_RADIUS_M**2 / 2 / 1_000_000


def point_in_ring(point: list[float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    for first, second in zip(ring, ring[1:]):
        x1, y1 = first[:2]
        x2, y2 = second[:2]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def bounds_of(geometry: dict[str, Any]) -> list[float]:
    kind, coords = geometry["type"], geometry["coordinates"]
    if kind == "LineString":
        points = coords
    else:
        polygons = [coords] if kind == "Polygon" else coords
        points = [point for polygon in polygons for ring in polygon for point in ring]
    return [round(min(p[0] for p in points), 6), round(min(p[1] for p in points), 6), round(max(p[0] for p in points), 6), round(max(p[1] for p in points), 6)]


def way_polygon(element: dict[str, Any]) -> list[list[list[float]]] | None:
    points = [[point["lon"], point["lat"]] for point in element.get("geometry", [])]
    if len(points) < 4:
        return None
    if points[0] != points[-1]:
        points.append(points[0])
    if area_km2(points) < MIN_WATER_AREA_KM2:
        return None
    return [simplify(points, RING_TOLERANCE, closed=True)]


def stitch_rings(members: list[dict[str, Any]], role: str) -> list[list[list[float]]]:
    segments = []
    for member in members:
        if member.get("type") != "way" or member.get("role", "outer") != role:
            continue
        points = [[p["lon"], p["lat"]] for p in member.get("geometry", [])]
        if len(points) >= 2:
            segments.append(points)
    rings = []
    while segments:
        ring = segments.pop()
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for index, segment in enumerate(segments):
                if ring[-1] == segment[0]:
                    ring.extend(segment[1:])
                elif ring[-1] == segment[-1]:
                    ring.extend(reversed(segment[:-1]))
                elif ring[0] == segment[-1]:
                    ring = segment[:-1] + ring
                elif ring[0] == segment[0]:
                    ring = list(reversed(segment[1:])) + ring
                else:
                    continue
                segments.pop(index)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(simplify(ring, RING_TOLERANCE, closed=True))
    return rings


def build() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("overpass_json", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "assets" / "hydrography.geojson.gz")
    args = parser.parse_args()
    source = json.loads(args.overpass_json.read_text(encoding="utf-8"))
    elements = source.get("elements", [])
    relations = [e for e in elements if e.get("type") == "relation" and e.get("tags", {}).get("type") == "multipolygon"]
    relation_member_ids = {m.get("ref") for rel in relations for m in rel.get("members", []) if m.get("type") == "way"}
    features = []
    water_counts = {"riversAndCanals": 0, "waterBodies": 0, "relations": 0}

    for element in elements:
        if element.get("type") != "way":
            continue
        tags = element.get("tags", {})
        waterway = tags.get("waterway")
        if waterway not in ("river", "canal"):
            continue
        points = [[p["lon"], p["lat"]] for p in element.get("geometry", [])]
        points = simplify(points, LINE_TOLERANCE)
        if len(points) < 2:
            continue
        geometry = {"type": "LineString", "coordinates": [[round(x, 5), round(y, 5)] for x, y in points]}
        water_counts["riversAndCanals"] += 1
        features.append({"type": "Feature", "id": f"way/{element['id']}", "bbox": bounds_of(geometry), "properties": {"name": tags.get("name", ""), "waterType": "Canal" if waterway == "canal" else "Cours d’eau", "waterway": waterway}, "geometry": geometry})

    for element in elements:
        tags = element.get("tags", {})
        if element.get("type") == "way":
            is_water = tags.get("natural") == "water" or tags.get("landuse") == "reservoir" or tags.get("waterway") == "riverbank"
            if not is_water or element["id"] in relation_member_ids:
                continue
            rings = way_polygon(element)
            if not rings:
                continue
            geometry = {"type": "Polygon", "coordinates": [[[round(x, 5), round(y, 5)] for x, y in rings[0]] ]}
            water_counts["waterBodies"] += 1
            features.append({"type": "Feature", "id": f"way/{element['id']}", "bbox": bounds_of(geometry), "properties": {"name": tags.get("name", ""), "waterType": "Plan d’eau", "waterway": ""}, "geometry": geometry})
        elif element.get("type") == "relation" and tags.get("type") == "multipolygon":
            is_water = tags.get("natural") == "water" or tags.get("landuse") == "reservoir" or tags.get("waterway") == "riverbank"
            if not is_water:
                continue
            outers = stitch_rings(element.get("members", []), "outer")
            if not outers:
                continue
            inners = stitch_rings(element.get("members", []), "inner")
            polygons = []
            for outer in outers:
                if area_km2(outer) < MIN_WATER_AREA_KM2:
                    continue
                polygon = [outer]
                polygon.extend(inner for inner in inners if point_in_ring(inner[0], outer))
                polygons.append([[[round(x, 5), round(y, 5)] for x, y in ring] for ring in polygon])
            if not polygons:
                continue
            geometry = {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {"type": "MultiPolygon", "coordinates": polygons}
            water_counts["waterBodies"] += 1
            water_counts["relations"] += 1
            features.append({"type": "Feature", "id": f"relation/{element['id']}", "bbox": bounds_of(geometry), "properties": {"name": tags.get("name", ""), "waterType": "Plan d’eau", "waterway": ""}, "geometry": geometry})

    data = {"type": "FeatureCollection", "features": features, "source": f"OpenStreetMap contributors · base au {source.get('osm3s', {}).get('timestamp_osm_base', '2026-10-26')}", "license": "Open Database License (ODbL)"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with args.output.open("wb") as raw:
        with gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as compressed:
            compressed.write(encoded)
    print(json.dumps({"features": len(features), **water_counts, "rawBytes": len(encoded), "compressedBytes": args.output.stat().st_size}, ensure_ascii=False))


if __name__ == "__main__":
    build()

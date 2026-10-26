#!/usr/bin/env python3
"""Normalize Île-de-France Mobilités' official rail-line GeoJSON for TransitLab.

Source: https://data.iledefrance-mobilites.fr/explore/dataset/traces-du-reseau-ferre-idf/
Licence: Licence Ouverte v2.0 (Etalab)
"""
import json
import sys
from pathlib import Path

SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "rail-source.geojson")
DEST = Path(sys.argv[2] if len(sys.argv) > 2 else "assets/official-rail-traces.json")

def pick(properties, *keys):
    for key in keys:
        value = properties.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""

def mode_for(line, raw=""):
    value = (raw + " " + line).upper()
    if "METRO" in value or line.startswith("M") and line[1:].isdigit():
        return "Metro"
    if "RER" in value:
        return "RER"
    if "TRAM" in value or line.startswith("T") and line[1:].isdigit():
        return "Tramway"
    if "CABLE" in value or line.startswith("C"):
        return "Tramway"
    return "Transilien"

def normalize_line(value):
    value = " ".join(value.upper().replace("-", " ").split())
    value = value.replace("TRAMWAY T", "TRAM ").replace("TRAM T", "TRAM ").replace("METRO M", "METRO ")
    # Align official labels with the stable labels already used by the app.
    replacements = {
        "METRO M1": "METRO 1", "METRO M2": "METRO 2", "METRO M3": "METRO 3",
        "METRO M4": "METRO 4", "METRO M5": "METRO 5", "METRO M6": "METRO 6",
        "METRO M7": "METRO 7", "METRO M8": "METRO 8", "METRO M9": "METRO 9",
        "METRO M10": "METRO 10", "METRO M11": "METRO 11", "METRO M12": "METRO 12",
        "METRO M13": "METRO 13", "METRO M14": "METRO 14",
    }
    if value.startswith("M") and value[1:].isdigit():
        value = "METRO " + value[1:]
    elif value.startswith("T") and value[1:].isdigit():
        value = "TRAM " + value[1:]
    return replacements.get(value, value)

def main():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    features = source.get("features", [])
    normalized = []
    for feature in features:
        props = feature.get("properties") or {}
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") not in ("LineString", "MultiLineString"):
            continue
        coords = geometry.get("coordinates")
        if not coords:
            continue
        raw_line = pick(props, "nomlong", "nom_long", "route_long_name", "route_short_name", "line", "libelle", "nom",
                        "idrefligc", "IDREFLIGC", "id_ref_lig_c", "id_ilico")
        if not raw_line:
            continue
        line = normalize_line(raw_line)
        color = pick(props, "couleur", "color", "route_color", "code_couleur").lstrip("#")
        if not color or len(color) != 6:
            color = "65758b"
        raw_mode = pick(props, "mode", "mode_transport", "type", "transport_mode")
        normalized.append({
            "type": "Feature",
            "properties": {
                "line": line,
                "mode": mode_for(line, raw_mode),
                "color": color.lower(),
                "source": "Île-de-France Mobilités",
                "sourceId": pick(props, "idrefligc", "IDREFLIGC", "id_ilico", "objectid", "id"),
            },
            "geometry": geometry,
        })
    lines = {f["properties"]["line"] for f in normalized}
    if len(normalized) < 500 or len(lines) < 20:
        raise SystemExit(f"Refusing incomplete official export: {len(normalized)} segments / {len(lines)} lines")
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps({
        "type": "FeatureCollection",
        "source": "Île-de-France Mobilités — Tracés du réseau de transport ferré d'Île-de-France",
        "sourceUrl": "https://data.iledefrance-mobilites.fr/explore/dataset/traces-du-reseau-ferre-idf/",
        "licence": "Licence Ouverte v2.0 (Etalab)",
        "features": normalized,
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Normalized {len(normalized)} official segments across {len(lines)} line labels")

if __name__ == "__main__":
    main()

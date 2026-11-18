"""Match GPX to nearby OSM highways conservatively, offline after one cached download.
Usage: python3 tools/enrich_surfaces.py --osm /path/to/overpass-ways.json
OSM extract must include ALL highways (including ones without a surface tag).
"""

import argparse, json, math, urllib.request, urllib.parse
from pathlib import Path
from collections import defaultdict
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SCALE_X = 111195 * math.cos(math.radians(44.5))
SCALE_Y = 111195
CELL = 40


def xy(lat, lon):
    return lon * SCALE_X, lat * SCALE_Y


def category(value):
    groups = {
        "paved": {"asphalt", "paved", "concrete", "concrete:plates", "concrete:lanes"},
        "gravel": {"gravel", "fine_gravel", "compacted", "pebblestone"},
        "earth": {"ground", "dirt", "earth", "grass", "grass_paver", "mud"},
        "sand": {"sand"},
        "rock": {"rock", "stone"},
        "cobbles": {"cobblestone", "sett", "paving_stones", "unhewn_cobblestone"},
        "unpaved": {"unpaved"},
    }
    if not value:
        return "unknown"
    return next((k for k, v in groups.items() if value in v), "other")


def cell(p):
    return math.floor(p[0] / CELL), math.floor(p[1] / CELL)


def segment_distance(p, a, b):
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    norm = dx * dx + dy * dy
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / norm)) if norm else 0
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def classify(p, tangent, index):
    candidates = []
    tx, ty = tangent
    tn = math.hypot(tx, ty)
    if not tn:
        return "unknown"
    for a, b, kind, way in index.get(cell(p), []):
        vx = b[0] - a[0]
        vy = b[1] - a[1]
        vn = math.hypot(vx, vy)
        if not vn or abs(tx * vx + ty * vy) / (tn * vn) < 0.866:
            continue
        d = segment_distance(p, a, b)
        if d <= 12:
            candidates.append((d, kind, way))
    if not candidates:
        return "unknown"
    candidates.sort()
    best = candidates[0]
    if any(c[1] != best[1] and c[0] < best[0] + 4 for c in candidates[1:]):
        return "unknown"
    return best[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--route", help="Identifiant du seul parcours à enrichir")
    parser.add_argument("--osm", help="Extrait Overpass JSON local")
    parser.add_argument(
        "--download",
        action="store_true",
        help="Télécharger un extrait sur l’emprise des parcours",
    )
    parser.add_argument(
        "--endpoint", default="https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    )
    args = parser.parse_args()
    if not args.osm and not args.download:
        parser.error("indiquer --osm ou --download")
    if args.download:
        coordinates = [
            p
            for f in (ROOT / "data/details").glob("*.json")
            for p in json.loads(f.read_text())["points"]
        ]
        south = min(p[2] for p in coordinates) - 0.002
        north = max(p[2] for p in coordinates) + 0.002
        west = min(p[3] for p in coordinates) - 0.002
        east = max(p[3] for p in coordinates) + 0.002
        query = f"[out:json][timeout:120];way[highway]({south},{west},{north},{east});out tags geom;"
        url = args.endpoint + "?" + urllib.parse.urlencode({"data": query})
        request = urllib.request.Request(
            url, headers={"User-Agent": "ACC-Bordeaux-route-catalog/1.0"}
        )
        print("Téléchargement OpenStreetMap…", flush=True)
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = json.load(response)
    else:
        raw = json.loads(Path(args.osm).read_text())
    if raw.get("remark"):
        raise ValueError(raw["remark"])
    files = list(
        (ROOT / "data/details").glob((args.route if args.route else "*") + ".json")
    )
    details = {f: json.loads(f.read_text()) for f in files}
    needed = set()
    for d in details.values():
        for p in d["points"]:
            cx, cy = cell(xy(p[2], p[3]))
            needed.update((cx + i, cy + j) for i in range(-2, 3) for j in range(-2, 3))
    index = defaultdict(list)
    for w in raw["elements"]:
        if w.get("type") != "way" or "highway" not in w.get("tags", {}):
            continue
        geom = [xy(p["lat"], p["lon"]) for p in w.get("geometry", [])]
        kind = category(w["tags"].get("surface"))
        for a, b in zip(geom, geom[1:]):
            c1 = cell((min(a[0], b[0]) - 12, min(a[1], b[1]) - 12))
            c2 = cell((max(a[0], b[0]) + 12, max(a[1], b[1]) + 12))
            for i in range(c1[0], c2[0] + 1):
                for j in range(c1[1], c2[1] + 1):
                    if (i, j) in needed:
                        index[i, j].append((a, b, kind, w["id"]))
    total = known = 0
    for f, d in details.items():
        spans = []
        for a, b in zip(d["points"], d["points"][1:]):
            if a[4] != b[4] or b[0] <= a[0]:
                continue
            start = xy(a[2], a[3])
            end = xy(b[2], b[3])
            tangent = (end[0] - start[0], end[1] - start[1])
            n = max(1, math.ceil((b[0] - a[0]) * 1000 / 30))
            for i in range(n):
                k0 = a[0] + (b[0] - a[0]) * i / n
                k1 = a[0] + (b[0] - a[0]) * (i + 1) / n
                kinds = [
                    classify(
                        (
                            start[0] + tangent[0] * (i + t) / n,
                            start[1] + tangent[1] * (i + t) / n,
                        ),
                        tangent,
                        index,
                    )
                    for t in (0.2, 0.5, 0.8)
                ]
                kind = kinds[0] if len(set(kinds)) == 1 else "unknown"
                if spans and spans[-1][2] == kind and abs(spans[-1][1] - k0) < 1e-5:
                    spans[-1][1] = k1
                else:
                    spans.append([k0, k1, kind])
                total += k1 - k0
                if kind != "unknown":
                    known += k1 - k0
        d.update(
            surfaces=[[round(a, 6), round(b, 6), c] for a, b, c in spans],
            surfaceSource="OpenStreetMap · rapprochement géographique estimé",
            surfaceDate=raw.get("osm3s", {}).get(
                "timestamp_osm_base", datetime.now(timezone.utc).isoformat()
            ),
        )
        f.write_text(json.dumps(d, separators=(",", ":")))
    print(
        f"{len(details)} parcours enrichis ; revêtement identifié sur {known/total:.1%} de la distance cumulée."
    )


if __name__ == "__main__":
    main()

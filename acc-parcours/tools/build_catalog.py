import hashlib
import json
import math
import re
import shutil
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]


def distance(a, b):
    p, q = map(math.radians, (a[0], b[0]))
    dp = q - p
    dl = math.radians(b[1] - a[1])
    return (
        6371.0088
        * 2
        * math.asin(
            min(
                1,
                math.sqrt(
                    math.sin(dp / 2) ** 2
                    + math.cos(p) * math.cos(q) * math.sin(dl / 2) ** 2
                ),
            )
        )
    )


def read_track(path):
    root = ET.parse(path).getroot()
    if root.tag.split("}")[-1] != "gpx":
        raise ValueError(f"Fichier GPX attendu : {path}")
    segments = []
    gain = 0
    km = 0
    missing = False
    profile = []
    for segment_index, seg in enumerate(root.findall(".//{*}trkseg")):
        pts = []
        last = None
        for p in seg.findall("{*}trkpt"):
            ele = p.find("{*}ele")
            e = float(ele.text) if ele is not None else None
            point = [float(p.attrib["lat"]), float(p.attrib["lon"])]
            if not all(math.isfinite(v) for v in point) or not (-90 <= point[0] <= 90 and -180 <= point[1] <= 180):
                raise ValueError(f"Coordonnées invalides : {path}")
            if e is not None and not math.isfinite(e):
                raise ValueError(f"Altitude invalide : {path}")
            if pts:
                km += distance(pts[-1], point)
            if e is None:
                missing = True
            if e is not None and last is not None:
                gain += max(0, e - last)
            last = e
            pts.append(point)
            profile.append([round(km, 6), e, *point, segment_index])
        if pts:
            segments.append(pts)
    if len(profile) < 2:
        raise ValueError(f"Pas de trace : {path}")
    name = root.find(".//{*}trk/{*}name")
    title = name.text.strip() if name is not None and name.text else path.stem
    return title, segments, profile, round(km, 1), None if missing else round(gain)


def build_catalog(site_root=ROOT, import_dates=None):
    catalog = site_root / "data/routes.json"
    existing = (
        {r["file"]: r for r in json.loads(catalog.read_text())} if catalog.exists() else {}
    )
    rows = []
    seen = {}
    used_names = set()
    # Only the publication build normalises filenames in its disposable output.
    if import_dates is not None:
        published = site_root / "gpx-normalises"
        published.mkdir()
    (site_root / "data/details").mkdir(exist_ok=True)
    gpx_dir = site_root / "data/gpx"
    files = (p for p in gpx_dir.rglob("*") if p.suffix.lower() == ".gpx")
    def priority(path):
        key = path.relative_to(site_root).as_posix()
        date = (import_dates or {}).get(key, "")
        return (key not in existing, date[4:], date[2:4], date[:2], key)

    for f in sorted(files, key=priority):
        relative = f.relative_to(gpx_dir)
        if f.is_symlink():
            raise ValueError(f"Lien symbolique GPX non accepté : {f}")
        if len(relative.parts) > 2 or (len(relative.parts) == 2 and relative.parts[0] not in ("route", "gravel", "vtt")):
            raise ValueError(f"Ranger le GPX dans route, gravel ou vtt : {f}")
        title, segments, profile, km, gain = read_track(f)
        file_key = f.relative_to(site_root).as_posix()
        old = existing.get(file_key, {})
        route_id = old.get("id") or hashlib.sha256(relative.as_posix().encode()).hexdigest()[:12]
        if not re.fullmatch(r"[0-9a-f]{12}", route_id):
            raise ValueError(f"Identifiant de parcours invalide : {route_id}")
        sport = old.get("sport", relative.parts[0] if len(relative.parts) == 2 else "route")
        if sport not in ("route", "gravel", "vtt"):
            raise ValueError(f"Pratique inconnue : {sport}")
        if import_dates is not None:
            geometry = hashlib.sha256(json.dumps(segments, separators=(",", ":")).encode()).digest()
            geometry_key = (sport, geometry)
            if geometry_key in seen:
                aliases = seen[geometry_key].setdefault("aliases", [])
                aliases.extend([route_id, *old.get("aliases", [])])
                (site_root / "data/details" / f"{route_id}.json").unlink(missing_ok=True)
                f.unlink()
                continue
        detail_path = site_root / "data/details" / f"{route_id}.json"
        old_detail = json.loads(detail_path.read_text()) if detail_path.exists() else {}
        fingerprint = hashlib.sha256(f.read_bytes()).hexdigest()
        detail = {"points": profile, "fingerprint": fingerprint}
        if old_detail.get("fingerprint") == fingerprint:
            for key in ("surfaces", "surfaceSource", "surfaceDate"):
                if key in old_detail:
                    detail[key] = old_detail[key]
        detail_path.write_text(json.dumps(detail, separators=(",", ":")))
        # Keep endpoints and enough points for a faithful lightweight preview.
        simplified = [
            p[:: max(1, len(p) // 700)] + ([p[-1]] if len(p) > 1 else []) for p in segments
        ]
        rows.append(
            dict(
                id=route_id,
                detail=f"data/details/{route_id}.json",
                name=old.get("name", title),
                km=km,
                gain=gain,
                sport=sport,
                direction=old.get("direction"),
                profile=profile[:: max(1, len(profile) // 250)] + [profile[-1]],
                file="data/gpx/" + relative.as_posix(),
                segments=simplified,
            )
        )
        row = rows[-1]
        for field in ("addedDate", "aliases"):
            if field in old:
                row[field] = old[field]
        if import_dates is not None:
            stamp = old.get("addedDate") or import_dates[file_key]
            if not re.fullmatch(r"[0-9]{8}", stamp):
                raise ValueError(f"Date d’ajout invalide : {stamp}")
            rounded_km = math.floor(km + 0.5)
            elevation = "NA" if gain is None else gain
            stem = f"{stamp}_{sport}_{rounded_km}km_{elevation}d"
            filename = f"{stem}.gpx"
            if filename in used_names:
                filename = f"{stem}_{route_id}.gpx"
            used_names.add(filename)
            f.rename(published / filename)
            row.update(name=Path(filename).stem, file=f"data/gpx/{filename}", addedDate=stamp)
            seen[geometry_key] = row
    if import_dates is not None:
        shutil.rmtree(gpx_dir)
        published.rename(gpx_dir)
    catalog.write_text(
        json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    )
    print(f"{len(rows)} parcours générés")


if __name__ == "__main__":
    build_catalog()

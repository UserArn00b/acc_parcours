"""Unpack the route bundle, import additions and prepare GitHub Pages."""

import shutil
import subprocess
from datetime import datetime
import zipfile
from pathlib import Path, PurePosixPath

from build_catalog import ROOT, build_catalog


def unpack_routes(archive, destination):
    with zipfile.ZipFile(archive) as bundle:
        files = [info for info in bundle.infolist() if not info.is_dir()]
        # Validate every path before extracting anything from an uploaded ZIP.
        for info in files:
            path = PurePosixPath(info.filename)
            valid = (
                info.filename == "routes.json"
                or (len(path.parts) == 2 and path.parts[0] == "details" and path.suffix == ".json")
                or (len(path.parts) in (2, 3) and path.parts[0] == "gpx" and path.suffix.lower() == ".gpx")
            )
            if not valid or ".." in path.parts or "\\" in info.filename or path.is_absolute():
                raise ValueError(f"Chemin inattendu dans l’archive : {info.filename}")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Les liens symboliques ne sont pas acceptés")
        if sum(info.file_size for info in files) > 256 * 1024 * 1024:
            raise ValueError("Archive trop volumineuse après décompression (maximum 256 Mo)")
        for info in files:
            bundle.extract(info, destination)
        return {
            "data/" + info.filename: datetime(*info.date_time).strftime("%d%m%Y")
            for info in files if info.filename.lower().endswith(".gpx")
        }


def addition_date(root, source):
    if (root / ".git").exists():
        result = subprocess.run(
            ["git", "log", "--diff-filter=A", "-1", "--format=%aI", "--", source.relative_to(root)],
            cwd=root, check=True, capture_output=True, text=True,
        )
        if result.stdout.strip():
            return datetime.fromisoformat(result.stdout.strip()).strftime("%d%m%Y")
    return datetime.fromtimestamp(source.stat().st_mtime).strftime("%d%m%Y")


def prepare_site(root=ROOT):
    output = root / "_site"
    if output.is_symlink():
        raise ValueError("Le dossier _site ne doit pas être un lien symbolique")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    dates = unpack_routes(root / "data/parcours.zip", output / "data")
    for sport in ("route", "gravel", "vtt"):
        for source in sorted((root / "data/gpx" / sport).glob("*")):
            if source.suffix.lower() != ".gpx":
                continue
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"Fichier GPX attendu : {source}")
            destination = output / "data/gpx" / sport / source.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
            dates[source.relative_to(root).as_posix()] = addition_date(root, source)
    build_catalog(output, dates)
    for name in ("index.html", "style.css", "app.js", ".nojekyll"):
        shutil.copyfile(root / name, output / name)
    print("Site prêt dans _site/ (archive source non publiée)")
    return output


if __name__ == "__main__":
    prepare_site()

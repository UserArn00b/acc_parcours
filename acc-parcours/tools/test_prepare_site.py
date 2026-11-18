import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from prepare_site import prepare_site, unpack_routes
from test_catalog import GPX


class PrepareSiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "data").mkdir()
        for name in ("index.html", "style.css", "app.js", ".nojekyll"):
            (self.root / name).write_text("")

    def bundle(self, files):
        archive = self.root / "data/parcours.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            for name, content in files.items():
                bundle.writestr(name, content)
        return archive

    def test_bundle_and_addition_publish_without_source_zip(self):
        self.bundle({"gpx/original.gpx": GPX, "routes.json": json.dumps([
            {"file": "data/gpx/original.gpx", "sport": "gravel", "name": "Club"}
        ])})
        folder = self.root / "data/gpx/vtt"
        folder.mkdir(parents=True)
        (folder / "nouveau.GPX").write_text(GPX)
        output = prepare_site(self.root)
        rows = json.loads((output / "data/routes.json").read_text())
        self.assertEqual(len(rows), 2)
        self.assertEqual({r["sport"] for r in rows}, {"gravel", "vtt"})
        self.assertFalse(list(output.rglob("*.zip")))
        for row in rows:
            self.assertTrue((output / row["file"]).is_file())
            self.assertTrue((output / row["detail"]).is_file())
        # Rebuilding does not retain an addition removed from the input folder.
        (folder / "nouveau.GPX").unlink()
        prepare_site(self.root)
        self.assertEqual(len(json.loads((output / "data/routes.json").read_text())), 1)

    def test_same_geometry_is_deduplicated_but_different_routes_can_share_metrics(self):
        self.bundle({"gpx/original.gpx": GPX})
        folder = self.root / "data/gpx/route"
        folder.mkdir(parents=True)
        (folder / "copy.gpx").write_text(GPX.replace("Test", "Another name"))
        shifted = GPX.replace('lon="-0.', 'lon="-1.')
        (folder / "alternative.gpx").write_text(shifted)
        output = prepare_site(self.root)
        rows = json.loads((output / "data/routes.json").read_text())
        self.assertEqual(len(rows), 2)
        self.assertEqual(sum(len(r.get("aliases", [])) for r in rows), 1)
        self.assertEqual(len(list((output / "data/gpx").glob("*.gpx"))), 2)
        for row in rows:
            self.assertRegex(row["file"], r"^data/gpx/[0-9]{8}_route_1km_15d(?:_[a-f0-9]{12})?\.gpx$")
            self.assertTrue((output / row["file"]).exists())

    def test_archive_traversal_is_rejected_before_extraction(self):
        archive = self.bundle({"gpx/valid.gpx": GPX, "gpx/../../outside.gpx": GPX})
        with self.assertRaises(ValueError):
            unpack_routes(archive, self.root / "output")
        self.assertFalse((self.root / "output/gpx/valid.gpx").exists())


if __name__ == "__main__":
    unittest.main()

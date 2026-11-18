import json
import tempfile
import unittest
from pathlib import Path

from build_catalog import build_catalog

GPX = '''<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test</name>
<trkseg><trkpt lat="44.8" lon="-0.6"><ele>10</ele></trkpt>
<trkpt lat="44.81" lon="-0.61"><ele>25</ele></trkpt></trkseg></trk></gpx>'''


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "data/gpx").mkdir(parents=True)

    def add(self, name, content=GPX):
        target = self.root / "data/gpx" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def catalog(self):
        build_catalog(self.root)
        return json.loads((self.root / "data/routes.json").read_text())

    def test_folder_assigns_sport_and_same_names_have_distinct_ids(self):
        for sport in ("route", "gravel", "vtt"):
            self.add(f"{sport}/sortie.GPX")
        rows = self.catalog()
        self.assertEqual({r["sport"] for r in rows}, {"route", "gravel", "vtt"})
        self.assertEqual(len({r["id"] for r in rows}), 3)
        self.assertTrue(all(r["gain"] == 15 and r["km"] > 0 for r in rows))
        self.assertTrue(all((self.root / r["file"]).is_file() for r in rows))

    def test_metadata_and_surfaces_survive_rebuild_but_not_changed_gpx(self):
        self.add("old.gpx")
        rows = self.catalog()
        rows[0].update(sport="gravel", name="Personnalisé", direction="NE")
        (self.root / "data/routes.json").write_text(json.dumps(rows))
        detail_path = self.root / rows[0]["detail"]
        detail = json.loads(detail_path.read_text())
        detail["surfaces"] = [[0, 1, "paved"]]
        detail_path.write_text(json.dumps(detail))
        updated = self.catalog()[0]
        self.assertEqual(updated["id"], rows[0]["id"])
        self.assertEqual(updated["sport"], "gravel")
        self.assertEqual(updated["name"], "Personnalisé")
        self.assertEqual(updated["direction"], "NE")
        self.assertIn("surfaces", json.loads(detail_path.read_text()))
        self.add("old.gpx", GPX.replace("25", "30"))
        self.catalog()
        self.assertNotIn("surfaces", json.loads(detail_path.read_text()))

    def test_invalid_coordinates_rejected(self):
        self.add("route/bad.gpx", GPX.replace('lat="44.8"', 'lat="nan"'))
        with self.assertRaises(ValueError):
            self.catalog()

    def test_missing_altitude_does_not_invent_elevation_gain(self):
        self.add("route/flat.gpx", GPX.replace("<ele>25</ele>", ""))
        self.assertIsNone(self.catalog()[0]["gain"])

    def test_unknown_sport_folder_rejected(self):
        self.add("unknown/a.gpx")
        with self.assertRaises(ValueError):
            self.catalog()


if __name__ == "__main__":
    unittest.main()

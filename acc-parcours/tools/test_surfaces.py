import unittest
from enrich_surfaces import category, classify, cell


class SurfaceMatchingTests(unittest.TestCase):
    def test_explicit_surface_only(self):
        self.assertEqual(category(None), "unknown")
        self.assertEqual(category("asphalt"), "paved")
        self.assertEqual(category("compacted"), "gravel")

    def test_close_parallel_road_with_missing_tag_is_ambiguous(self):
        p = (10, 0)
        idx = {
            cell(p): [((0, 0), (20, 0), "gravel", 1), ((0, 2), (20, 2), "unknown", 2)]
        }
        self.assertEqual(classify(p, (20, 0), idx), "unknown")

    def test_crossing_road_does_not_override_surface(self):
        p = (10, 0)
        idx = {
            cell(p): [((0, 1), (20, 1), "gravel", 1), ((10, -10), (10, 10), "paved", 2)]
        }
        self.assertEqual(classify(p, (20, 0), idx), "gravel")

    def test_distant_road_stays_unknown(self):
        p = (10, 0)
        idx = {cell(p): [((0, 15), (20, 15), "paved", 1)]}
        self.assertEqual(classify(p, (20, 0), idx), "unknown")

    def test_return_direction_matches_same_surface(self):
        p = (10, 0)
        idx = {cell(p): [((0, 1), (20, 1), "gravel", 1)]}
        self.assertEqual(classify(p, (-20, 0), idx), "gravel")


if __name__ == "__main__":
    unittest.main()

"""Exercise the GPX-derived calculations independently of the site build."""

import unittest

from route_analysis import climb_category, elevation_analysis, outbound_vector, relief


def profile(altitudes):
    """Space test altitudes 100 m apart within one GPX segment."""
    return [[i / 10, altitude, 45, 0, 0] for i, altitude in enumerate(altitudes)]


class RouteAnalysisTests(unittest.TestCase):
    """Cover the threshold and geometry rules used in the published catalogue."""

    def test_relief_uses_unrounded_inclusive_thresholds(self):
        """Keep the boundary values in the higher relief category."""
        self.assertEqual(relief(10, 69.99), "flat")
        self.assertEqual(relief(10, 70), "rolling")
        self.assertEqual(relief(10, 149.99), "rolling")
        self.assertEqual(relief(10, 150), "mountainous")
        self.assertIsNone(relief(10, None))
        self.assertIsNone(relief(0, 0))

    def test_outbound_cuts_the_last_edge_exactly_and_skips_segment_joins(self):
        """Use one northbound km and two westbound km out of the first three."""
        points = [
            [0, None, 0, 0, 0],
            [1, None, 1, 0, 0],
            [1, None, 0, 30, 1],
            [6, None, 0, 29, 1],
            [10, None, 4, 29, 1],
        ]
        north, east = outbound_vector(points, 10)
        self.assertAlmostEqual(north, 1 / 3)
        self.assertAlmostEqual(east, -2 / 3)
        self.assertIsNone(outbound_vector(points, 0))

    def test_bins_stop_at_altitude_and_segment_gaps(self):
        """Keep partial tranches with their real length and never span a gap."""
        bins, climbs = elevation_analysis([
            [0, 0, 45, 0, 0], [0.15, 15, 45, 0, 0],
            [0.2, None, 45, 0, 0], [0.25, 25, 45, 0, 0],
            [0.3, 30, 45, 0, 0], [0.3, 35, 45, 0, 1],
            [0.35, 40, 45, 0, 1],
        ])
        self.assertEqual(bins, [
            [0, 0.1, 10, 0], [0.1, 0.15, 10, 0],
            [0.25, 0.3, 10, 0], [0.3, 0.35, 10, 1],
        ])
        self.assertEqual(climbs, [])

    def test_climbs_merge_a_short_pause_and_split_after_a_larger_drop(self):
        """Keep a 200 m pause with 5 m lost, then split at a 6 m descent."""
        points = profile([0, 5, 10, 10, 5, 12, 21, 30, 24, 30, 36, 42, 48, 54, 54])
        _, climbs = elevation_analysis(points)
        self.assertEqual(climbs, [[0, 0.7, 30 / 7, "uncategorized", 0],
                                  [0.8, 1.3, 6, "uncategorized", 0]])

    def test_climb_minimum_and_strict_category_thresholds(self):
        """Include the 500 m / 3% minimum and apply strict category cutoffs."""
        _, climbs = elevation_analysis(profile([0, 3, 6, 9, 12, 15]))
        self.assertEqual(climbs, [[0, 0.5, 3, "uncategorized", 0]])
        self.assertEqual(elevation_analysis(profile([0, 20, 40, 60, 80]))[1], [])
        self.assertEqual(elevation_analysis(profile([0, 2, 4, 6, 8, 10]))[1], [])
        for boundary, previous, following in [
            (8000, "uncategorized", "4"), (16000, "4", "3"), (32000, "3", "2"),
            (64000, "2", "1"), (80000, "1", "hc"),
        ]:
            self.assertEqual(climb_category(boundary), previous)
            self.assertEqual(climb_category(boundary + 1), following)

    def test_steep_core_survives_a_gentle_approach(self):
        """Recover the largest qualifying rise inside a climb that averages below 3%."""
        points = profile([0, 1, 2, 3, 4, 5, 6, 11, 16, 21, 26, 31, 32, 33, 34, 35, 36, 37])
        _, climbs = elevation_analysis(points)
        self.assertEqual(climbs, [[0.1, 1.1, 3, "uncategorized", 0]])

"""Derive catalogue and elevation data from ordered GPX profile points."""

import math


def relief(km, gain_m):
    """Return the relief category using unrounded kilometers and meters of D+."""
    if km <= 0 or gain_m is None:
        return None
    density = gain_m / km
    if density < 7:
        return "flat"
    return "rolling" if density < 15 else "mountainous"


def outbound_vector(points, km):
    """Return normalized north/east components for the first 30% of track distance."""
    limit_km = km * 0.30
    if limit_km <= 0:
        return None
    north = east = 0
    for previous, point in zip(points, points[1:]):
        if previous[0] >= limit_km:
            break
        length_km = min(point[0], limit_km) - previous[0]
        if point[4] != previous[4] or length_km <= 0:
            continue
        lat1, lat2 = map(math.radians, (previous[2], point[2]))
        longitude_delta = math.radians(point[3] - previous[3])
        bearing = math.atan2(
            math.sin(longitude_delta) * math.cos(lat2),
            math.cos(lat1) * math.sin(lat2)
            - math.sin(lat1) * math.cos(lat2) * math.cos(longitude_delta),
        )
        north += length_km * math.cos(bearing)
        east += length_km * math.sin(bearing)
    return [north / limit_km, east / limit_km]


def elevation_runs(points):
    """Yield increasing-distance runs with known altitude in a single GPX segment."""
    run = []
    for point in points:
        if run and (point[4] != run[-1][4] or point[1] is None):
            yield run
            run = []
        if point[1] is not None and (not run or point[0] > run[-1][0]):
            run.append(point)
    if run:
        yield run


def elevation_samples(run):
    """Yield (distance in km, altitude in m) every 100 m and at the end of a run."""
    start_km, start_m = run[0][:2]
    end_km = run[-1][0]
    yield start_km, start_m
    index = 1
    for step in range(1, math.ceil((end_km - start_km) * 10) + 1):
        distance_km = min(start_km + step / 10, end_km)
        while run[index][0] < distance_km:
            index += 1
        left, right = run[index - 1], run[index]
        fraction = (distance_km - left[0]) / (right[0] - left[0])
        yield distance_km, left[1] + fraction * (right[1] - left[1])


def climb_category(score):
    """Return the highest ClimbPro-style category strictly below the given score."""
    for threshold, category in ((80000, "hc"), (64000, "1"), (32000, "2"),
                                (16000, "3"), (8000, "4")):
        if score > threshold:
            return category
    return "uncategorized"


def finish_climb(start, end, segment):
    """Return a climb interval in km and percent if it meets the length and grade minima."""
    length_m = round((end[0] - start[0]) * 1000, 6)
    score = round((end[1] - start[1]) * 100, 8)
    if length_m >= 500 and score >= 3 * length_m:
        return [round(start[0], 6), round(end[0], 6), score / length_m,
                climb_category(score), segment]
    return None


def strongest_climb(samples, segment):
    """Keep a qualifying core when gentle approaches dilute an otherwise valid ascent."""
    climb = finish_climb(samples[0], samples[-1], segment)
    if climb:
        return climb
    best_gain_m = 0
    for index, start in enumerate(samples):
        if samples[-1][0] - start[0] < 0.5 - 1e-9:
            break
        for end in samples[index + 1:]:
            distance_km = end[0] - start[0]
            gain_m = end[1] - start[1]
            if distance_km < 0.5 - 1e-9 or gain_m <= best_gain_m:
                continue
            candidate = finish_climb(start, end, segment)
            if candidate:
                climb = candidate
                best_gain_m = gain_m
    return climb


def elevation_analysis(points):
    """Return slope bins [from km, to km, %, segment] and categorized climb intervals."""
    bins, climbs = [], []
    for run in elevation_runs(points):
        segment = run[0][4]
        start = last_ascent = None
        samples = list(elevation_samples(run))
        for index, (previous, sample) in enumerate(zip(samples, samples[1:])):
            length_km = sample[0] - previous[0]
            if length_km <= 1e-9:
                continue
            grade = round((sample[1] - previous[1]) / (10 * length_km), 8)
            bins.append([round(previous[0], 6), round(sample[0], 6), grade, segment])
            if grade >= 1:
                if start is None:
                    start = index
                last_ascent = index + 1
            elif start is not None and (
                round(sample[0] - samples[last_ascent][0], 6) > 0.2
                or round(samples[last_ascent][1] - sample[1], 6) > 5
            ):
                climb = strongest_climb(samples[start:last_ascent + 1], segment)
                if climb:
                    climbs.append(climb)
                start = last_ascent = None
        if start is not None:
            climb = strongest_climb(samples[start:last_ascent + 1], segment)
            if climb:
                climbs.append(climb)
    return bins, climbs

#!/usr/bin/env python3
"""Generate the reviewed base mosaic cartogram from official IGN province polygons.

The solver follows the mosaic-cartogram pattern: rasterize a recognizable national
outline on a regular hex grid, then solve a capacity-constrained geographic
assignment using exact province seat counts. The browser only consumes the reviewed
output; no optimization runs at runtime.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict, deque
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment
from shapely.geometry import Point, shape
from shapely import contains_xy
from shapely.ops import transform, unary_union

NEIGHBORS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))
INSETS = {"07", "35", "38", "51", "52"}


def project_geometry(geometry):
    cosine = math.cos(math.radians(40))
    return transform(lambda x, y, z=None: (x * cosine, -y), geometry)


def connected(nodes):
    if not nodes: return True
    seen = {next(iter(nodes))}; queue = deque(seen)
    while queue:
        q, r = queue.popleft()
        for dq, dr in NEIGHBORS:
            node = (q + dq, r + dr)
            if node in nodes and node not in seen:
                seen.add(node); queue.append(node)
    return len(seen) == len(nodes)


def make_mask(outline, target):
    min_x, min_y, max_x, max_y = outline.bounds
    base = math.sqrt(outline.area / (target * 3 * math.sqrt(3) / 2))
    best = None
    for scale_index in range(121):
        size = base * (0.86 + scale_index * 0.0024)
        step_x, step_y = math.sqrt(3) * size, 1.5 * size
        for offset_x in np.linspace(0, step_x, 13, endpoint=False):
            for offset_y in np.linspace(0, step_y, 13, endpoint=False):
                r_min = math.floor((min_y - offset_y) / step_y) - 1
                r_max = math.ceil((max_y - offset_y) / step_y) + 1
                candidates = []
                for r in range(r_min, r_max + 1):
                    q_min = math.floor((min_x - offset_x) / step_x - r / 2) - 1
                    q_max = math.ceil((max_x - offset_x) / step_x - r / 2) + 1
                    for q in range(q_min, q_max + 1):
                        x = step_x * (q + r / 2) + offset_x
                        y = step_y * r + offset_y
                        candidates.append((q, r, x, y))
                inside = contains_xy(outline, np.array([cell[2] for cell in candidates]), np.array([cell[3] for cell in candidates]))
                cells = [cell for cell, keep in zip(candidates, inside) if keep]
                delta = abs(len(cells) - target)
                score = (delta, abs(size - base))
                if best is None or score < best[0]: best = (score, size, offset_x, offset_y, cells)
                if len(cells) == target and connected({(q, r) for q, r, _, _ in cells}):
                    return size, offset_x, offset_y, cells
    if best and len(best[4]) == target: return best[1:]
    raise RuntimeError(f"Could not rasterize a connected {target}-cell mainland mask; closest was {len(best[4])}")


def components(nodes):
    remaining = set(nodes); output = []
    while remaining:
        seen = {next(iter(remaining))}; queue = deque(seen)
        while queue:
            q, r = queue.popleft()
            for dq, dr in NEIGHBORS:
                node = (q + dq, r + dr)
                if node in remaining and node not in seen:
                    seen.add(node); queue.append(node)
        output.append(seen); remaining -= seen
    return sorted(output, key=len, reverse=True)


def assignment_cost(cells, province_shapes, slots, size):
    matrix = np.empty((len(cells), len(slots)))
    centroids = {pid: geometry.centroid for pid, geometry in province_shapes.items()}
    for row, (_, _, x, y) in enumerate(cells):
        point = Point(x, y)
        for column, pid in enumerate(slots):
            boundary_distance = province_shapes[pid].distance(point) / size
            centroid_distance = point.distance(centroids[pid]) / size
            matrix[row, column] = boundary_distance ** 2 * 14 + centroid_distance ** 2 * 0.32
    return matrix


def grow_connected_assignment(cells, province_shapes, seat_counts, size):
    """Capacity-constrained multi-source growth; connectivity is true by construction."""
    coordinates = [(q, r) for q, r, _, _ in cells]
    points = [Point(x, y) for _, _, x, y in cells]
    lookup = {coord: index for index, coord in enumerate(coordinates)}
    province_ids = sorted(seat_counts)
    centroids = {pid: province_shapes[pid].centroid for pid in province_ids}
    seed_cost = np.array([[point.distance(centroids[pid]) for point in points] for pid in province_ids])
    province_rows, cell_columns = linear_sum_assignment(seed_cost)
    labels = [None] * len(cells)
    owned = defaultdict(set)
    for province_row, cell_index in zip(province_rows, cell_columns):
        pid = province_ids[province_row]
        labels[cell_index] = pid; owned[pid].add(cell_index)

    while any(value is None for value in labels):
        best = None
        for pid in province_ids:
            if len(owned[pid]) >= seat_counts[pid]: continue
            frontier = set()
            for index in owned[pid]:
                q, r = coordinates[index]
                for dq, dr in NEIGHBORS:
                    other = lookup.get((q + dq, r + dr))
                    if other is not None and labels[other] is None: frontier.add(other)
            for index in frontier:
                point = points[index]
                boundary_distance = province_shapes[pid].distance(point) / size
                centroid_distance = point.distance(centroids[pid]) / size
                q, r = coordinates[index]
                same_neighbors = sum(labels[lookup[(q + dq, r + dr)]] == pid for dq, dr in NEIGHBORS if (q + dq, r + dr) in lookup)
                fill = len(owned[pid]) / seat_counts[pid]
                score = boundary_distance ** 2 * 12 + centroid_distance ** 2 * 0.2 - same_neighbors * 2.5 + fill * 24
                candidate = (score, pid, index)
                if best is None or candidate < best: best = candidate
        if best is None:
            missing = Counter(value for value in labels if value is not None)
            raise RuntimeError(f"Connected growth deadlocked with {sum(value is None for value in labels)} cells; allocations {missing}")
        _, pid, index = best
        labels[index] = pid; owned[pid].add(index)
    return labels


def repair_connectivity(cells, labels, province_ids):
    """Use quota-preserving adjacent swaps to remove small disconnected islands."""
    coords = [(q, r) for q, r, _, _ in cells]
    lookup = {coord: index for index, coord in enumerate(coords)}

    def penalty(values):
        return sum(sum(len(component) for component in components({coords[i] for i, value in enumerate(values) if value == pid})[1:]) for pid in province_ids)

    current = penalty(labels)
    for _ in range(200):
        changed = False
        for pid in province_ids:
            pid_indices = {i for i, value in enumerate(labels) if value == pid}
            pid_components = components({coords[i] for i in pid_indices})
            if len(pid_components) <= 1: continue
            main = pid_components[0]
            stray_indices = [lookup[node] for component in pid_components[1:] for node in component]
            target_indices = {
                lookup[(q + dq, r + dr)]
                for q, r in main for dq, dr in NEIGHBORS
                if (q + dq, r + dr) in lookup and labels[lookup[(q + dq, r + dr)]] != pid
            }
            for stray in stray_indices:
                for target in target_indices:
                    other_pid = labels[target]
                    other_nodes = {coords[i] for i, value in enumerate(labels) if value == other_pid}
                    new_pid_nodes = {coords[i] for i in pid_indices if i != stray} | {coords[target]}
                    new_other_nodes = (other_nodes - {coords[target]}) | {coords[stray]}
                    if connected(new_pid_nodes) and connected(new_other_nodes):
                        labels[stray], labels[target] = labels[target], labels[stray]
                        changed = True; break
                if changed: break
            if changed: break
        if not changed: break
    current = penalty(labels)
    for _ in range(12000):
        if current == 0: return labels
        improved = False
        for index, (q, r) in enumerate(coords):
            for dq, dr in NEIGHBORS:
                other = lookup.get((q + dq, r + dr))
                if other is None or labels[index] == labels[other]: continue
                labels[index], labels[other] = labels[other], labels[index]
                candidate = penalty(labels)
                if candidate < current:
                    current = candidate; improved = True; break
                labels[index], labels[other] = labels[other], labels[index]
            if improved: break
        if not improved: break
    if current:
        bad = {pid: [len(c) for c in components({coords[i] for i, value in enumerate(labels) if value == pid})] for pid in province_ids if len(components({coords[i] for i, value in enumerate(labels) if value == pid})) > 1}
        raise RuntimeError(f"Connectivity repair stopped with {current} stray cells: {bad}")
    return labels


def inset_patch(anchor, count):
    chosen = {anchor}; queue = deque([anchor])
    while len(chosen) < count:
        q, r = queue.popleft()
        for dq, dr in NEIGHBORS:
            node = (q + dq, r + dr)
            if node not in chosen:
                chosen.add(node); queue.append(node)
                if len(chosen) == count: break
    return sorted(chosen, key=lambda point: (point[1], point[0]))


def reserve_patch(cells, geometry, count):
    coords = [(q, r) for q, r, _, _ in cells]
    lookup = {coord: index for index, coord in enumerate(coords)}
    centroid = geometry.centroid
    seed = min(range(len(cells)), key=lambda index: Point(cells[index][2], cells[index][3]).distance(centroid))
    chosen = {seed}
    while len(chosen) < count:
        frontier = {
            lookup[(q + dq, r + dr)]
            for index in chosen for q, r in [coords[index]] for dq, dr in NEIGHBORS
            if (q + dq, r + dr) in lookup and lookup[(q + dq, r + dr)] not in chosen
        }
        next_index = min(frontier, key=lambda index: (geometry.distance(Point(cells[index][2], cells[index][3])), Point(cells[index][2], cells[index][3]).distance(centroid)))
        chosen.add(next_index)
    return chosen


def build(args):
    dataset = json.loads(args.dataset.read_text())
    election = next(item for item in dataset["elections"] if item["id"] == "2019-11-10")
    seats = {province["id"]: sum(row["seats"] for row in province["results"]) for province in election["provinces"]}
    regions = {province["id"]: province["regionId"] for province in election["provinces"]}
    source = json.loads(args.provinces.read_text())
    province_shapes = {}
    for feature in source["features"]:
        province_id = str(feature["properties"].get("codine", "")).zfill(2)
        if province_id in seats:
            province_shapes[province_id] = project_geometry(shape(feature["geometry"]))
    if set(province_shapes) != set(seats):
        raise RuntimeError(f"Missing official province shapes: {sorted(set(seats) - set(province_shapes))}")

    mainland_ids = sorted(set(seats) - INSETS)
    mainland_outline = max(unary_union([province_shapes[pid] for pid in mainland_ids]).geoms, key=lambda polygon: polygon.area)
    target = sum(seats[pid] for pid in mainland_ids)
    size, offset_x, offset_y, mainland_cells = make_mask(mainland_outline, target)
    labels = [None] * len(mainland_cells)
    reserved_ids = {"17"}
    reserved_indices = set()
    for pid in reserved_ids:
        patch = reserve_patch(mainland_cells, province_shapes[pid], seats[pid])
        reserved_indices |= patch
        for index in patch: labels[index] = pid
    available_indices = [index for index in range(len(mainland_cells)) if index not in reserved_indices]
    available_cells = [mainland_cells[index] for index in available_indices]
    slots = [pid for pid in mainland_ids if pid not in reserved_ids for _ in range(seats[pid])]
    rows, columns = linear_sum_assignment(assignment_cost(available_cells, province_shapes, slots, size))
    for row, column in zip(rows, columns): labels[available_indices[row]] = slots[column]
    labels = repair_connectivity(mainland_cells, labels, mainland_ids)

    cells = [{"q": q, "r": r, "provinceId": pid, "regionId": regions[pid]} for (q, r, _, _), pid in zip(mainland_cells, labels)]
    min_q = min(cell["q"] for cell in cells); max_q = max(cell["q"] for cell in cells); max_r = max(cell["r"] for cell in cells)
    inset_specs = {
        "38": (min_q - 8, max_r - 1),
        "35": (min_q - 3, max_r - 1),
        "07": (max_q + 5, max_r - 9),
        "51": (min_q + 11, max_r + 4),
        "52": (min_q + 14, max_r + 4),
    }
    for pid, anchor in inset_specs.items():
        for q, r in inset_patch(anchor, seats[pid]):
            cells.append({"q": q, "r": r, "provinceId": pid, "regionId": regions[pid]})
    if len(cells) != 350 or len({(cell["q"], cell["r"]) for cell in cells}) != 350:
        raise RuntimeError("Generated layout does not contain 350 unique cells")
    for pid in seats:
        nodes = {(cell["q"], cell["r"]) for cell in cells if cell["provinceId"] == pid}
        if not connected(nodes): raise RuntimeError(f"Province {pid} is disconnected")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"source": "IGN administrative-unit service", "gridSize": size, "offset": [offset_x, offset_y], "cells": sorted(cells, key=lambda cell: (cell["r"], cell["q"]))}, separators=(",", ":")))
    print(f"Wrote {args.output} with {len(cells)} connected cells")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--provinces", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, default=Path("src/data/generated.json"))
    parser.add_argument("--output", type=Path, default=Path("data/layouts/province-layout-2019.json"))
    build(parser.parse_args())

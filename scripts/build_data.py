#!/usr/bin/env python3
"""Build the browser dataset from preserved Ministry files and final JEC/BOE tables.

The large, fixed-width source archives are intentionally not committed. This script
accepts their compact parquet mirror plus the final official publications and writes
the normalized JSON consumed by the app.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import random
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict, deque
from html.parser import HTMLParser
from pathlib import Path

import pandas as pd
import pdfplumber


ELECTIONS = {
    "2023-07-23": {"key": "2023_07", "seat_date": "02-2023-07-24"},
    "2019-11-10": {"key": "2019_11", "seat_date": "02-2019-11-10"},
    "2019-04-28": {"key": "2019_04", "seat_date": "02-2019-04-28"},
}

ELECTION_LABELS = {
    "2023-07-23": {"en": "23 July 2023", "es": "23 julio 2023"},
    "2019-11-10": {"en": "10 November 2019", "es": "10 noviembre 2019"},
    "2019-04-28": {"en": "28 April 2019", "es": "28 abril 2019"},
}

REGION_NAMES_EN = {
    "01": "Andalusia", "02": "Aragon", "03": "Asturias",
    "04": "Balearic Islands", "05": "Canary Islands", "06": "Cantabria",
    "07": "Castile and León", "08": "Castile-La Mancha", "09": "Catalonia",
    "10": "Valencian Community", "11": "Extremadura", "12": "Galicia",
    "13": "Community of Madrid", "14": "Region of Murcia", "15": "Navarre",
    "16": "Basque Country", "17": "La Rioja", "18": "Ceuta",
    "19": "Melilla",
}

REGION_NAMES_ES = {
    "01": "Andalucía", "02": "Aragón", "03": "Principado de Asturias",
    "04": "Illes Balears", "05": "Canarias", "06": "Cantabria",
    "07": "Castilla y León", "08": "Castilla-La Mancha", "09": "Cataluña",
    "10": "Comunitat Valenciana", "11": "Extremadura", "12": "Galicia",
    "13": "Comunidad de Madrid", "14": "Región de Murcia",
    "15": "Comunidad Foral de Navarra", "16": "País Vasco", "17": "La Rioja",
    "18": "Ceuta", "19": "Melilla",
}

KNOWN_PARTIES = {
    "PP": ("PP", "Partido Popular", "#2f6fa7"),
    "PSOE": ("PSOE", "Partido Socialista Obrero Español", "#e34b4b"),
    "VOX": ("VOX", "Vox", "#63a84f"),
    "SUMAR": ("SUMAR", "Sumar", "#d75c9f"),
    "UP": ("UP", "Unidas Podemos and confluences", "#7657a6"),
    "CS": ("Cs", "Ciudadanos–Partido de la Ciudadanía", "#ef8c3f"),
    "ERC": ("ERC", "Esquerra Republicana de Catalunya", "#e8bd3f"),
    "JUNTS": ("Junts", "Junts per Catalunya", "#28a5a0"),
    "EHB": ("EH Bildu", "Euskal Herria Bildu", "#83ad47"),
    "PNV": ("EAJ-PNV", "Euzko Alderdi Jeltzalea–Partido Nacionalista Vasco", "#4f9b68"),
    "BNG": ("BNG", "Bloque Nacionalista Galego", "#69a6c6"),
    "CC": ("CCa", "Coalición Canaria", "#e9ad36"),
    "UPN": ("UPN", "Unión del Pueblo Navarro", "#2674a9"),
    "NA": ("NA+", "Navarra Suma", "#2e77ad"),
    "MAS": ("Más País", "Más País–Compromís", "#3caa86"),
    "CUP": ("CUP-PR", "Candidatura d’Unitat Popular–Per la Ruptura", "#e2aa3f"),
    "PRC": ("PRC", "Partido Regionalista de Cantabria", "#8ebc45"),
    "TERUEL": ("¡Teruel Existe!", "Agrupación de Electores Teruel Existe", "#5a9d97"),
}


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    value = value.lower().replace("s/c", "santa cruz de")
    return re.sub(r"[^a-z0-9]+", "", value)


def num(value) -> int:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return 0
    if isinstance(value, (int, float)):
        return int(round(value))
    text = str(value).strip().replace(".", "").replace(" ", "")
    return int(float(text)) if text and text not in {"-", ".."} else 0


def party_family(text: str, election_id: str) -> str:
    n = normalized(text)
    if "partidopopular" in n or re.search(r"\bpp\b", text.lower()): return "PP"
    if any(x in n for x in ["psoe", "partidosocialista", "partitsocialista", "socialistaobrero", "socialistesdecatalunya", "socialistasdegalicia", "euskadiesk", "pscps", "psdeg"]): return "PSOE"
    if n == "voxvox" or n.startswith("vox"): return "VOX"
    if "sumar" in n: return "SUMAR"
    if any(x in n for x in ["unidaspodemos", "podemosiu", "encomupodem", "encomunpodemos"]): return "UP"
    if "esquerrarepublicana" in n: return "ERC"
    if n.startswith("junts") or "juntsp" in n or "jxc" in n: return "JUNTS"
    if "euskalherriabildu" in n or "ehbildu" in n: return "EHB"
    if "euzkoalderdijeltzalea" in n or "eajpnv" in n: return "PNV"
    if "bloquenacionalistagalego" in n or n.startswith("bng"): return "BNG"
    if "coalicioncanaria" in n or "nuevacanariascoalicion" in n: return "CC"
    if "uniondelpueblonavarro" in n and election_id == "2023-07-23": return "UPN"
    if "navarrasuma" in n or n.startswith("na"): return "NA"
    if "ciudadanos" in n or n.startswith("cs"): return "CS"
    if "maspais" in n or "mescomprom" in n or n.startswith("compromis"): return "MAS"
    if "candidaturadunitatpopular" in n or n.startswith("cup"): return "CUP"
    if "partidoregionalistadecanta" in n or n.startswith("prc"): return "PRC"
    if "teruelexiste" in n: return "TERUEL"
    match = re.findall(r"\(([^()]*)\)", text)
    token = match[-1] if match else text[:34]
    digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:6]
    return f"OTHER-{normalized(token)[:22] or digest}-{digest}"


def party_meta(party_id: str, aliases: set[str]) -> dict:
    if party_id in KNOWN_PARTIES:
        short, name, color = KNOWN_PARTIES[party_id]
    else:
        preferred = sorted(aliases, key=lambda x: (len(x), x))[0]
        match = re.findall(r"\(([^()]*)\)", preferred)
        short = (match[-1] if match else preferred)[:28]
        name = preferred
        color = "#8f8b82"
    return {
        "id": party_id,
        "short": short,
        "name": {"en": name, "es": name},
        "color": color,
        "aliases": sorted(aliases),
    }


def summary_stats(values: list[int]) -> dict:
    electors, voters, valid, party_votes, blank, invalid = values
    return {
        "electors": electors, "voters": voters, "valid": valid,
        "partyVotes": party_votes, "blank": blank, "invalid": invalid,
        "turnout": round(voters / electors * 100, 2) if electors else 0,
    }


def parse_summary_lines(lines: list[str], name_to_code: dict[str, str]) -> dict[str, dict]:
    output = {}
    pattern = re.compile(r"^(.*?)\.?\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$")
    for line in lines:
        line = re.sub(r"\s+", " ", line.strip())
        match = pattern.match(line)
        if not match:
            continue
        name = match.group(1).strip()
        key = normalized(name)
        if key.startswith("totalestatal"):
            output["national"] = summary_stats([num(x) for x in match.groups()[1:]])
        elif key in name_to_code:
            output[name_to_code[key]] = summary_stats([num(x) for x in match.groups()[1:]])
    return output


def read_pdf_summary(path: Path, pages: list[int], name_to_code: dict[str, str]) -> dict[str, dict]:
    lines = []
    with pdfplumber.open(path) as pdf:
        for page in pages:
            lines.extend((pdf.pages[page].extract_text() or "").splitlines())
    return parse_summary_lines(lines, name_to_code)


def read_ocr_summary(image: Path, name_to_code: dict[str, str]) -> dict[str, dict]:
    proc = subprocess.run(
        ["tesseract", str(image), "stdout", "-l", "eng", "--psm", "6"],
        check=True, capture_output=True, text=True,
    )
    result = parse_summary_lines(proc.stdout.splitlines(), name_to_code)
    # Tesseract struggles with the final total row; the province rows are authoritative.
    if len([k for k in result if k != "national"]) != 52:
        missing = sorted(set(name_to_code.values()) - set(result))
        raise ValueError(f"BOE 2023 OCR did not recover all provinces: {missing}")
    result["national"] = aggregate_stats([result[k] for k in result if k != "national"])
    return result


def aggregate_stats(stats: list[dict]) -> dict:
    keys = ["electors", "voters", "valid", "partyVotes", "blank", "invalid"]
    out = {key: sum(row[key] for row in stats) for key in keys}
    out["turnout"] = round(out["voters"] / out["electors"] * 100, 2)
    return out


def read_boe_2023_results(path: Path, name_to_code: dict[str, str]):
    tables = pd.read_html(path, thousands=".", decimal=",")
    by_province = defaultdict(lambda: defaultdict(lambda: {"votes": 0, "seats": 0}))
    aliases = defaultdict(set)
    for table in tables[:13]:
        province_col = table.columns[0]
        for _, row in table.iterrows():
            province_name = str(row[province_col]).strip()
            code = name_to_code.get(normalized(province_name))
            if not code:
                continue
            for column in table.columns[1:]:
                party_name = str(column[0] if isinstance(column, tuple) else column)
                sub = str(column[1] if isinstance(column, tuple) else "Votos")
                if normalized(party_name) == "totalescanos":
                    continue
                value = num(row[column])
                if not value:
                    continue
                party_id = party_family(party_name, "2023-07-23")
                aliases[party_id].add(party_name)
                if normalized(sub).startswith("escan"):
                    by_province[code][party_id]["seats"] += value
                else:
                    by_province[code][party_id]["votes"] += value
    return by_province, aliases


def is_connected(nodes: set[tuple[int, int]]) -> bool:
    if not nodes:
        return True
    seen = {next(iter(nodes))}
    queue = deque(seen)
    while queue:
        q, r = queue.popleft()
        for dq, dr in NEIGHBORS:
            nxt = (q + dq, r + dr)
            if nxt in nodes and nxt not in seen:
                seen.add(nxt); queue.append(nxt)
    return len(seen) == len(nodes)


NEIGHBORS = ((1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1))


class WidgetJSON(HTMLParser):
    def __init__(self):
        super().__init__(); self.keep = False; self.text = []
    def handle_starttag(self, tag, attrs):
        self.keep = tag == "script" and dict(attrs).get("type") == "application/json"
    def handle_endtag(self, tag):
        if tag == "script": self.keep = False
    def handle_data(self, data):
        if self.keep: self.text.append(data)


def geometry_dicts(value):
    if isinstance(value, dict) and "lng" in value:
        yield value
    elif isinstance(value, list):
        for child in value:
            yield from geometry_dicts(child)


def point_in_polygon(x: float, y: float, polygon: dict) -> bool:
    inside = False
    xs, ys = polygon["lng"], polygon["lat"]
    for index in range(len(xs) - 1):
        x1, y1, x2, y2 = xs[index], ys[index], xs[index + 1], ys[index + 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def read_legacy_seed(path: Path, legacy_name_to_code: dict[str, str], region_by_province: dict[str, str]):
    parser = WidgetJSON(); parser.feed(path.read_text(encoding="utf-8"))
    widget = json.loads("".join(parser.text))
    calls = widget["x"]["calls"]
    party_call = next(c for c in calls if c["method"] == "addPolygons")
    cell_call = next(c for c in calls if c["method"] == "addPolylines" and len(c["args"][0]) == 350)
    polygons = []
    for geometry, popup in zip(party_call["args"][0], party_call["args"][6]):
        bits = [b.strip() for b in re.sub(r"<[^>]+>", "|", popup).split("|") if b.strip()]
        province_id = legacy_name_to_code[normalized(bits[1])]
        for polygon in geometry_dicts(geometry):
            polygons.append((province_id, polygon))
    centers = []
    for geometry in cell_call["args"][0]:
        polygon = next(geometry_dicts(geometry))
        x = sum(polygon["lng"][:-1]) / 6
        y = sum(polygon["lat"][:-1]) / 6
        province_id = next(pid for pid, shape in polygons if point_in_polygon(x, y, shape))
        centers.append((x, y, province_id))
    x0, y0 = centers[0][0], centers[0][1]
    dx, dy = 0.389711431703, 0.45
    cells = []
    for x, y, province_id in centers:
        q = round((x - x0) / dx)
        r = round((y - y0) / dy - q / 2)
        cells.append({"q": q, "r": r, "provinceId": province_id, "regionId": region_by_province[province_id]})
    if len({(c["q"], c["r"]) for c in cells}) != 350:
        raise ValueError("Legacy seed did not resolve to 350 unique axial coordinates")
    return cells


def transfer(cells: list[dict], source: str, destination: str):
    lookup = {(c["q"], c["r"]): c for c in cells}
    source_nodes = {(c["q"], c["r"]) for c in cells if c["provinceId"] == source}
    candidates = []
    for node in source_nodes:
        q, r = node
        if any(lookup.get((q + dq, r + dr), {}).get("provinceId") == destination for dq, dr in NEIGHBORS):
            remaining = source_nodes - {node}
            if is_connected(remaining):
                candidates.append(node)
    if not candidates:
        raise ValueError(f"No connectivity-preserving transfer from {source} to {destination}")
    dest_nodes = [(c["q"], c["r"]) for c in cells if c["provinceId"] == destination]
    cq = sum(q for q, _ in dest_nodes) / len(dest_nodes)
    cr = sum(r for _, r in dest_nodes) / len(dest_nodes)
    node = min(candidates, key=lambda p: (p[0] - cq) ** 2 + (p[1] - cr) ** 2)
    lookup[node]["provinceId"] = destination
    lookup[node]["regionId"] = next(c["regionId"] for c in cells if c["provinceId"] == destination and (c["q"], c["r"]) != node)


def move_seat(cells: list[dict], path: list[str]):
    for source, destination in zip(path, path[1:]):
        transfer(cells, source, destination)


def compact_inset(cells: list[dict], province_id: str, anchor: tuple[int, int]):
    """Repack archipelago cells into a compact, connected cartogram inset."""
    province_cells = [cell for cell in cells if cell["provinceId"] == province_id]
    occupied = {(cell["q"], cell["r"]) for cell in cells if cell["provinceId"] != province_id}
    chosen = {anchor}
    frontier = deque([anchor])
    while len(chosen) < len(province_cells):
        q, r = frontier.popleft()
        for dq, dr in NEIGHBORS:
            node = (q + dq, r + dr)
            if node not in chosen and node not in occupied:
                chosen.add(node); frontier.append(node)
                if len(chosen) == len(province_cells): break
    for cell, (q, r) in zip(sorted(province_cells, key=lambda c: (c["r"], c["q"])), sorted(chosen, key=lambda p: (p[1], p[0]))):
        cell["q"], cell["r"] = q, r


def connected_piece_candidates(remaining: set[tuple[int, int]], size: int, seed_value: str):
    if size == len(remaining): return [set(remaining)]
    candidates = []
    signatures = set()
    def keep(piece):
        signature = tuple(sorted(piece))
        if signature not in signatures and is_connected(piece) and is_connected(remaining - piece):
            signatures.add(signature); candidates.append(piece)
    # Small residual patches are cheap to solve exactly. This also removes the
    # last bit of solver fragility around narrow necks in island/province shapes.
    if len(remaining) <= 16:
        ordered = sorted(remaining)
        for combination in itertools.combinations(ordered, size):
            keep(set(combination))
        return candidates
    directions = list(NEIGHBORS) + [(2, -1), (1, 1), (-1, 2), (-2, 1), (-1, -1), (1, -2)]
    seeds = sorted(remaining)
    rng = random.Random(seed_value)
    for attempt in range(1600):
        if attempt < len(seeds) * len(directions):
            direction = directions[(attempt // len(seeds)) % len(directions)]
            seed = seeds[attempt % len(seeds)]
        else:
            direction = rng.choice(directions); seed = rng.choice(seeds)
        piece = {seed}
        while len(piece) < size:
            frontier = {
                (q + dq, r + dr)
                for q, r in piece for dq, dr in NEIGHBORS
                if (q + dq, r + dr) in remaining and (q + dq, r + dr) not in piece
            }
            if not frontier: break
            if attempt < len(seeds) * len(directions):
                pick = min(frontier, key=lambda p: (-(p[0] * direction[0] + p[1] * direction[1]), p))
            else:
                pick = rng.choice(sorted(frontier))
            piece.add(pick)
        if len(piece) == size:
            keep(piece)
            if len(candidates) >= 240: break
    return candidates


def partition_connected(nodes: set[tuple[int, int]], counts: list[tuple[str, int]], seed: str):
    """Backtrack over connected cuts; return one connected cluster per party."""
    def solve(remaining, index):
        if index == len(counts) - 1:
            return {counts[index][0]: remaining} if is_connected(remaining) else None
        party_id, size = counts[index]
        for piece in connected_piece_candidates(remaining, size, f"{seed}-{index}-{party_id}"):
            rest = solve(remaining - piece, index + 1)
            if rest is not None:
                rest[party_id] = piece
                return rest
        return None
    return solve(nodes, 0)


def assign_parties(cells: list[dict], province_results: dict[str, list[dict]], election_id: str):
    by_province = defaultdict(list)
    for cell in cells: by_province[cell["provinceId"]].append(cell)
    output = []
    for province_id, province_cells in by_province.items():
        counts = [(row["partyId"], row["seats"]) for row in province_results[province_id] if row["seats"]]
        # Peel off the smaller clusters first and leave the largest party as the
        # connected remainder. This is substantially more robust on narrow
        # province patches than cutting the dominant cluster first.
        counts.sort(key=lambda row: (row[1], row[0]))
        if sum(count for _, count in counts) != len(province_cells):
            raise ValueError(f"Seat count mismatch for province {province_id}")
        nodes = {(c["q"], c["r"]) for c in province_cells}
        pieces = partition_connected(nodes, counts, f"{election_id}-{province_id}")
        if pieces is None:
            raise ValueError(f"Could not partition {election_id} province {province_id} into {counts}")
        assigned = {node: party_id for party_id, piece in pieces.items() for node in piece}
        for cell in province_cells:
            node = (cell["q"], cell["r"])
            output.append({
                "id": f"{election_id}-{province_id}-{cell['q']}-{cell['r']}",
                **cell, "partyId": assigned[node],
            })
    return sorted(output, key=lambda c: (c["r"], c["q"]))


def result_rows(grouped: dict[str, dict], valid: int):
    rows = [{
        "partyId": party_id,
        "votes": int(values["votes"]),
        "share": round(values["votes"] / valid * 100, 2) if valid else 0,
        "seats": int(values.get("seats", 0)),
    } for party_id, values in grouped.items() if values["votes"] or values.get("seats")]
    return sorted(rows, key=lambda x: (-x["seats"], -x["votes"], x["partyId"]))


def aggregate_results(provinces: list[dict], province_ids: list[str]):
    selected = [p for p in provinces if p["id"] in province_ids]
    stats = aggregate_stats([p["stats"] for p in selected])
    grouped = defaultdict(lambda: {"votes": 0, "seats": 0})
    for province in selected:
        for row in province["results"]:
            grouped[row["partyId"]]["votes"] += row["votes"]
            grouped[row["partyId"]]["seats"] += row["seats"]
    return {"stats": stats, "results": result_rows(grouped, stats["valid"])}


def build(args):
    seats = pd.read_csv(args.seats, dtype={"cod_INE_prov": str, "cod_INE_ccaa": str})
    seats["cod_INE_prov"] = seats["cod_INE_prov"].str.zfill(2)
    seats["cod_INE_ccaa"] = seats["cod_INE_ccaa"].str.zfill(2)
    recent = seats[seats["id_elec"].isin(v["seat_date"] for v in ELECTIONS.values())]
    geography = recent.drop_duplicates("cod_INE_prov")
    province_name = {row.cod_INE_prov: row.prov for row in geography.itertuples()}
    region_by_province = {row.cod_INE_prov: row.cod_INE_ccaa for row in geography.itertuples()}
    name_to_code = {normalized(name): code for code, name in province_name.items()}
    name_to_code.update({
        # Alternate official-language orderings and the spellings recovered from
        # the BOE's raster summary table by OCR.
        normalized("Araba/Álava"): "01", normalized("Araba/Alava"): "01",
        normalized("Castellón/Castellé"): "12",
        normalized("Coruña (A)"): "15", normalized("Coruña, A"): "15",
        normalized("Corufia (A)"): "15",
        normalized("Gipuzkoa"): "20", normalized("Navarra"): "31",
        normalized("Ourense"): "32", normalized("Bizkaia"): "48",
        normalized("Palmas (Las)"): "35", normalized("Palmas, Las"): "35",
        normalized("Santa Cruz de Tenerife"): "38", normalized("S/C Tenerife"): "38",
        normalized("Rioja (La)"): "26", normalized("Rioja, La"): "26",
        normalized("Balears (Illes)"): "07", normalized("Balears, Illes"): "07",
    })

    summaries = {
        "2019-11-10": read_pdf_summary(args.jec_2019_11, [1], name_to_code),
        "2019-04-28": read_pdf_summary(args.jec_2019_04, [1, 2], name_to_code),
        "2023-07-23": read_ocr_summary(args.boe_2023_summary, name_to_code),
    }
    for election_id, summary in summaries.items():
        if len([x for x in summary if x != "national"]) != 52:
            raise ValueError(f"{election_id} summary has {len(summary)-1} provinces")

    elections = []
    province_results_for_layout = {}
    for election_id, config in ELECTIONS.items():
        aliases = defaultdict(set)
        grouped_by_province = defaultdict(lambda: defaultdict(lambda: {"votes": 0, "seats": 0}))
        if election_id == "2023-07-23":
            grouped_by_province, aliases = read_boe_2023_results(args.boe_2023_results, name_to_code)
        else:
            key = config["key"]
            candidates = pd.read_parquet(args.source_dir / f"raw_candidacies_congress_{key}.parquet")
            ballots = pd.read_parquet(args.source_dir / f"raw_candidacies_poll_congress_{key}.parquet")
            votes = ballots.groupby(["cod_INE_prov", "id_candidacies"], as_index=False).ballots.sum()
            votes = votes.merge(candidates, on="id_candidacies", how="left")
            for row in votes.itertuples():
                text = f"{row.abbrev_candidacies} {row.name_candidacies}"
                party_id = party_family(text, election_id)
                grouped_by_province[row.cod_INE_prov][party_id]["votes"] += int(row.ballots)
                aliases[party_id].update([str(row.abbrev_candidacies), str(row.name_candidacies)])

            allocation = recent[recent["id_elec"] == config["seat_date"]]
            # Apply the statutory 3% threshold and D'Hondt to the final Ministry votes.
            for row in allocation.itertuples():
                pid, seat_count = row.cod_INE_prov, int(row.nseats)
                valid = summaries[election_id][pid]["valid"]
                eligible = [(party, values["votes"]) for party, values in grouped_by_province[pid].items() if values["votes"] >= valid * 0.03]
                quotients = sorted(((votes / divisor, party) for party, votes in eligible for divisor in range(1, seat_count + 1)), reverse=True)
                for _, party in quotients[:seat_count]: grouped_by_province[pid][party]["seats"] += 1

        provinces = []
        for pid in sorted(province_name):
            stats = summaries[election_id][pid]
            provinces.append({
                "id": pid,
                "regionId": region_by_province[pid],
                "name": {"en": province_name[pid], "es": province_name[pid]},
                "stats": stats,
                "results": result_rows(grouped_by_province[pid], stats["valid"]),
            })
        province_results_for_layout[election_id] = {p["id"]: p["results"] for p in provinces}
        regions = []
        for region_id in sorted(set(region_by_province.values())):
            province_ids = sorted(pid for pid, rid in region_by_province.items() if rid == region_id)
            total = aggregate_results(provinces, province_ids)
            regions.append({
                "id": region_id,
                "name": {"en": REGION_NAMES_EN[region_id], "es": REGION_NAMES_ES[region_id]},
                "provinceIds": province_ids,
                **total,
            })
        national = aggregate_results(provinces, sorted(province_name))
        winning = {row["partyId"] for row in national["results"] if row["seats"]}
        party_ids = {row["partyId"] for p in provinces for row in p["results"]}
        parties = [party_meta(pid, aliases[pid] or {pid}) for pid in party_ids]
        parties.sort(key=lambda p: (p["id"] not in winning, -next((r["seats"] for r in national["results"] if r["partyId"] == p["id"]), 0), p["short"]))
        result_url = "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2023-18907" if election_id.startswith("2023") else (
            "https://www.juntaelectoralcentral.es/cs/jec/documentos/Generales_2019-R_Resultados.pdf" if election_id.endswith("11-10") else
            "https://www.juntaelectoralcentral.es/cs/jec/documentos/GENERALES_2019_Resultados.pdf"
        )
        elections.append({
            "id": election_id, "date": election_id, "label": ELECTION_LABELS[election_id],
            "parties": parties, "national": national, "regions": regions, "provinces": provinces,
            "provenance": {
                "resultPublisher": "Junta Electoral Central / Boletín Oficial del Estado",
                "resultUrl": result_url,
                "finalStatus": "Definitive results including CERA",
                "retrieved": "2026-08-29",
                "transformations": [
                    "Province results normalized to INE two-digit province codes",
                    "Vote shares calculated over valid ballots, including blank ballots",
                    "Autonomous-community and national totals derived from province results",
                    "Seat allocations checked against the published 350-seat result",
                ],
            },
        })

    if args.geographic_layout:
        reviewed = json.loads(args.geographic_layout.read_text(encoding="utf-8"))
        layout_2019 = [dict(cell) for cell in reviewed["cells"]]
    else:
        legacy_name_to_code = dict(name_to_code)
        seed = read_legacy_seed(args.legacy_html, legacy_name_to_code, region_by_province)
        compact_inset(seed, "38", (0, -4))
        compact_inset(seed, "35", (6, -4))
        compact_inset(seed, "07", (47, -11))
        layout_2019 = [dict(c) for c in seed]
        move_seat(layout_2019, ["33", "09", "26", "50", "22", "25", "08"])
        move_seat(layout_2019, ["46", "16", "28"])
    layout_2023 = [dict(c) for c in layout_2019]
    move_seat(layout_2023, ["06", "14", "13", "02", "46"] if args.geographic_layout else ["06", "28", "02", "46"])

    layouts = []
    for election_id, base in [("2023-07-23", layout_2023), ("2019-11-10", layout_2019), ("2019-04-28", layout_2019)]:
        cells = assign_parties([dict(c) for c in base], province_results_for_layout[election_id], election_id)
        layouts.append({"electionId": election_id, "cells": cells})

    dataset = {
        "schemaVersion": 1,
        "generatedAt": "2026-08-29T00:00:00Z",
        "elections": elections,
        "layouts": layouts,
        "layoutProvenance": {
            "publisher": "Instituto Geográfico Nacional / Centro Nacional de Información Geográfica",
            "sourceUrl": "https://centrodedescargas.cnig.es/CentroDescargas/detalleArchivo?sec=9000029",
            "method": "Official province polygons rasterized to a regular hexagonal mosaic and assigned with exact seat capacities under position, outline and connectivity constraints" if args.geographic_layout else "Legacy 2016 reviewed seed",
            "license": "Obra derivada de BDLJE CC-BY 4.0 ign.es",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, default=Path("data/source/raw"))
    parser.add_argument("--seats", type=Path, required=True)
    parser.add_argument("--jec-2019-11", type=Path, required=True)
    parser.add_argument("--jec-2019-04", type=Path, required=True)
    parser.add_argument("--boe-2023-results", type=Path, required=True)
    parser.add_argument("--boe-2023-summary", type=Path, required=True)
    parser.add_argument("--legacy-html", type=Path, required=True)
    parser.add_argument("--geographic-layout", type=Path)
    parser.add_argument("--output", type=Path, default=Path("src/data/generated.json"))
    build(parser.parse_args())


if __name__ == "__main__": main()

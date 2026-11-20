#!/usr/bin/env python3
"""One-time (once a year) builder for the bracket model's history file.

For every Selection Sunday since 2015 it records each team's Torvik rank and
Wins Above Bubble *as of that day* (from Torvik's published time-machine files)
and the seed the team actually received.

Writes scripts/history/selection_sunday.csv, which is committed to the repo, so
the nightly update never needs these sources.

Seeds come from cbbdata (2015-2025, needs CBD_API_KEY and `pip install pyarrow`)
and ESPN tournament games (2026 on). To add a new season after the tournament,
add its Selection Sunday to SELECTION_SUNDAYS and rerun.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from update_data import ESPN, TeamMatcher, fetch, load_espn_teams, log  # noqa: E402

OUT = Path(__file__).parent / "history" / "selection_sunday.csv"

SELECTION_SUNDAYS = {
    2015: "20150315", 2016: "20160313", 2017: "20170312", 2018: "20180311", 2019: "20190317",
    2021: "20210314", 2022: "20220313", 2023: "20230312", 2024: "20240317", 2025: "20250316",
    2026: "20260315",
}
# First Four + first round dates, used to read seeds off ESPN's tournament games.
ESPN_SEED_DATES = {2026: ["20260317", "20260318", "20260319", "20260320"]}


def torvik_snapshot(date: str) -> list[list]:
    url = f"https://barttorvik.com/timemachine/team_results/{date}_team_results.json.gz"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hoops-resume)"})
    raw = urllib.request.urlopen(req, timeout=60).read()
    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass  # already plain JSON
    return json.loads(raw)


def cbbdata_seeds(year: int) -> dict[str, int]:
    import pyarrow.parquet as pq  # only needed for this one-off build

    key = os.environ["CBD_API_KEY"]
    url = f"https://www.cbbdata.com/api/torvik/ratings?year={year}&key={key}"
    data = urllib.request.urlopen(url, timeout=120).read()
    rows = pq.read_table(io.BytesIO(data)).to_pylist()
    return {r["team"]: int(r["seed"]) for r in rows if r.get("seed")}


def espn_seeds(dates: list[str]) -> dict[str, int]:
    """ESPN team id -> seed, read from tournament games (curatedRank is the seed there)."""
    seeds = {}
    for d in dates:
        data = fetch(f"{ESPN}/scoreboard?dates={d}&groups=100&limit=100")
        for ev in data.get("events", []):
            for c in ev["competitions"][0]["competitors"]:
                rank = (c.get("curatedRank") or {}).get("current")
                if rank and rank <= 16:
                    seeds[c["id"]] = rank
    return seeds


def main() -> int:
    matcher = TeamMatcher(load_espn_teams())
    rows_out = []
    for year, date in SELECTION_SUNDAYS.items():
        snap = torvik_snapshot(date)
        if year in ESPN_SEED_DATES:
            by_id = espn_seeds(ESPN_SEED_DATES[year])
            seed_of = lambda name: by_id.get(matcher.find(name) or "")  # noqa: E731
        else:
            by_name = cbbdata_seeds(year)
            seed_of = by_name.get
        n_seeded = 0
        for r in snap:
            seed = seed_of(r[1])
            n_seeded += bool(seed)
            rows_out.append({
                "year": year, "team": r[1], "espn_id": matcher.find(r[1]) or "", "conf": r[2],
                "record": r[3], "trank": int(r[0]), "wab": round(float(r[41]), 2), "wab_rank": int(r[42]),
                "seed": seed or "",
            })
        log(f"{year}: {len(snap)} teams, {n_seeded} seeded")
        if n_seeded < 64:
            log(f"  WARNING: expected 68 seeded teams for {year}")
    OUT.parent.mkdir(exist_ok=True)
    with OUT.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows_out[0]))
        w.writeheader()
        w.writerows(rows_out)
    log(f"Wrote {len(rows_out)} rows to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Bracket projection model (Python standard library only).

Learns from scripts/history/selection_sunday.csv how teams' Selection Sunday
rankings translated into (a) getting an at-large bid and (b) their seed, then
applies that to this season's rankings to build a projected 68-team seed list
and a bubble watch.

Features are *ranks*, not raw values, so they compare fairly in mid-season,
when raw numbers like Wins Above Bubble are still small:
  * WAB rank     - Wins Above Bubble, a results-based metric on the committee's team sheet
  * Torvik rank  - T-Rank, a predictive metric on the committee's team sheet
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from pathlib import Path

HISTORY = Path(__file__).parent / "history" / "selection_sunday.csv"
FIELD_SIZE = 68
FIRST_FOUR_AT_LARGE = 4   # last four at-large teams in play in the First Four
FIRST_FOUR_AUTO = 4       # lowest four automatic qualifiers play in the First Four (16 seeds)


def features(wab_rank, trank):
    return [math.log(max(1, wab_rank)), math.log(max(1, trank))]


# --------------------------------------------------------------------------- #
# Tiny regression helpers
# --------------------------------------------------------------------------- #
def _solve(a, b):
    """Solve a small linear system with Gaussian elimination."""
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                m[r] = [x - f * y for x, y in zip(m[r], m[col])]
    return [m[i][n] / m[i][i] for i in range(n)]


def fit_linear(xs, ys):
    """Least squares with an intercept. Returns [b0, b1, ...]."""
    rows = [[1.0] + x for x in xs]
    k = len(rows[0])
    xtx = [[sum(r[i] * r[j] for r in rows) for j in range(k)] for i in range(k)]
    xty = [sum(r[i] * y for r, y in zip(rows, ys)) for i in range(k)]
    return _solve(xtx, xty)


def fit_logistic(xs, ys, iters=60):
    """Logistic regression by Newton's method. Returns [b0, b1, ...]."""
    rows = [[1.0] + x for x in xs]
    k = len(rows[0])
    w = [0.0] * k
    for _ in range(iters):
        grad = [0.0] * k
        hess = [[1e-6 if i == j else 0.0 for j in range(k)] for i in range(k)]
        for r, y in zip(rows, ys):
            p = 1 / (1 + math.exp(-max(-30, min(30, sum(a * b for a, b in zip(w, r))))))
            for i in range(k):
                grad[i] += (y - p) * r[i]
                for j in range(k):
                    hess[i][j] += p * (1 - p) * r[i] * r[j]
        step = _solve(hess, grad)
        w = [a + b for a, b in zip(w, step)]
        if max(abs(s) for s in step) < 1e-8:
            break
    return w


def _dot(w, x):
    return w[0] + sum(a * b for a, b in zip(w[1:], x))


def prob(w, x):
    return 1 / (1 + math.exp(-max(-30, min(30, _dot(w, x)))))


# --------------------------------------------------------------------------- #
# History
# --------------------------------------------------------------------------- #
def load_history():
    rows = []
    with HISTORY.open() as f:
        for r in csv.DictReader(f):
            rows.append({
                "year": int(r["year"]), "team": r["team"], "conf": r["conf"],
                "trank": int(r["trank"]), "wab_rank": int(r["wab_rank"]),
                "seed": int(r["seed"]) if r["seed"] else None,
            })
    return rows


def auto_bids_in_history(year_rows):
    """Best guess at each conference's automatic qualifier in a past field.

    One-bid conferences: their only team. Multi-bid: the worst-seeded team (usually the
    champion of a low-major, or a team that would have been an at-large anyway)."""
    by_conf = defaultdict(list)
    for r in year_rows:
        if r["seed"]:
            by_conf[r["conf"]].append(r)
    return {max(v, key=lambda r: (r["seed"], r["wab_rank"]))["team"] for v in by_conf.values()}


def train(rows):
    sel_x, sel_y, seed_x, seed_y = [], [], [], []
    for year in sorted({r["year"] for r in rows}):
        yr = [r for r in rows if r["year"] == year]
        autos = auto_bids_in_history(yr)
        for r in yr:
            x = features(r["wab_rank"], r["trank"])
            if r["seed"]:
                seed_x.append(x)
                seed_y.append(r["seed"])
            if r["team"] not in autos:
                sel_x.append(x)
                sel_y.append(1 if r["seed"] else 0)
    return {"select": fit_logistic(sel_x, sel_y), "seed": fit_linear(seed_x, seed_y)}


# --------------------------------------------------------------------------- #
# Projection
# --------------------------------------------------------------------------- #
def project(teams, model, auto_ids):
    """teams: list of dicts with id, conf, wab_rank, trank.
    auto_ids: the projected automatic qualifier for each conference.
    Returns (field, bubble) where field is the ordered seed list."""
    for t in teams:
        x = features(t["wab_rank"], t["trank"])
        t["chance"] = prob(model["select"], x)
        t["seedScore"] = _dot(model["seed"], x)

    autos = [t for t in teams if t["id"] in auto_ids]
    n_at_large = FIELD_SIZE - len(autos)
    pool = sorted((t for t in teams if t["id"] not in auto_ids), key=lambda t: -t["chance"])
    at_large = pool[:n_at_large]
    out = pool[n_at_large:]
    for t in autos:
        t["bid"] = "auto"
    for t in at_large:
        t["bid"] = "at-large"

    # First Four: the last four at-large teams in, and the four lowest automatic qualifiers.
    last_in = sorted(at_large, key=lambda t: t["chance"])[:FIRST_FOUR_AT_LARGE]
    low_autos = sorted(autos, key=lambda t: -t["seedScore"])[:FIRST_FOUR_AUTO]

    # Build 64 slots: First Four pairs share one slot each.
    def pairs(group):
        g = sorted(group, key=lambda t: t["seedScore"])
        return [g[i:i + 2] for i in range(0, len(g), 2)]

    paired = {t["id"] for t in last_in + low_autos}
    slots = [[t] for t in autos + at_large if t["id"] not in paired] + pairs(last_in) + pairs(low_autos)
    slots.sort(key=lambda s: sum(t["seedScore"] for t in s) / len(s))
    # The 16 line is reserved for the weakest teams; the First Four auto pairs must land there.
    for i, slot in enumerate(slots):
        seed = i // 4 + 1
        for t in slot:
            t["seed"] = seed
            t["firstFour"] = len(slot) == 2

    field = sorted((t for s in slots for t in s), key=lambda t: (t["seed"], t["seedScore"]))
    for i, t in enumerate(field, 1):
        t["overall"] = i

    bubble = {
        "lastFourByes": sorted(at_large, key=lambda t: t["chance"])[4:8][::-1],
        "lastFourIn": last_in[::-1],
        "firstFourOut": out[:4],
        "nextFourOut": out[4:8],
    }
    return field, bubble


# --------------------------------------------------------------------------- #
# Backtest + historical guide
# --------------------------------------------------------------------------- #
def backtest(rows):
    """Leave one season out: train on the others, predict that season's field."""
    picked = total = seed_exact = seed_within1 = n_seed = 0
    for year in sorted({r["year"] for r in rows}):
        model = train([r for r in rows if r["year"] != year])
        yr = [dict(r, id=r["team"]) for r in rows if r["year"] == year]
        autos = auto_bids_in_history(yr)
        real_seed = {r["team"]: r["seed"] for r in yr}
        actual_at_large = {r["team"] for r in yr if r["seed"] and r["team"] not in autos}
        field, _ = project(yr, model, autos)
        predicted_at_large = {t["team"] for t in field if t["bid"] == "at-large"}
        picked += len(actual_at_large & predicted_at_large)
        total += len(actual_at_large)
        for t in field:
            real = real_seed.get(t["team"])
            if real:
                n_seed += 1
                seed_exact += t["seed"] == real
                seed_within1 += abs(t["seed"] - real) <= 1
    return {
        "seasons": len({r["year"] for r in rows}),
        "atLargePicked": picked, "atLargeTotal": total,
        "seedExactPct": round(100 * seed_exact / n_seed),
        "seedWithin1Pct": round(100 * seed_within1 / n_seed),
    }


def guide(rows):
    """For rank buckets, the share of teams that made the field and their average seed."""
    buckets = [(1, 4), (5, 8), (9, 12), (13, 16), (17, 20), (21, 25), (26, 30), (31, 35),
               (36, 40), (41, 45), (46, 50), (51, 60), (61, 75), (76, 100)]
    out = []
    for lo, hi in buckets:
        row = {"range": f"{lo}–{hi}"}
        for key, label in (("wab_rank", "wab"), ("trank", "torvik")):
            grp = [r for r in rows if lo <= r[key] <= hi]
            seeds = [r["seed"] for r in grp if r["seed"]]
            row[label] = {
                "inField": round(100 * len(seeds) / len(grp)) if grp else None,
                "avgSeed": round(sum(seeds) / len(seeds), 1) if seeds else None,
            }
        out.append(row)
    return out


if __name__ == "__main__":
    hist = load_history()
    print("model:", train(hist))
    print("backtest:", backtest(hist))
    for g in guide(hist):
        print(g)

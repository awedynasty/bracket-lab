"""Bracket projection model (Python standard library only).

Learns from scripts/history/selection_sunday.csv how teams' Selection Sunday
rankings translated into (a) getting an at-large bid and (b) their seed, then
applies that to this season's rankings to build a projected 68-team seed list
and a bubble watch.

Features are log *ranks*, not raw values, so they compare fairly in mid-season,
when raw numbers like Wins Above Bubble are still small.

Backtests on 2019-2026 picked these sets (see SELECT_FEATURES / SEED_FEATURES):
  * Who gets an at-large bid: WAB + Torvik. Adding NET, SOR, BPI, KenPom or KPI
    didn't pick any more teams correctly.
  * Seeding: WAB + Torvik + NET + SOR (exact seed 49% -> 52%, within one line 87% -> 89%).
    KenPom/KPI help seeding by about one more point, but there's no free daily feed for
    them, so they only appear in the historical guide.
"""

from __future__ import annotations

import csv
import math
from collections import defaultdict
from pathlib import Path

HISTORY = Path(__file__).parent / "history" / "selection_sunday.csv"
# Tournament formats. From 2027 the field is 76: 32 automatic bids + 44 at-large, with a
# 12-game opening round (the 12 lowest automatic qualifiers play each other and fill the 16
# line plus half the 15 line; the 12 lowest at-large teams play each other). Past seasons
# were 68 teams with a 4-game First Four, so the backtest uses that format.
FORMAT_76 = {"field": 76, "openAtLarge": 12, "openAuto": 12}
FORMAT_68 = {"field": 68, "openAtLarge": 4, "openAuto": 4}
CURRENT_FORMAT = FORMAT_76
FIELD_SIZE = CURRENT_FORMAT["field"]


SELECT_FEATURES = ["wab_rank", "trank"]
SEED_FEATURES = ["wab_rank", "trank", "net", "sor"]
GUIDE_SYSTEMS = [("wab_rank", "WAB"), ("trank", "Torvik"), ("net", "NET"), ("sor", "SOR"),
                 ("kenpom", "KenPom"), ("bpi", "BPI"), ("kpi", "KPI")]
MISSING_RANK = 360  # stand-in for a team with no rank in a system


def features(row, feats):
    return [math.log(max(1, row.get(f) or MISSING_RANK)) for f in feats]


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
            row = {"year": int(r["year"]), "team": r["team"], "conf": r["conf"],
                   "seed": int(r["seed"]) if r["seed"] else None}
            for key, _ in GUIDE_SYSTEMS:
                row[key] = int(r[key]) if r.get(key) else None
            rows.append(row)
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


def train(rows, select_feats=SELECT_FEATURES, seed_feats=SEED_FEATURES):
    """Fits the selection model on select_feats and the seeding model on seed_feats.
    Seasons missing a feature (e.g. NET before 2019) are left out of that model."""
    sel_x, sel_y, seed_x, seed_y = [], [], [], []
    for year in sorted({r["year"] for r in rows}):
        yr = [r for r in rows if r["year"] == year]
        autos = auto_bids_in_history(yr)
        for r in yr:
            if r["seed"] and all(r.get(f) for f in seed_feats):
                seed_x.append(features(r, seed_feats))
                seed_y.append(r["seed"])
            if r["team"] not in autos and all(r.get(f) for f in select_feats):
                sel_x.append(features(r, select_feats))
                sel_y.append(1 if r["seed"] else 0)
    return {"select": fit_logistic(sel_x, sel_y), "seed": fit_linear(seed_x, seed_y),
            "selectFeatures": list(select_feats), "seedFeatures": list(seed_feats)}


# --------------------------------------------------------------------------- #
# Projection
# --------------------------------------------------------------------------- #
def _calibrate_chances(pool, w, feats, slots):
    """Shift the selection model's baseline so the expected number of at-large bids equals
    the slots available (36 in the old format, 44 in the 76-team format)."""
    xs = [features(t, feats) for t in pool]
    lo, hi = -15.0, 15.0
    for _ in range(50):
        mid = (lo + hi) / 2
        total = sum(prob([w[0] + mid] + w[1:], x) for x in xs)
        lo, hi = (mid, hi) if total < slots else (lo, mid)
    return (lo + hi) / 2


def project(teams, model, auto_ids, given_chance=False, fmt=None):
    """teams: list of dicts with id, conf and the model's rank columns.
    auto_ids: the projected automatic qualifier for each conference.
    given_chance: use each team's existing "chance" (e.g. simulated odds) to pick at-large teams.
    fmt: tournament format (defaults to CURRENT_FORMAT).
    Returns (field, bubble) where field is the ordered seed list."""
    fmt = fmt or CURRENT_FORMAT
    for t in teams:
        t["seedScore"] = _dot(model["seed"], features(t, model["seedFeatures"]))

    autos = [t for t in teams if t["id"] in auto_ids]
    n_at_large = fmt["field"] - len(autos)
    others = [t for t in teams if t["id"] not in auto_ids]
    if not given_chance:
        w, feats = model["select"], model["selectFeatures"]
        shift = _calibrate_chances(others, w, feats, n_at_large)
        for t in teams:  # every team (auto bids too) gets at-large odds on the same scale
            t["chance"] = prob([w[0] + shift] + w[1:], features(t, feats))
    pool = sorted(others, key=lambda t: -t["chance"])
    at_large = pool[:n_at_large]
    out = pool[n_at_large:]
    for t in autos:
        t["bid"] = "auto"
    for t in at_large:
        t["bid"] = "at-large"

    # Opening round: the lowest-seeded at-large teams and the lowest-seeded automatic qualifiers.
    by_chance = sorted(at_large, key=lambda t: t["chance"])
    by_seed = sorted(at_large, key=lambda t: -t["seedScore"])  # worst seed first
    open_at_large = by_seed[:fmt["openAtLarge"]]
    open_autos = sorted(autos, key=lambda t: -t["seedScore"])[:fmt["openAuto"]]

    # Build 64 slots: each opening-round pair shares one slot.
    def pairs(group):
        g = sorted(group, key=lambda t: t["seedScore"])
        return [g[i:i + 2] for i in range(0, len(g), 2)]

    paired = {t["id"] for t in open_at_large + open_autos}
    slots = [[t] for t in autos + at_large if t["id"] not in paired] + pairs(open_at_large)
    slots.sort(key=lambda s: sum(t["seedScore"] for t in s) / len(s))
    slots += pairs(open_autos)  # automatic-bid pairs always fill the bottom lines (16s, then 15s)
    for i, slot in enumerate(slots):
        seed = i // 4 + 1
        for t in slot:
            t["seed"] = seed
            t["firstFour"] = len(slot) == 2  # plays in the opening round

    field = sorted((t for s in slots for t in s), key=lambda t: (t["seed"], t["seedScore"]))
    for i, t in enumerate(field, 1):
        t["overall"] = i

    k = fmt["openAtLarge"]
    bubble = {
        # lowest-seeded at-large teams that skip the opening round (not also listed as last in)
        "lastFourByes": [t for t in by_seed[k:] if t not in by_chance[:4]][:4][::-1],
        "lastFourIn": by_chance[:4][::-1],
        "firstFourOut": out[:4],
        "nextFourOut": out[4:8],
    }
    return field, bubble


# --------------------------------------------------------------------------- #
# Backtest + historical guide
# --------------------------------------------------------------------------- #
def backtest(rows, select_feats=SELECT_FEATURES, seed_feats=SEED_FEATURES):
    """Leave one season out: train on the others, predict that season's field.
    Only seasons with every feature available are tested."""
    feats = set(select_feats) | set(seed_feats)
    years = [y for y in sorted({r["year"] for r in rows})
             if sum(1 for r in rows if r["year"] == y and r["seed"] and all(r.get(f) for f in feats)) >= 60]
    picked = total = seed_exact = seed_within1 = n_seed = 0
    for year in years:
        model = train([r for r in rows if r["year"] != year], select_feats, seed_feats)
        yr = [dict(r, id=r["team"]) for r in rows if r["year"] == year]
        autos = auto_bids_in_history(yr)
        real_seed = {r["team"]: r["seed"] for r in yr}
        actual_at_large = {r["team"] for r in yr if r["seed"] and r["team"] not in autos}
        field, _ = project(yr, model, autos, fmt=FORMAT_68)
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
        "seasons": years,
        "atLargePicked": picked, "atLargeTotal": total,
        "seedExactPct": round(100 * seed_exact / n_seed),
        "seedWithin1Pct": round(100 * seed_within1 / n_seed),
    }


def guide(rows):
    """For rank buckets in each system: share of teams that made the field, and their average seed."""
    buckets = [(1, 4), (5, 8), (9, 12), (13, 16), (17, 20), (21, 25), (26, 30), (31, 35),
               (36, 40), (41, 45), (46, 50), (51, 60), (61, 75), (76, 100)]
    out = []
    for lo, hi in buckets:
        row = {"range": f"{lo}–{hi}"}
        for key, label in GUIDE_SYSTEMS:
            grp = [r for r in rows if r.get(key) and lo <= r[key] <= hi]
            seeds = [r["seed"] for r in grp if r["seed"]]
            row[label] = {
                "inField": round(100 * len(seeds) / len(grp)) if grp else None,
                "avgSeed": round(sum(seeds) / len(seeds), 1) if seeds else None,
            }
        out.append(row)
    return out


def guide_seasons(rows):
    """Which seasons each guide column is based on."""
    return {label: sorted({r["year"] for r in rows if r.get(key) and r["seed"]}) for key, label in GUIDE_SYSTEMS}


if __name__ == "__main__":
    hist = load_history()
    print("model:", train(hist))
    print("backtest:", backtest(hist))
    print("old model backtest:", backtest(hist, SELECT_FEATURES, ["wab_rank", "trank"]))

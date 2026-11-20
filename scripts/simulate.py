"""Season simulator (Python standard library only).

1. Predicts every remaining game from Torvik's adjusted offense, defense and tempo,
   with a home-court edge.
2. Plays out the rest of the season many times (N_SIMS) for every D1 team at once.
3. In each simulated season, recomputes Wins Above Bubble, picks conference champions and
   runs the bracket model, so each team gets odds of making the field and of each seed.
"""

from __future__ import annotations

import math
import random
from collections import Counter, defaultdict

N_SIMS = 5000
HOME_EDGE = 3.0      # points
MARGIN_SD = 11.0     # typical spread of actual margins around the prediction
BUBBLE_RANK = 60     # this bubble-team strength reproduces Torvik's published WAB within ~0.1 wins
NON_D1_WIN = 0.98    # chance a D1 team beats a non-D1 opponent


def normal_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


class Predictor:
    def __init__(self, teams: list[dict], bubble_rank: int = BUBBLE_RANK):
        self.r = {t["id"]: (t["adjO"], t["adjD"], t["tempo"]) for t in teams
                  if t.get("adjO") and t.get("adjD") and t.get("tempo")}
        vals = list(self.r.values())
        self.avg_eff = sum(v[0] for v in vals) / len(vals)
        self.avg_tempo = sum(v[2] for v in vals) / len(vals)
        # The "bubble team": average ratings of teams ranked around bubble_rank by Torvik.
        near = [t for t in teams if t.get("trank") and abs(t["trank"] - bubble_rank) <= 3 and t["id"] in self.r]
        self.bubble = tuple(sum(self.r[t["id"]][i] for t in near) / len(near) for i in range(3))

    def margin(self, a, b, loc):
        """Expected margin for ratings a vs b; loc is a's site: H, A or N."""
        poss = a[2] * b[2] / self.avg_tempo
        pts_a = a[0] * b[1] / self.avg_eff * poss / 100
        pts_b = b[0] * a[1] / self.avg_eff * poss / 100
        edge = HOME_EDGE if loc == "H" else -HOME_EDGE if loc == "A" else 0
        return pts_a - pts_b + edge

    def win_prob(self, a_id, b_id, loc):
        if a_id not in self.r or b_id not in self.r:
            return None
        return normal_cdf(self.margin(self.r[a_id], self.r[b_id], loc) / MARGIN_SD)

    def bubble_win_prob(self, opp_id, loc):
        """Chance a bubble-quality team would win this game in the same spot."""
        if opp_id not in self.r:
            return None
        return normal_cdf(self.margin(self.bubble, self.r[opp_id], loc) / MARGIN_SD)


def simulate(teams, games_by_team, predictor, bracket_model_module, model, n_sims=N_SIMS, seed=7):
    """Returns (per-team projection dict, projected field, projected bubble)."""
    bm = bracket_model_module
    rng = random.Random(seed)
    by_id = {t["id"]: t for t in teams}
    flip = {"H": "A", "A": "H", "N": "N"}

    # Unique remaining games. Each is (team a, team b or None for non-D1, P(a wins), WAB swing for a/b, conf game?)
    games, seen = [], set()
    for tid, glist in games_by_team.items():
        for g in glist:
            if g["final"] or g["id"] in seen:
                continue
            seen.add(g["id"])
            opp = g["oppId"] if g["oppId"] in by_id else None
            p = predictor.win_prob(tid, opp, g["loc"]) if opp else NON_D1_WIN
            p = 0.5 if p is None else p
            g["winProb"] = round(p, 3)
            pb_a = predictor.bubble_win_prob(opp, g["loc"]) if opp else None
            pb_b = predictor.bubble_win_prob(tid, flip[g["loc"]]) if opp else None
            conf = bool(opp) and by_id[tid]["conf"] == by_id[opp]["conf"] and by_id[tid]["conf"] not in ("Independent", "Independents")
            games.append((tid, opp, p, pb_a, pb_b, conf))
            if opp:  # mirror the win probability onto the opponent's copy of the game
                for og in games_by_team.get(opp, []):
                    if og["id"] == g["id"]:
                        og["winProb"] = round(1 - p, 3)

    ids = [t["id"] for t in teams if t.get("trank") and t.get("wab") is not None]
    idx = {tid: i for i, tid in enumerate(ids)}
    n = len(ids)
    base_w = [by_id[t]["wins"] for t in ids]
    base_l = [by_id[t]["losses"] for t in ids]
    base_cw = [by_id[t]["confWins"] for t in ids]
    base_cl = [by_id[t]["confLosses"] for t in ids]
    base_wab = [by_id[t]["wab"] for t in ids]
    trank = [by_id[t]["trank"] for t in ids]
    conf_of = [by_id[t]["conf"] for t in ids]
    conf_members = defaultdict(list)
    for i, c in enumerate(conf_of):
        if c not in ("Independent", "Independents"):
            conf_members[c].append(i)

    sum_w = [0.0] * n
    sum_cw = [0.0] * n
    sum_cl = [0.0] * n
    sum_wab = [0.0] * n
    titles = [0.0] * n
    in_field = [0] * n
    auto = [0] * n
    seeds = [Counter() for _ in range(n)]

    sim_games = [(idx.get(a), idx.get(b) if b else None, p, pa, pb, c) for a, b, p, pa, pb, c in games]
    for _ in range(n_sims):
        w, l = base_w[:], base_l[:]
        cw, cl = base_cw[:], base_cl[:]
        wab = base_wab[:]
        for ia, ib, p, pa, pb, conf in sim_games:
            a_won = rng.random() < p
            if ia is not None:
                if a_won:
                    w[ia] += 1
                else:
                    l[ia] += 1
                if pa is not None:
                    wab[ia] += (1 - pa) if a_won else -pa
                if conf:
                    if a_won:
                        cw[ia] += 1
                    else:
                        cl[ia] += 1
            if ib is not None:
                if a_won:
                    l[ib] += 1
                else:
                    w[ib] += 1
                if pb is not None:
                    wab[ib] += -pb if a_won else (1 - pb)
                if conf:
                    if a_won:
                        cl[ib] += 1
                    else:
                        cw[ib] += 1

        # Conference champions: best conference win% (ties shared for title odds; Torvik rank breaks ties for the bid).
        autos = set()
        for members in conf_members.values():
            pct = {i: cw[i] / (cw[i] + cl[i]) if cw[i] + cl[i] else 0 for i in members}
            best = max(pct.values())
            leaders = [i for i in members if pct[i] == best]
            for i in leaders:
                titles[i] += 1 / len(leaders)
            autos.add(min(leaders, key=lambda i: trank[i]))

        order = sorted(range(n), key=lambda i: -wab[i])
        wab_rank = [0] * n
        for r, i in enumerate(order, 1):
            wab_rank[i] = r
        rows = [{"id": i, "conf": conf_of[i], "wab_rank": wab_rank[i], "trank": trank[i]} for i in range(n)]
        field, _ = bm.project(rows, model, autos)
        for r in field:
            i = r["id"]
            in_field[i] += 1
            seeds[i][r["seed"]] += 1
            auto[i] += r["bid"] == "auto"

        for i in range(n):
            sum_w[i] += w[i]
            sum_cw[i] += cw[i]
            sum_cl[i] += cl[i]
            sum_wab[i] += wab[i]

    proj = {}
    for i, tid in enumerate(ids):
        games_total = base_w[i] + base_l[i] + sum(
            1 for g in games_by_team.get(tid, []) if not g["final"])
        wins = sum_w[i] / n_sims
        proj[tid] = {
            "wins": round(wins, 1),
            "losses": round(games_total - wins, 1),
            "confWins": round(sum_cw[i] / n_sims, 1),
            "confLosses": round(sum_cl[i] / n_sims, 1),
            "confTitle": round(titles[i] / n_sims, 3),
            "wab": round(sum_wab[i] / n_sims, 1),
            "inField": round(in_field[i] / n_sims, 3),
            "autoBid": round(auto[i] / n_sims, 3),
            "seedOdds": [round(seeds[i][s] / n_sims, 3) for s in range(1, 17)],
        }
    # Expected final WAB rank
    for r, tid in enumerate(sorted(proj, key=lambda t: -proj[t]["wab"]), 1):
        proj[tid]["wabRank"] = r

    # One projected field: each conference's most likely champion gets the automatic bid, the
    # at-large teams are those most often in the field across simulations, and seeding uses
    # expected final WAB rank + Torvik rank.
    auto_ids = set()
    for members in conf_members.values():
        auto_ids.add(ids[max(members, key=lambda i: (titles[i], -trank[i]))])
    rows = [{"id": tid, "conf": by_id[tid]["conf"], "wab_rank": proj[tid]["wabRank"], "trank": by_id[tid]["trank"],
             "chance": proj[tid]["inField"]} for tid in ids]
    field, _ = bm.project(rows, model, auto_ids, given_chance=True)
    for r in field:
        proj[r["id"]]["projSeed"] = r["seed"]
    pool = sorted((r for r in rows if r["id"] not in auto_ids), key=lambda r: -r["chance"])
    in_ids = {r["id"] for r in field if r["bid"] == "at-large"}
    ins = [r for r in pool if r["id"] in in_ids]
    outs = [r for r in pool if r["id"] not in in_ids]
    bubble = {
        "lastFourByes": ins[-8:-4],
        "lastFourIn": ins[-4:],
        "firstFourOut": outs[:4],
        "nextFourOut": outs[4:8],
    }
    return proj, field, bubble, games


def calibrate(teams, games_by_team, predictor_cls):
    """How well our game model matches finished games, and which bubble rank reproduces Torvik's WAB."""
    by_id = {t["id"]: t for t in teams}
    out = {}
    pred = predictor_cls(teams)
    ll = n = correct = 0
    for tid, glist in games_by_team.items():
        for g in glist:
            if g["final"] and g["oppId"] in by_id:
                p = pred.win_prob(tid, g["oppId"], g["loc"])
                if p is None:
                    continue
                y = g["result"] == "W"
                ll -= math.log(max(1e-6, p if y else 1 - p))
                correct += (p > 0.5) == y
                n += 1
    out["games"] = n
    out["accuracy"] = round(correct / n, 3) if n else None
    out["logLoss"] = round(ll / n, 3) if n else None
    best = None
    for k in range(25, 76, 5):
        pk = predictor_cls(teams, bubble_rank=k)
        err = cnt = 0
        for tid, glist in games_by_team.items():
            t = by_id.get(tid)
            if not t or t.get("wab") is None:
                continue
            ours = 0
            for g in glist:
                if g["final"] and g["oppId"] in by_id:
                    pb = pk.bubble_win_prob(g["oppId"], g["loc"])
                    if pb is not None:
                        ours += (1 - pb) if g["result"] == "W" else -pb
            err += (ours - t["wab"]) ** 2
            cnt += 1
        rmse = math.sqrt(err / cnt)
        if best is None or rmse < best[1]:
            best = (k, rmse)
    out["bubbleRank"], out["wabRmse"] = best[0], round(best[1], 3)
    return out

#!/usr/bin/env python3
"""Nightly data update for Nasta's Bracket Lab.

Pulls data for every Division I men's basketball team and writes JSON files
into docs/data/, which the website reads.

Sources
  * SportsDataIO  - team list, conferences, colors, records, AP rank
                    (needs the SPORTSDATA_KEY environment variable)
  * ESPN          - game-by-game schedules/results, logos, BPI, SOR, SOS
  * NCAA.com      - NET rankings (used for quads once the season's NET is out)
  * Barttorvik    - T-Rank and Wins Above Bubble (Torvik's published season CSV)

Run it with:   SPORTSDATA_KEY=yourkey python3 scripts/update_data.py
Uses only the Python standard library, so there is nothing to install.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
ALIASES = json.loads((Path(__file__).parent / "team_aliases.json").read_text())

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
ESPN_BPI = "https://site.web.api.espn.com/apis/fitt/v3/sports/basketball/mens-college-basketball/powerindex?limit=500"
NET_URL = "https://www.ncaa.com/rankings/basketball-men/d1/ncaa-mens-basketball-net-rankings"
SDIO = "https://api.sportsdata.io/v3/cbb/scores/json"
EASTERN = ZoneInfo("America/New_York")

# NCAA quadrant cutoffs: the opponent's rank must be <= the number to fall in
# that quad. Order: Quad 1, Quad 2, Quad 3 (anything worse is Quad 4).
QUAD_CUTOFFS = {
    "H": (30, 75, 160),   # home
    "N": (50, 100, 200),  # neutral site
    "A": (75, 135, 240),  # away
}


# Short labels for conference names (anything not listed shows as-is).
CONF_SHORT = {
    "American": "AAC", "Atlantic Coast": "ACC", "Atlantic Sun": "ASUN", "Atlantic 10": "A-10",
    "Coastal Athletic Association": "CAA", "Conference USA": "CUSA", "Horizon League": "Horizon",
    "Ivy League": "Ivy", "The Metro": "MAAC", "Mid-American": "MAC", "Mid-Eastern": "MEAC",
    "Missouri Valley": "MVC", "Mountain West": "MWC", "Northeast": "NEC", "Ohio Valley": "OVC",
    "Patriot League": "Patriot", "Southeastern": "SEC", "Southwestern Athletic": "SWAC",
    "West Coast": "WCC", "United Athletic": "UAC",
}


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def log(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str, *, as_json: bool = True, headers: dict | None = None, tries: int = 4):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (hoops-resume)", **(headers or {})})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                body = r.read().decode("utf-8")
            return json.loads(body) if as_json else body
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if isinstance(e, urllib.error.HTTPError) and e.code in (401, 403, 404):
                raise
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)


_ABBR = {
    "fla": "florida", "ill": "illinois", "mich": "michigan", "ky": "kentucky", "ark": "arkansas",
    "ariz": "arizona", "colo": "colorado", "tenn": "tennessee", "caro": "carolina", "ga": "georgia",
    "ala": "alabama", "ind": "indiana", "la": "louisiana", "mo": "missouri", "wash": "washington",
    "conn": "connecticut", "val": "valley", "miss": "mississippi", "okla": "oklahoma", "neb": "nebraska",
    "va": "virginia", "pa": "pennsylvania", "cal": "california", "u": "university", "col": "college",
}


def norm(name: str) -> str:
    """Normalize a school name so the different sources' spellings line up."""
    s = name.lower().replace("&", " and ").replace("é", "e").replace("-", " ")
    s = re.sub(r"\((ny|ca|nc|mn)\)", "", s)        # St. John's (NY) -> St. John's
    s = re.sub(r"\(([a-z]+)\)", r"\1", s)          # Miami (OH) -> Miami OH
    s = re.sub(r"[^a-z0-9. ]", "", s)
    words = []
    for i, w in enumerate(s.split()):
        base = w.rstrip(".")
        if base == "st":
            base = "saint" if i == 0 else "state"
        elif w.endswith("."):
            base = _ABBR.get(base, base)
        if base:
            words.append(base)
    return " ".join(words)


class TeamMatcher:
    """Finds the ESPN team id for a school name from another source."""

    def __init__(self, espn_teams: list[dict]):
        self.keys: dict[str, set[str]] = {}
        for t in espn_teams:
            for k in {t["location"], t["shortDisplayName"], t.get("nickname", ""), t["displayName"]}:
                if k:
                    self.keys.setdefault(norm(k), set()).add(t["id"])

    def find(self, name: str, mascot: str = "") -> str | None:
        if name in ALIASES:
            return ALIASES[name]
        for candidate in (f"{name} {mascot}".strip(), name):
            ids = self.keys.get(norm(candidate), set())
            if len(ids) == 1:
                return next(iter(ids))
        return None


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------- #
# Sources
# --------------------------------------------------------------------------- #
def load_espn_teams() -> list[dict]:
    data = fetch(f"{ESPN}/teams?limit=500")
    teams = [t["team"] for t in data["sports"][0]["leagues"][0]["teams"]]
    log(f"ESPN: {len(teams)} teams")
    return teams


def load_sportsdata(matcher: TeamMatcher) -> dict[str, dict]:
    """SportsDataIO team info, home arena and roster, keyed by ESPN id."""
    key = os.environ.get("SPORTSDATA_KEY", "").strip()
    if not key:
        log("SportsDataIO: SPORTSDATA_KEY not set - skipping (conferences fall back to ESPN)")
        return {}
    auth = {"Ocp-Apim-Subscription-Key": key}
    try:
        conferences = fetch(f"{SDIO}/LeagueHierarchy", headers=auth)
    except Exception as e:  # keep the site updating even if the key expires
        log(f"SportsDataIO: request failed ({e}) - skipping")
        return {}

    def optional(endpoint):
        try:
            return fetch(f"{SDIO}/{endpoint}", headers=auth)
        except Exception as e:
            log(f"SportsDataIO {endpoint}: request failed ({e}) - skipping")
            return []

    stadiums = {s["StadiumID"]: s for s in optional("Stadiums")}
    rosters: dict[int, list] = {}
    for p in optional("PlayersByActive"):
        rosters.setdefault(p.get("TeamID"), []).append(p)

    out, missed = {}, []
    for conf in conferences:
        for t in conf.get("Teams", []):
            if not t.get("Active", True):
                continue
            espn_id = matcher.find(t["School"], t.get("Name", ""))
            if not espn_id:
                missed.append(t["School"])
                continue
            arena = stadiums.get((t.get("Stadium") or {}).get("StadiumID")) or t.get("Stadium")
            out[espn_id] = {
                "conf": conf["Name"],
                "ap": t.get("ApRank"),
                "wins": t.get("Wins"),
                "losses": t.get("Losses"),
                "confWins": t.get("ConferenceWins"),
                "confLosses": t.get("ConferenceLosses"),
                "color": t.get("PrimaryColor"),
                "altColor": t.get("SecondaryColor"),
                "arena": {
                    "name": arena.get("Name"),
                    "city": ", ".join(x for x in (arena.get("City"), arena.get("State")) if x),
                    "capacity": arena.get("Capacity"),
                } if arena else None,
                "roster": [
                    {
                        "num": p.get("Jersey"),
                        "name": f"{p.get('FirstName', '')} {p.get('LastName', '')}".strip(),
                        "pos": p.get("Position"),
                        "cls": p.get("Class"),
                        "ht": p.get("Height"),
                        "wt": p.get("Weight"),
                        "home": ", ".join(x for x in (p.get("BirthCity"), p.get("BirthState")) if x),
                    }
                    for p in sorted(rosters.get(t["TeamID"], []), key=lambda p: (p.get("Jersey") is None, p.get("Jersey") or 0))
                ],
            }
    log(f"SportsDataIO: matched {len(out)} teams, {len(stadiums)} stadiums, "
        f"{sum(len(v['roster']) for v in out.values())} players" + (f", unmatched: {missed}" if missed else ""))
    return out


def load_bpi() -> dict[str, dict]:
    data = fetch(ESPN_BPI)
    cats = {c["name"]: c["names"] for c in data["categories"]}
    out = {}
    for row in data["teams"]:
        vals = {}
        for c in row["categories"]:
            names = cats.get(c["name"], [])
            vals.update({n: v for n, v in zip(names, c.get("values", []))})
        out[row["team"]["id"]] = {
            "bpi": round(vals["bpi"], 1) if vals.get("bpi") is not None else None,
            "bpiRank": to_int(vals.get("bpirank")),
            "sor": to_int(vals.get("sorrank")),
            "sos": to_int(vals.get("sospastrank")),
            "ncsos": to_int(vals.get("sosoutofconfpastrank")),
        }
    log(f"ESPN BPI: {len(out)} teams")
    return out


def load_net(matcher: TeamMatcher, season_start: dt.date) -> tuple[dict[str, int], str | None]:
    """NET rank keyed by ESPN id. Empty if the NCAA hasn't released this season's NET yet."""
    try:
        page = fetch(NET_URL, as_json=False)
    except Exception as e:
        log(f"NET: request failed ({e})")
        return {}, None
    m = re.search(r"Through Games ([A-Za-z]{3})\.? (\d{1,2}),? (\d{4})", page)
    as_of = None
    if m:
        as_of = dt.datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%b %d %Y").date()
        if as_of < season_start:
            log(f"NET: page is still last season's final rankings (through {as_of}) - not used yet")
            return {}, None
    out, missed = {}, []
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 2 or not cells[0].isdigit():
            continue
        espn_id = matcher.find(cells[1])
        if espn_id:
            out[espn_id] = int(cells[0])
        else:
            missed.append(cells[1])
    log(f"NET: {len(out)} teams through {as_of}" + (f", unmatched: {missed}" if missed else ""))
    return out, as_of.isoformat() if as_of else None


def load_torvik(matcher: TeamMatcher, season_year: int) -> dict[str, dict]:
    """T-Rank and WAB keyed by ESPN id, from Torvik's published season file."""
    try:
        text = fetch(f"https://barttorvik.com/{season_year}_team_results.csv", as_json=False)
        rows = list(csv.DictReader(io.StringIO(text)))
    except Exception as e:
        log(f"Torvik: request failed ({e}) - skipping")
        return {}
    out, missed = {}, []
    for r in rows:
        espn_id = matcher.find(r["team"])
        if not espn_id:
            missed.append(r["team"])
            continue
        wab = r.get("WAB")
        out[espn_id] = {
            "trank": to_int(r.get("rank")),
            "wab": round(float(wab), 1) if wab not in (None, "") else None,
            "wabRank": to_int(r.get("WAB Rk")),
        }
    log(f"Torvik: {len(out)} teams" + (f", unmatched: {missed}" if missed else ""))
    return out


def load_espn_conferences() -> dict[str, str]:
    """Fallback conference lookup (ESPN team id -> conference name)."""
    try:
        data = fetch("https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings")
    except Exception:
        return {}
    out = {}
    for conf in data.get("children", []):
        for entry in conf.get("standings", {}).get("entries", []):
            out[entry["team"]["id"]] = conf.get("shortName") or conf.get("name")
    return out


def load_schedule(team_id: str) -> list[dict]:
    games = []
    for season_type in (2, 3):  # regular season (incl. conf tournaments), then postseason
        try:
            data = fetch(f"{ESPN}/teams/{team_id}/schedule?seasontype={season_type}")
        except Exception as e:
            if season_type == 2:
                log(f"  schedule failed for {team_id}: {e}")
            continue
        games.extend(data.get("events", []))
    return games


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def quad_for(loc: str, opp_rank: int | None, opp_is_d1: bool) -> int | None:
    if not opp_is_d1:
        return 0  # 0 = non-Division I opponent
    if opp_rank is None:
        return None
    for q, cutoff in enumerate(QUAD_CUTOFFS[loc], start=1):
        if opp_rank <= cutoff:
            return q
    return 4


def parse_game(event: dict, team_id: str) -> dict | None:
    comp = event["competitions"][0]
    me = next((c for c in comp["competitors"] if c["id"] == team_id), None)
    opp = next((c for c in comp["competitors"] if c["id"] != team_id), None)
    if not me or not opp:
        return None
    status = comp.get("status", {}).get("type", {})
    if status.get("name") in ("STATUS_CANCELED", "STATUS_POSTPONED"):
        return None
    when = dt.datetime.fromisoformat(event["date"].replace("Z", "+00:00")).astimezone(EASTERN)
    loc = "N" if comp.get("neutralSite") else ("H" if me["homeAway"] == "home" else "A")
    game = {
        "id": event["id"],
        "date": when.date().isoformat(),
        "time": when.strftime("%-I:%M %p") if comp.get("timeValid", True) else None,
        "loc": loc,
        "oppId": opp["id"],
        "oppName": opp["team"].get("location") or opp["team"].get("displayName"),
        "final": bool(status.get("completed")),
    }
    if game["final"]:
        def score(c):
            s = c.get("score")
            return to_int(s.get("value") if isinstance(s, dict) else s)
        my, their = score(me), score(opp)
        game["score"] = f"{my}-{their}"
        game["result"] = "W" if me.get("winner") or (my is not None and their is not None and my > their) else "L"
    return game


def build_bracket(teams_out: list[dict]) -> dict:
    """Projected seed list + bubble watch. Also adds projSeed/bidChance to each team."""
    import bracket_model as bm

    hist = bm.load_history()
    eligible = [t for t in teams_out if t.get("wabRank") and t.get("trank")]
    rows = [{"id": t["id"], "conf": t["conf"], "wab_rank": t["wabRank"], "trank": t["trank"],
             "net": t.get("net"), "sor": t.get("sor")} for t in eligible]
    # Use a seeding ranking only once it's out for (nearly) every team, e.g. NET from December.
    seed_feats = [f for f in bm.SEED_FEATURES if sum(1 for r in rows if r.get(f)) >= 300]
    model = bm.train(hist, bm.SELECT_FEATURES, seed_feats)

    # Projected automatic qualifier per conference: best conference record once league play
    # has started, otherwise the best Torvik team. Independents have no automatic bid.
    by_conf: dict[str, list[dict]] = {}
    for t in eligible:
        if t["conf"] not in ("Independent", "Independents"):
            by_conf.setdefault(t["conf"], []).append(t)

    def conf_key(t):
        games = t["confWins"] + t["confLosses"]
        return (-(t["confWins"] / games) if games else 0, t["trank"])

    auto_ids = {min(group, key=conf_key)["id"] for group in by_conf.values()}
    field, bubble = bm.project(rows, model, auto_ids)

    slim = lambda r: {k: r[k] for k in ("id", "seed", "overall", "bid", "firstFour")} | {"chance": round(r["chance"], 3)}  # noqa: E731
    by_id = {t["id"]: t for t in teams_out}
    for r in rows:
        by_id[r["id"]]["bidChance"] = round(r["chance"], 3)
    for r in field:
        by_id[r["id"]]["projSeed"] = r["seed"]
    labels = {"wab_rank": "WAB", "trank": "Torvik", "net": "NET", "sor": "SOR"}
    return {
        "fieldSize": bm.FIELD_SIZE,
        "field": [slim(r) for r in field],
        "bubble": {k: [{"id": r["id"], "chance": round(r["chance"], 3)} for r in v] for k, v in bubble.items()},
        "selectUses": [labels[f] for f in bm.SELECT_FEATURES],
        "seedUses": [labels[f] for f in seed_feats],
        "backtest": bm.backtest(hist, bm.SELECT_FEATURES, seed_feats),
        "guide": bm.guide(hist),
        "guideSeasons": bm.guide_seasons(hist),
        "seasons": sorted({r["year"] for r in hist}),
    }


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "team").mkdir(exist_ok=True)

    espn_teams = load_espn_teams()
    matcher = TeamMatcher(espn_teams)
    bpi = load_bpi()
    season_start = dt.date(dt.date.today().year if dt.date.today().month >= 7 else dt.date.today().year - 1, 11, 1)
    net, net_as_of = load_net(matcher, season_start)
    sdio = load_sportsdata(matcher)
    torvik = load_torvik(matcher, season_start.year + 1)
    espn_conf = load_espn_conferences() if len(sdio) < 300 else {}

    d1_ids = {t["id"] for t in espn_teams}
    rank_source = "NET" if len(net) > 300 else "BPI"
    rank_of = (lambda i: net.get(i)) if rank_source == "NET" else (lambda i: bpi.get(i, {}).get("bpiRank"))
    log(f"Quads computed from: {rank_source}")

    log("Fetching schedules for every team...")
    ids = sorted(d1_ids)
    with ThreadPoolExecutor(max_workers=8) as pool:
        schedules = dict(zip(ids, pool.map(load_schedule, ids)))

    teams_out = []
    for t in sorted(espn_teams, key=lambda x: x["location"]):
        tid = t["id"]
        s = sdio.get(tid, {})
        b = bpi.get(tid, {})
        conf = s.get("conf") or espn_conf.get(tid) or "Independent"

        games, seen = [], set()
        for ev in schedules.get(tid, []):
            g = parse_game(ev, tid)
            if not g or g["id"] in seen:
                continue
            seen.add(g["id"])
            g["oppRank"] = rank_of(g["oppId"]) if g["oppId"] in d1_ids else None
            g["quad"] = quad_for(g["loc"], g["oppRank"], g["oppId"] in d1_ids)
            games.append(g)
        games.sort(key=lambda g: (g["date"], g["time"] or ""))

        quads = {str(q): [0, 0] for q in range(5)}
        wins = losses = 0
        lost_to = []
        for g in games:
            if not g["final"]:
                continue
            won = g["result"] == "W"
            wins += won
            losses += not won
            if g["quad"] is not None:
                quads[str(g["quad"])][0 if won else 1] += 1
            if not won and re.fullmatch(r"\d+-\d+", g["score"]):
                my, their = (int(x) for x in g["score"].split("-"))
                lost_to.append({"oppId": g["oppId"], "oppName": g["oppName"], "by": their - my,
                                "date": g["date"], "loc": g["loc"]})

        logo = next((l["href"] for l in t.get("logos", []) if "default" in l.get("rel", [])), None)
        team = {
            "id": tid,
            "name": t["location"],
            "short": t["shortDisplayName"],
            "mascot": t["name"],
            "abbr": t["abbreviation"],
            "conf": conf,
            "confShort": CONF_SHORT.get(conf, conf),
            "logo": logo,
            "color": (s.get("color") or t.get("color") or "1d3461").lower(),
            "altColor": (s.get("altColor") or t.get("alternateColor") or "ffffff").lower(),
            "wins": wins,
            "losses": losses,
            "confWins": s.get("confWins", 0) or 0,
            "confLosses": s.get("confLosses", 0) or 0,
            "ap": s.get("ap"),
            "net": net.get(tid),
            **b,
            **torvik.get(tid, {"trank": None, "wab": None, "wabRank": None}),
            "quads": quads,
            "lostTo": lost_to,
            "marginOfDefeat": sum(x["by"] for x in lost_to),
            "arena": s.get("arena"),
        }
        teams_out.append(team)
        (OUT / "team" / f"{tid}.json").write_text(json.dumps({"id": tid, "games": games, "roster": s.get("roster", [])}, separators=(",", ":")))

    bracket = build_bracket(teams_out)
    (OUT / "bracket.json").write_text(json.dumps(bracket, separators=(",", ":")))

    meta = {
        "updated": dt.datetime.now(EASTERN).strftime("%Y-%m-%d %I:%M %p ET"),
        "season": f"{season_start.year}-{str(season_start.year + 1)[-2:]}",
        "quadSource": rank_source,
        "netAsOf": net_as_of,
        "teams": teams_out,
    }
    (OUT / "teams.json").write_text(json.dumps(meta, separators=(",", ":")))

    # Daily snapshot of every team's rankings, kept for the future bracket-projection model.
    hist = OUT / "history"
    hist.mkdir(exist_ok=True)
    snap_keys = ("wins", "losses", "ap", "net", "bpiRank", "sor", "trank", "wab", "wabRank", "sos", "ncsos", "quads")
    snapshot = {"date": dt.datetime.now(EASTERN).date().isoformat(), "quadSource": rank_source,
                "teams": {t["id"]: {k: t[k] for k in snap_keys} for t in teams_out}}
    (hist / f"{snapshot['date']}.json").write_text(json.dumps(snapshot, separators=(",", ":")))
    log(f"Wrote {len(teams_out)} teams to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

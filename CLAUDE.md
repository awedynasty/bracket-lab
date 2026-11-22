# Notes for Claude

The site is called **Nasta's Bracket Lab** (repo: awedynasty/bracket-lab, site: https://awedynasty.github.io/bracket-lab/). Palette "Hardwood Analytics":
midnight navy, slate, hardwood amber (bubble/highlights), warm white, green (wins/locks).

The owner isn't a programmer and asks for changes in plain English. Keep the
project simple: no build step, no frameworks, no npm dependencies, and only the
Python standard library.

- `scripts/update_data.py` writes `docs/data/teams.json` (all teams + meta) and
  `docs/data/team/<espnId>.json` (one team's games). ESPN team ids are the primary key.
- Sources: SportsDataIO `LeagueHierarchy`, `Stadiums` and `PlayersByActive` (team info,
  arenas, rosters; the key does not cover games or stats), ESPN team schedules and BPI powerindex, and the NCAA.com NET HTML table.
  Torvik T-Rank/WAB come from the published `barttorvik.com/<year>_team_results.csv`; its
  HTML pages sit behind a browser check, so don't scrape or work around those.
  Torvik's host (CloudFront) blocks GitHub Actions servers (403). Bart Torvik OK'd a nightly
  download, so a Claude scheduled task runs `scripts/fetch_torvik.py` at 3:31 AM ET and pushes
  `docs/data/torvik_cache.json`; the 4:17 AM GitHub job then uses that copy. If the copy is
  older than today, the site shows a "Torvik data from <date>" notice. Never disguise requests. The cbbdata
  API (successor to toRvik) has no data after June 2025, so it isn't used.
- Name matching across sources: `norm()` + `TeamMatcher`, with overrides in
  `scripts/team_aliases.json`. Watch the updater's log for "unmatched".
- Quads use NET once the current season's NET is published; until then BPI rank.
  Cutoffs are in `QUAD_CUTOFFS`. `quad: 0` means a non-D1 opponent.
- Bracketology: `scripts/bracket_model.py` (stdlib logistic + linear regression on log ranks)
  trains nightly on `scripts/history/selection_sunday.csv` and writes `docs/data/bracket.json`.
  Selection uses WAB + Torvik; seeding uses WAB + Torvik + NET + SOR (NET drops out until
  it's released each December). Backtests showed BPI/KenPom/KPI don't help picks; KenPom/KPI
  help seeding slightly but have no free daily feed, so they're only in the guide table.
- History file: `scripts/build_bracket_history.py --massey <MMasseyOrdinals.csv>`. Torvik
  rank/WAB from Torvik time-machine files; seeds from cbbdata (<=2025) and ESPN (2026+);
  NET/KenPom/BPI/SOR/KPI from Kaggle March Machine Learning Mania `MMasseyOrdinals.csv`
  (codes NET, POM, EBP, ESR, KPK). The owner's Kaggle token is saved as a network secret
  for www.kaggle.com: download with
  `curl -L https://www.kaggle.com/api/v1/competitions/data/download/march-machine-learning-mania-<year>/MMasseyOrdinals.csv`
  (also MTeams.csv, MTeamSpellings.csv). Rerun once a year after the tournament.
- Projection: `scripts/simulate.py` gives every remaining game a win chance from Torvik
  adjO/adjD/tempo (+3 pts home edge, margin SD 11) and plays the season out N_SIMS=5000 times,
  recomputing WAB (bubble team = Torvik #60 strength, which matches Torvik's published WAB),
  conference champions and the bracket model each run. Output: `team.proj` in teams.json,
  `winProb` on upcoming games, and `bracket.json` -> `projected` (the "Projected Selection
  Sunday" toggle). Conference tournaments aren't simulated; auto bids = regular-season champ.
- `docs/data/history/<date>.json` is a daily ranking snapshot (incl. NET/SOR/BPI), saved so
  those metrics can join the model in future seasons. Don't delete it.
- Front end: `docs/index.html`, `docs/app.js` (hash routes `#/`, `#/team/<id>`, `#/margin`, `#/compare/<id>/<id>`, `#/bracket`),
  `docs/style.css` (colors are CSS variables at the top, with dark mode).
- After changing `docs/app.js` or `docs/style.css`, bump the `?v=` version on both in
  `docs/index.html` so phones don't keep serving the old cached files.
- Test: run the updater with `SPORTSDATA_KEY` set, serve `docs/` with
  `python3 -m http.server`, and check a team page at desktop and phone widths.
- Don't commit API keys. The key lives in the `SPORTSDATA_KEY` GitHub Actions secret.

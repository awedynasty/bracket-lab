# Notes for Claude

The owner isn't a programmer and asks for changes in plain English. Keep the
project simple: no build step, no frameworks, no npm dependencies, and only the
Python standard library.

- `scripts/update_data.py` writes `docs/data/teams.json` (all teams + meta) and
  `docs/data/team/<espnId>.json` (one team's games). ESPN team ids are the primary key.
- Sources: SportsDataIO `LeagueHierarchy`, `Stadiums` and `PlayersByActive` (team info,
  arenas, rosters; the key does not cover games or stats), ESPN team schedules and BPI powerindex, and the NCAA.com NET HTML table.
  Torvik T-Rank/WAB come from the published `barttorvik.com/<year>_team_results.csv`; its
  HTML pages sit behind a browser check, so don't scrape or work around those. The cbbdata
  API (successor to toRvik) has no data after June 2025, so it isn't used.
- Name matching across sources: `norm()` + `TeamMatcher`, with overrides in
  `scripts/team_aliases.json`. Watch the updater's log for "unmatched".
- Quads use NET once the current season's NET is published; until then BPI rank.
  Cutoffs are in `QUAD_CUTOFFS`. `quad: 0` means a non-D1 opponent.
- `docs/data/history/<date>.json` is a daily ranking snapshot, saved for a future
  bracket-projection model (historical rank -> seed). Don't delete it.
- Front end: `docs/index.html`, `docs/app.js` (hash routes `#/`, `#/team/<id>`, `#/margin`, `#/compare/<id>/<id>`),
  `docs/style.css` (colors are CSS variables at the top, with dark mode).
- Test: run the updater with `SPORTSDATA_KEY` set, serve `docs/` with
  `python3 -m http.server`, and check a team page at desktop and phone widths.
- Don't commit API keys. The key lives in the `SPORTSDATA_KEY` GitHub Actions secret.

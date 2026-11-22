#!/usr/bin/env python3
"""Download Torvik's season file into docs/data/torvik_cache.json.

Torvik's host blocks GitHub's servers, so this runs nightly from a Claude scheduled task
(with Bart Torvik's OK) shortly before the GitHub nightly update, which then uses the saved
copy. Exits with an error if the download fails, so a failed night is visible.
"""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import update_data as u  # noqa: E402


def main() -> int:
    today = dt.datetime.now(u.EASTERN).date()
    season_year = today.year + 1 if today.month >= 7 else today.year
    teams, _ = u.load_torvik(u.TeamMatcher(u.load_espn_teams()), season_year, use_cache=False)
    if len(teams) < 300:
        u.log("Torvik download failed - saved copy not updated")
        return 1
    u.log(f"Saved {len(teams)} teams to {u.TORVIK_CACHE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

# Hoops Resume

Team resumes for every Division I men's college basketball team: rankings
(AP, NET, BPI, Torvik, Strength of Record, Wins Above Bubble, SOS), Quad 1–4 records with every game,
last and next 5 games, and conference standings. Plus a team comparison tool, a Margin of
Defeat page, and a Bracketology page with a projected seed list and bubble watch.

The data updates itself every night, so there's nothing to run day to day.

## How it works

| Part | Where it lives | What it does |
|---|---|---|
| Website | `docs/` | The pages people see, hosted free on GitHub Pages |
| Data | `docs/data/` | JSON files the website reads. **Don't edit by hand**: they're rebuilt nightly |
| Updater | `scripts/update_data.py` | Pulls fresh data from SportsDataIO, ESPN, NCAA.com and Barttorvik |
| Schedule | `.github/workflows/update-data.yml` | Runs the updater every night around 4 AM Eastern |

**Quads** use the NCAA NET once the NCAA publishes it for the season (usually early
December). Until then, they're estimated from ESPN's BPI rank. The switch happens automatically.

**Bracketology** learns from every tournament since 2015 how a team's Wins Above Bubble and
Torvik rankings on Selection Sunday translated into a bid and a seed. Once a year, after the
tournament, add that season to `scripts/build_bracket_history.py` and rerun it (or ask Claude to).

## One-time setup

1. **Add your SportsDataIO key:** repo **Settings → Secrets and variables → Actions →
   New repository secret**. Name it `SPORTSDATA_KEY` and paste the key as the value.
2. **Turn on the website:** **Settings → Pages**. Under "Build and deployment," pick
   **Deploy from a branch**, branch **main**, folder **/docs**, then Save. The site appears at
   `https://<your-username>.github.io/hoops-resume/` within a few minutes.
3. **Allow the nightly job to save data:** **Settings → Actions → General → Workflow
   permissions**, choose **Read and write permissions**, then Save.

## Common tasks

- **Update the data right now:** **Actions** tab → **Nightly data update** → **Run workflow**.
- **Change colors:** edit the variables at the top of `docs/style.css`.
- **A team shows up wrong or missing:** the sources spell school names differently. Add
  the name to `scripts/team_aliases.json`, mapping it to the team's ESPN id (the number in
  the team's espn.com URL).
- **Anything bigger:** open a Claude Code session on this repo and describe the change.

## Previewing changes on your computer (optional)

```bash
SPORTSDATA_KEY=yourkey python3 scripts/update_data.py
cd docs && python3 -m http.server 8000
```

Then open http://localhost:8000.

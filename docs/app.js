// Nasta's Bracket Lab - front end.
// Reads data/teams.json (all teams) and data/team/<id>.json (one team's games).
// Pages:  #/            -> every team, sortable
//         #/team/<id>   -> one team's resume
//         #/margin      -> margin of defeat (points lost by, and who to)
//         #/compare/<id>/<id> -> two teams side by side
//         #/bracket     -> seed list + bubble watch, today or projected (data/bracket.json)

const state = { meta: null, byId: {}, sort: null, search: "", conf: "", modTop: "50", modConf: "" };
const app = document.getElementById("app");

const QUAD_NAMES = { 1: "Quad 1", 2: "Quad 2", 3: "Quad 3", 4: "Quad 4", 0: "Non-D1" };
const LOC = { H: "vs", A: "@", N: "N" };

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rec = (w, l) => `${w}-${l}`;
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${+m}/${+d}`; };
// ESPN also publishes a dark-background version of each logo; small logos use it in dark mode
// (big logos sit on a white circle, so they keep the normal version).
const logo = (t, cls = "logo") => t && t.logo
  ? `<picture>${cls === "logo" && t.logo.includes("/500/") ? `<source srcset="${esc(t.logo.replace("/500/", "/500-dark/"))}" media="(prefers-color-scheme: dark)">` : ""}<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy"></picture>`
  : `<span class="${cls} blank"></span>`;
const rankVal = (v) => (v == null ? "—" : v);
// Projected records are averages over thousands of simulated seasons; show them as whole games.
const projRec = (w, l) => { const W = Math.round(w), G = Math.round(w + l); return `${W}-${G - W}`; };
const pctText = (x) => (x == null ? "—" : x >= 0.995 ? ">99%" : x > 0 && x < 0.005 ? "<1%" : `${Math.round(x * 100)}%`);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const qrec = (t, q) => rec(...t.quads[q]);

function rankSourceLabel() {
  return state.meta.quadSource === "NET" ? "NET" : "BPI";
}

// ---------- boot ----------
async function boot() {
  const res = await fetch("data/teams.json", { cache: "no-cache" });
  state.meta = await res.json();
  for (const t of state.meta.teams) state.byId[t.id] = t;
  state.sort = { key: state.meta.quadSource === "NET" ? "net" : "bpiRank", dir: 1 };
  document.getElementById("meta").innerHTML =
    `${esc(state.meta.season)} season<br>Updated ${esc(state.meta.updated)}`;
  state.meta.sims = state.meta.sims || 5000;
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const m = location.hash.match(/^#\/team\/(\w+)/);
  const c = location.hash.match(/^#\/compare(?:\/(\w*))?(?:\/(\w*))?/);
  const page = m ? "team" : c ? "compare" : location.hash.startsWith("#/margin") ? "margin"
    : location.hash.startsWith("#/bracket") ? "bracket" : "home";
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  if (m && state.byId[m[1]]) renderTeam(m[1]);
  else if (c) renderCompare(c[1], c[2]);
  else if (page === "margin") renderMargin();
  else if (page === "bracket") renderBracket();
  else renderHome();
  window.scrollTo(0, 0);
}

function staleNotice() {
  const d = state.meta.torvikStale;
  return d ? `<div class="notice">Torvik's data couldn't be downloaded during the last update, so Torvik ranks, WAB and
    projections are from <b>${esc(d)}</b>. Everything else is current.</div>` : "";
}

function quadNotice() {
  if (state.meta.quadSource === "NET") {
    return `<div class="notice">Quads use the NCAA NET rankings (through ${esc(state.meta.netAsOf)}).</div>`;
  }
  return `<div class="notice"><b>The NET hasn't been released for this season yet</b> (usually early December).
    Until it is, quads are estimated from ESPN's BPI rank and switch to the NET automatically.</div>`;
}

// ---------- home: all teams ----------
const COLUMNS = [
  { key: "name", label: "Team", get: (t) => t.name, text: true },
  { key: "conf", label: "Conf", get: (t) => t.confShort, text: true },
  { key: "wl", label: "W-L", get: (t) => t.wins - t.losses, desc: true, show: (t) => rec(t.wins, t.losses), c: true },
  { key: "cwl", label: "Conf", get: (t) => t.confWins - t.confLosses, desc: true, show: (t) => rec(t.confWins, t.confLosses), c: true },
  { key: "master", label: "Master", get: (t) => t.masterRank, c: true },
  { key: "ap", label: "AP", get: (t) => t.ap, c: true },
  { key: "net", label: "NET", get: (t) => t.net, c: true },
  { key: "bpiRank", label: "BPI", get: (t) => t.bpiRank, c: true },
  { key: "trank", label: "Torvik", get: (t) => t.trank, c: true },
  { key: "sor", label: "SOR", get: (t) => t.sor, c: true },
  { key: "wabRank", label: "WAB", get: (t) => t.wabRank, c: true },
  { key: "sos", label: "SOS", get: (t) => t.sos, c: true },
  ...[1, 2, 3, 4].map((q) => ({
    key: "q" + q, label: "Q" + q, c: true, desc: q <= 2,
    get: (t) => t.quads[q][0] * 100 - t.quads[q][1], show: (t) => qrec(t, q),
  })),
  { key: "bid", label: "Bid %", c: true, desc: true, get: (t) => t.proj?.inField, show: (t) => pctText(t.proj?.inField) },
];

function renderHome() {
  document.title = "Nasta's Bracket Lab";
  const confs = [...new Set(state.meta.teams.map((t) => t.conf))].sort();
  app.innerHTML = `
    ${staleNotice()}
    ${quadNotice()}
    <p class="page-sub">Master Rank = average of each team's ${esc((state.meta.masterUses || []).join(", "))} rankings (KenPom and KPI aren't available daily).</p>
    <div class="controls">
      <input id="search" type="search" placeholder="Search teams…" value="${esc(state.search)}" aria-label="Search teams">
      <select id="conf" aria-label="Conference">
        <option value="">All conferences</option>
        ${confs.map((c) => `<option ${c === state.conf ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>
    <div class="card"><div class="table-wrap"><table id="all"></table></div></div>`;
  document.getElementById("search").addEventListener("input", (e) => { state.search = e.target.value; drawTable(); });
  document.getElementById("conf").addEventListener("change", (e) => { state.conf = e.target.value; drawTable(); });
  drawTable();
}

function drawTable() {
  const { key, dir } = state.sort;
  const col = COLUMNS.find((c) => c.key === key);
  const q = state.search.trim().toLowerCase();
  const rows = state.meta.teams
    .filter((t) => (!state.conf || t.conf === state.conf) &&
      (!q || `${t.name} ${t.mascot} ${t.abbr}`.toLowerCase().includes(q)))
    .sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;           // blanks always last
      if (y == null) return -1;
      const r = col.text ? String(x).localeCompare(String(y)) : x - y;
      return r * dir;
    });

  const head = COLUMNS.map((c) =>
    `<th class="sortable ${c.c ? "c" : ""} ${c.key === key ? "sorted" + (dir < 0 ? " desc" : "") : ""}" data-key="${c.key}">${c.label}</th>`
  ).join("");
  const body = rows.map((t) => `
    <tr class="link" data-id="${t.id}">
      <td><span class="team-cell">${logo(t)}${esc(t.name)}</span></td>
      ${COLUMNS.slice(1).map((c) => {
        const v = c.show ? c.show(t) : rankVal(c.get(t));
        return `<td class="num ${c.c ? "c" : ""} ${v === "—" || v === "0-0" ? "dim" : ""}">${esc(v)}</td>`;
      }).join("")}
    </tr>`).join("");
  const table = document.getElementById("all");
  table.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="empty" colspan="${COLUMNS.length}">No teams match.</td></tr>`}</tbody>`;

  table.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.key;
    const c = COLUMNS.find((x) => x.key === k);
    state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: c.desc ? -1 : 1 };
    drawTable();
  }));
  table.querySelectorAll("tr.link").forEach((tr) =>
    tr.addEventListener("click", () => { location.hash = `#/team/${tr.dataset.id}`; }));
}

// ---------- team page ----------
async function renderTeam(id) {
  const t = state.byId[id];
  document.title = `${t.name} · Nasta's Bracket Lab`;
  app.innerHTML = `<p class="loading">Loading ${esc(t.name)}…</p>`;
  const detail = await (await fetch(`data/team/${id}.json`, { cache: "no-cache" })).json();
  const games = detail.games;
  const roster = detail.roster || [];
  if (location.hash !== `#/team/${id}`) return; // user navigated away while loading

  const confTeams = state.meta.teams.filter((x) => x.conf === t.conf)
    .sort((a, b) => (b.confWins - b.confLosses) - (a.confWins - a.confLosses) ||
      (b.wins - b.losses) - (a.wins - a.losses) || a.name.localeCompare(b.name));
  const confs = [...new Set(state.meta.teams.map((x) => x.conf))].sort();
  const place = confTeams.indexOf(t) + 1;

  const played = games.filter((g) => g.final);
  const upcoming = games.filter((g) => !g.final);
  const last5 = played.slice(-5).reverse();
  const next5 = upcoming.slice(0, 5);
  const color = "#" + (t.color || "1e293b");

  const tile = (label, v, hint = "") =>
    `<div class="tile"><div class="label">${label}</div><div class="value num ${v == null ? "na" : ""}">${v ?? "—"}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;

  app.innerHTML = `
    <div class="picker">
      <a class="back" href="#/">← All teams</a>
      <select id="pick-conf" aria-label="Conference">${confs.map((c) => `<option ${c === t.conf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="pick-team" aria-label="School">${confTeams.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <a class="btn" href="#/compare/${id}/">Compare with…</a>
    </div>

    <section class="hero" style="--team:${esc(color)}">
      ${logo(t, "hero-logo")}
      <div class="hero-text">
        <h1>${esc(t.name)}</h1>
        <div class="sub">${esc(t.mascot)} · ${esc(t.conf)}</div>
        <div class="sub"><b class="num">${rec(t.wins, t.losses)}</b> overall ·
          <b class="num">${rec(t.confWins, t.confLosses)}</b> conference · ${ordinal(place)} in ${esc(t.confShort)}</div>
        ${t.arena ? `<div class="sub">${esc(t.arena.name)}${t.arena.city ? ` · ${esc(t.arena.city)}` : ""}${t.arena.capacity ? ` · capacity ${t.arena.capacity.toLocaleString()}` : ""}</div>` : ""}
      </div>
    </section>

    ${state.meta.quadSource === "NET" ? "" : quadNotice()}

    <div class="tiles">
      ${tile("Master Rank", t.masterRank, t.masterAvg != null ? `Avg ${t.masterAvg} of ${(state.meta.masterUses || []).length}` : "")}
      ${tile("AP", t.ap, t.ap ? "" : "Unranked")}
      ${tile("NET", t.net, t.net ? "" : "Not out yet")}
      ${tile("BPI", t.bpiRank, t.bpi != null ? `Rating ${t.bpi > 0 ? "+" : ""}${t.bpi}` : "")}
      ${tile("Torvik", t.trank)}
      ${tile("Strength of Record", t.sor)}
      ${tile("Wins Above Bubble", t.wabRank, t.wab != null ? `${t.wab > 0 ? "+" : ""}${t.wab} wins` : "")}
      ${tile("SOS", t.sos)}
      ${tile("Non-Con SOS", t.ncsos)}
      ${t.proj
        ? tile("Proj. Seed", t.proj.projSeed ?? null, t.proj.projSeed ? `${pctText(t.proj.inField)} to make it` : `${pctText(t.proj.inField)} bid odds`)
        : tile("Seed Today", t.projSeed, t.bidChance != null ? `${pctText(t.bidChance)} bid odds` : "")}
    </div>

    <div class="layout">
      <div class="quads">
        ${[1, 2, 3, 4].map((q) => quadCard(q, t, games)).join("")}
        ${games.some((g) => g.quad === 0) ? quadCard(0, t, games) : ""}
        ${rosterCard(roster)}
      </div>
      <div class="side">
        ${projCard(t)}
        ${listCard("Last 5 Games", last5, "No games played yet.")}
        ${listCard("Next 5 Games", next5, "No games left on the schedule.")}
        ${standingsCard(t, confTeams)}
      </div>
    </div>`;

  document.getElementById("pick-conf").addEventListener("change", (e) => {
    const first = state.meta.teams.filter((x) => x.conf === e.target.value).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (first) location.hash = `#/team/${first.id}`;
  });
  document.getElementById("pick-team").addEventListener("change", (e) => { location.hash = `#/team/${e.target.value}`; });
  app.querySelectorAll(".standings tr[data-id]").forEach((tr) =>
    tr.addEventListener("click", () => { location.hash = `#/team/${tr.dataset.id}`; }));
}

function projCard(t) {
  const p = t.proj;
  if (!p) return "";
  const best = p.seedOdds.indexOf(Math.max(...p.seedOdds));
  const max = Math.max(...p.seedOdds, 0.01);
  const row = (label, value) => `<tr><td>${label}</td><td class="num c"><b>${value}</b></td></tr>`;
  return `<section class="card">
    <div class="card-head"><span>Projected Finish</span><a class="dim-head" href="#/bracket" style="color:inherit">Bracketology →</a></div>
    <table class="bubble proj"><tbody>
      ${row("Record", projRec(p.wins, p.losses))}
      ${row("Conference", projRec(p.confWins, p.confLosses))}
      ${row("Wins Above Bubble", `${p.wab > 0 ? "+" : ""}${p.wab} <span class="dim">(#${p.wabRank})</span>`)}
      ${row(`${esc(t.confShort)} regular-season title`, pctText(p.confTitle))}
      ${row("Makes the NCAA Tournament", pctText(p.inField))}
      ${p.inField >= 0.005 ? row("Most likely seed", `${best + 1} <span class="dim">(${pctText(p.seedOdds[best])})</span>`) : ""}
    </tbody></table>
    ${p.inField >= 0.005 ? `<div class="seed-odds" aria-label="Chance of each seed">
      ${p.seedOdds.map((x, i) => `<div class="so" title="${i + 1} seed: ${pctText(x)}">
        <div class="bar-wrap"><div class="bar ${i === best ? "best" : ""}" style="height:${Math.round((x / max) * 100)}%"></div></div>
        <div class="lab">${i + 1}</div></div>`).join("")}
    </div>` : ""}
    <div class="empty">From ${bracketSims()} simulated seasons using each game's win chance. Seeds 1–16, taller = more likely.</div>
  </section>`;
}

function bracketSims() { return (state.meta.sims || 5000).toLocaleString(); }

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function gameRow(g) {
  const opp = state.byId[g.oppId];
  const name = opp ? `<a href="#/team/${opp.id}">${esc(opp.name)}</a>` : `<span>${esc(g.oppName)}</span>`;
  const rk = g.oppRank ? `<span class="rk">${rankSourceLabel()} ${g.oppRank}</span>` : "";
  const wp = g.winProb;
  const res = g.final ? `<span class="chip ${g.result}">${g.result}</span>`
    : wp != null ? `<span class="chip P ${wp >= 0.6 ? "hi" : wp <= 0.4 ? "lo" : "mid"}" title="Chance to win">${Math.min(99, Math.max(1, Math.round(wp * 100)))}%</span>`
    : `<span class="chip U">–</span>`;
  const right = g.final ? g.score : (g.time || "TBD");
  return `<tr class="${g.final ? "" : "upcoming"}">
    <td class="res">${res}</td>
    <td class="num">${fmtDate(g.date)}</td>
    <td class="loc">${LOC[g.loc]}</td>
    <td><span class="opp">${logo(opp)}${name}${rk}</span></td>
    <td class="num c">${esc(right)}</td>
  </tr>`;
}

function quadCard(q, t, games) {
  const list = games.filter((g) => g.quad === q);
  // Played games first (most recent at top), then upcoming in date order
  const shown = [...list.filter((g) => g.final).reverse(), ...list.filter((g) => !g.final)];
  const [w, l] = t.quads[q];
  return `<section class="card">
    <div class="card-head"><span>${QUAD_NAMES[q]}</span><span class="rec num">${w} - ${l}</span></div>
    ${shown.length ? `<div class="table-wrap"><table class="games"><tbody>${shown.map(gameRow).join("")}</tbody></table></div>` : `<div class="empty">No games.</div>`}
  </section>`;
}

function listCard(title, list, emptyText) {
  return `<section class="card">
    <div class="card-head"><span>${title}</span></div>
    ${list.length ? `<div class="table-wrap"><table class="games"><tbody>${list.map(gameRow).join("")}</tbody></table></div>` : `<div class="empty">${emptyText}</div>`}
  </section>`;
}

function standingsCard(t, confTeams) {
  return `<section class="card">
    <div class="card-head"><span>${esc(t.conf)} Standings</span></div>
    <table class="standings">
      <thead><tr><th>Team</th><th class="c">Conf</th><th class="c">Overall</th>
        <th class="c" title="Projected final conference record">Proj</th><th class="c" title="Chance to win or share the regular-season title">Title</th></tr></thead>
      <tbody>${confTeams.map((x) => `
        <tr class="${x.id === t.id ? "me" : ""}" data-id="${x.id}">
          <td><span class="team-cell">${logo(x)}${esc(x.name)}</span></td>
          <td class="num c">${rec(x.confWins, x.confLosses)}</td>
          <td class="num c">${rec(x.wins, x.losses)}</td>
          <td class="num c dim">${x.proj ? projRec(x.proj.confWins, x.proj.confLosses) : "—"}</td>
          <td class="num c dim">${x.proj ? pctText(x.proj.confTitle) : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  </section>`;
}

function rosterCard(roster) {
  if (!roster.length) return "";
  const ht = (inches) => (inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : "");
  const cls = (c) => ({ Freshman: "Fr", Sophomore: "So", Junior: "Jr", Senior: "Sr", "Graduate Student": "Gr" }[c] || c || "");
  return `<section class="card full">
    <div class="card-head"><span>Roster</span><span class="rec num">${roster.length}</span></div>
    <div class="roster-wrap"><table class="roster">
      <thead><tr><th class="c">#</th><th>Name</th><th class="c">Pos</th><th class="c">Class</th><th class="c">Ht</th><th class="c">Wt</th><th>Hometown</th></tr></thead>
      <tbody>${roster.map((p) => `<tr>
        <td class="jersey num">${p.num ?? ""}</td>
        <td>${esc(p.name)}</td>
        <td class="c">${esc(p.pos)}</td>
        <td class="c">${esc(cls(p.cls))}</td>
        <td class="c num">${ht(p.ht)}</td>
        <td class="c num">${p.wt ?? ""}</td>
        <td class="dim">${esc(p.home)}</td>
      </tr>`).join("")}</tbody>
    </table></div>
  </section>`;
}

// ---------- margin of defeat ----------
function rankOf(t) {
  return state.meta.quadSource === "NET" ? t.net : t.bpiRank;
}

function renderMargin() {
  document.title = "Margin of Defeat · Nasta's Bracket Lab";
  const confs = [...new Set(state.meta.teams.map((t) => t.conf))].sort();
  const src = rankSourceLabel();
  app.innerHTML = `
    <h1 class="page-title">Margin of Defeat</h1>
    <p class="page-sub">Total points each team has lost by this season, and who beat them. Lower is better.</p>
    <div class="controls">
      <select id="mod-top" aria-label="Teams to show">
        ${[["25", `${src} top 25`], ["50", `${src} top 50`], ["100", `${src} top 100`], ["all", "All teams"]]
          .map(([v, l]) => `<option value="${v}" ${v === state.modTop ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <select id="mod-conf" aria-label="Conference">
        <option value="">All conferences</option>
        ${confs.map((c) => `<option ${c === state.modConf ? "selected" : ""}>${esc(c)}</option>`).join("")}
      </select>
    </div>
    <div class="card"><div class="table-wrap"><table class="mod" id="mod"></table></div></div>`;
  document.getElementById("mod-top").addEventListener("change", (e) => { state.modTop = e.target.value; drawMargin(); });
  document.getElementById("mod-conf").addEventListener("change", (e) => { state.modConf = e.target.value; drawMargin(); });
  drawMargin();
}

function drawMargin() {
  const top = state.modTop === "all" ? Infinity : +state.modTop;
  const rows = state.meta.teams
    .filter((t) => (!state.modConf || t.conf === state.modConf) && (rankOf(t) ?? Infinity) <= top)
    .sort((a, b) => a.marginOfDefeat - b.marginOfDefeat || (rankOf(a) ?? 999) - (rankOf(b) ?? 999));
  const max = Math.max(1, ...rows.map((t) => t.marginOfDefeat));
  const mid = max / 2;
  // green (small margin) -> neutral -> red (big margin)
  const heat = (v) => {
    const pct = Math.round(Math.min(1, Math.abs(v - mid) / mid) * 55);
    return `background: color-mix(in srgb, ${v <= mid ? "var(--win)" : "var(--loss)"} ${pct}%, transparent)`;
  };
  const table = document.getElementById("mod");
  table.innerHTML = `
    <thead><tr><th>Team</th><th class="c">W-L</th><th class="c">${rankSourceLabel()}</th><th class="c">Margin</th><th>Lost To</th></tr></thead>
    <tbody>${rows.map((t) => `<tr>
      <td><a class="team-cell" href="#/team/${t.id}" style="text-decoration:none">${logo(t)}${esc(t.name)}</a></td>
      <td class="num c">${rec(t.wins, t.losses)}</td>
      <td class="num c">${rankVal(rankOf(t))}</td>
      <td class="num heat" style="${heat(t.marginOfDefeat)}">${t.marginOfDefeat}</td>
      <td class="lost">${t.lostTo.length ? t.lostTo.map((l) => {
        const o = state.byId[l.oppId];
        const name = esc(o ? o.name : l.oppName);
        const inner = `${o ? logo(o) : ""}<span>${name}</span><span class="by">−${l.by}</span>`;
        return o ? `<a class="loss" href="#/team/${o.id}" title="${fmtDate(l.date)} ${LOC[l.loc]} ${name}">${inner}</a>`
                 : `<span class="loss">${inner}</span>`;
      }).join("") : `<span class="dim">Undefeated</span>`}</td>
    </tr>`).join("") || `<tr><td class="empty" colspan="5">No teams match.</td></tr>`}</tbody>`;
}

// ---------- compare two teams ----------
// Each metric: how to read it, how to show it, and whether lower or higher is better.
const COMPARE_ROWS = [
  { group: "Record" },
  { label: "Overall", show: (t) => rec(t.wins, t.losses), val: (t) => winPct(t.wins, t.losses), better: "high" },
  { label: "Conference", show: (t) => rec(t.confWins, t.confLosses), val: (t) => winPct(t.confWins, t.confLosses), better: "high" },
  { group: "Rankings" },
  { label: "Master Rank", val: (t) => t.masterRank, better: "low",
    show: (t) => t.masterRank == null ? "—" : `${t.masterRank} <span class="dim">(avg ${t.masterAvg})</span>` },
  { label: "AP Poll", val: (t) => t.ap, better: "low" },
  { label: "NET", val: (t) => t.net, better: "low" },
  { label: "BPI", val: (t) => t.bpiRank, better: "low" },
  { label: "Torvik", val: (t) => t.trank, better: "low" },
  { label: "Strength of Record", val: (t) => t.sor, better: "low" },
  { label: "Wins Above Bubble", val: (t) => t.wabRank, better: "low",
    show: (t) => t.wabRank == null ? "—" : `${t.wabRank} <span class="dim">(${t.wab > 0 ? "+" : ""}${t.wab})</span>` },
  { label: "Strength of Schedule", val: (t) => t.sos, better: "low" },
  { label: "Non-Con SOS", val: (t) => t.ncsos, better: "low" },
  { group: "Resume" },
  ...[1, 2].map((q) => ({ label: `Quad ${q}`, show: (t) => qrec(t, q), val: (t) => t.quads[q][0], better: "high" })),
  ...[3, 4].map((q) => ({ label: `Quad ${q}`, show: (t) => qrec(t, q), val: (t) => t.quads[q][1], better: "low" })),
  { label: "Margin of Defeat", val: (t) => t.marginOfDefeat, better: "low",
    show: (t) => `${t.marginOfDefeat} <span class="dim">(${t.losses} L)</span>` },
];

function winPct(w, l) { return w + l ? w / (w + l) : null; }

function teamSelect(id, selected) {
  const confs = [...new Set(state.meta.teams.map((t) => t.conf))].sort();
  return `<select id="${id}" aria-label="Team">
    <option value="">Pick a team…</option>
    ${confs.map((c) => `<optgroup label="${esc(c)}">${state.meta.teams.filter((t) => t.conf === c)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => `<option value="${t.id}" ${t.id === selected ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</optgroup>`).join("")}
  </select>`;
}

async function renderCompare(aId, bId) {
  const a = state.byId[aId], b = state.byId[bId];
  document.title = a && b ? `${a.name} vs ${b.name} · Nasta's Bracket Lab` : "Compare · Nasta's Bracket Lab";
  const pickers = `
    <h1 class="page-title">Compare Teams</h1>
    <div class="compare-pick">
      ${teamSelect("cmp-a", aId)}<span class="vs">vs</span>${teamSelect("cmp-b", bId)}
    </div>`;
  const wire = () => {
    const go = () => {
      const x = document.getElementById("cmp-a").value, y = document.getElementById("cmp-b").value;
      location.hash = `#/compare/${x}/${y}`;
    };
    document.getElementById("cmp-a").addEventListener("change", go);
    document.getElementById("cmp-b").addEventListener("change", go);
  };
  if (!a || !b) {
    app.innerHTML = `${pickers}<p class="page-sub">Pick two teams to see their resumes side by side.</p>`;
    wire();
    return;
  }
  app.innerHTML = `${pickers}<p class="loading">Loading…</p>`;
  wire();
  const [ga, gb] = await Promise.all([a, b].map(async (t) =>
    (await (await fetch(`data/team/${t.id}.json`, { cache: "no-cache" })).json()).games));
  if (!location.hash.startsWith(`#/compare/${aId}/${bId}`)) return;

  let edgeA = 0, edgeB = 0;
  const rows = COMPARE_ROWS.map((r) => {
    if (r.group) return `<tr class="grp"><td colspan="3">${r.group}</td></tr>`;
    const va = r.val(a), vb = r.val(b);
    let wa = false, wb = false;
    if (va != null && vb != null && va !== vb) {
      const aBetter = r.better === "low" ? va < vb : va > vb;
      wa = aBetter; wb = !aBetter;
      aBetter ? edgeA++ : edgeB++;
    }
    const show = (t, v) => r.show ? r.show(t) : (v ?? "—");
    return `<tr>
      <td class="num side-a ${wa ? "better" : ""}">${show(a, va)}</td>
      <td class="metric">${r.label}</td>
      <td class="num side-b ${wb ? "better" : ""}">${show(b, vb)}</td>
    </tr>`;
  }).join("");

  // Head-to-head and common opponents
  const h2h = ga.filter((g) => g.oppId === b.id);
  const finalsB = {};
  for (const g of gb) if (g.final) (finalsB[g.oppId] ||= []).push(g);
  const common = [];
  for (const g of ga) {
    if (!g.final || g.oppId === b.id || !finalsB[g.oppId]) continue;
    common.push([g, finalsB[g.oppId]]);
  }
  const res = (g) => `<span class="chip ${g.result}">${g.result}</span> <span class="num">${g.score}</span> <span class="dim">${LOC[g.loc]} ${fmtDate(g.date)}</span>`;
  const head = (t) => `<a class="cmp-team" href="#/team/${t.id}" style="--team:#${esc(t.color || "1e293b")}">
      ${logo(t, "cmp-logo")}<div><div class="cmp-name">${esc(t.name)}</div>
      <div class="cmp-sub">${rec(t.wins, t.losses)} · ${esc(t.confShort)}</div></div></a>`;

  app.innerHTML = `${pickers}
    ${state.meta.quadSource === "NET" ? "" : quadNotice()}
    <div class="cmp-heads">${head(a)}<div class="cmp-edge num"><b>${edgeA}</b><span>edges</span><b>${edgeB}</b></div>${head(b)}</div>
    <div class="compare-grid">
      <section class="card"><table class="cmp">
        <tbody>${rows}</tbody>
      </table><div class="empty">Green marks the better number. Quads 1–2 are judged on wins, Quads 3–4 on losses.</div></section>
      <div class="side">
        <section class="card">
          <div class="card-head"><span>Head to Head</span></div>
          ${h2h.length ? `<table class="games"><tbody>${h2h.map((g) => {
            const where = g.loc === "N" ? "Neutral site" : g.loc === "H" ? `at ${esc(a.name)}` : `at ${esc(b.name)}`;
            if (!g.final) return `<tr class="upcoming"><td>${fmtDate(g.date)}</td><td>${where}</td><td>${esc(g.time || "TBD")}</td></tr>`;
            const [x, y] = g.score.split("-");
            const w = g.result === "W" ? a : b;
            return `<tr><td>${fmtDate(g.date)}</td><td><span class="opp">${logo(w)}<b>${esc(w.name)}</b>&nbsp;won <span class="num">${Math.max(x, y)}-${Math.min(x, y)}</span></span></td><td class="dim">${where}</td></tr>`;
          }).join("")}</tbody></table>`
          : `<div class="empty">They haven't played this season and aren't scheduled to.</div>`}
        </section>
        <section class="card">
          <div class="card-head"><span>Common Opponents</span><span class="rec num">${common.length}</span></div>
          ${common.length ? `<table class="games common"><thead><tr><th>Opponent</th><th>${esc(a.abbr)}</th><th>${esc(b.abbr)}</th></tr></thead><tbody>
            ${common.map(([g, bs]) => { const o = state.byId[g.oppId]; return `<tr>
              <td><span class="opp">${logo(o)}${o ? `<a href="#/team/${o.id}">${esc(o.name)}</a>` : esc(g.oppName)}</span></td>
              <td>${res(g)}</td><td>${bs.map(res).join("<br>")}</td></tr>`; }).join("")}
          </tbody></table>` : `<div class="empty">No common opponents yet.</div>`}
        </section>
      </div>
    </div>`;
  wire();
}

// ---------- bracketology ----------
let bracketData = null;
const pct = (x) => `${Math.round(x * 100)}%`;

async function renderBracket() {
  document.title = "Bracketology · Nasta's Bracket Lab";
  if (!bracketData) {
    app.innerHTML = `<p class="loading">Loading…</p>`;
    bracketData = await (await fetch("data/bracket.json", { cache: "no-cache" })).json();
    if (!location.hash.startsWith("#/bracket")) return;
  }
  const b = bracketData, bt = b.backtest;
  const T = (id) => state.byId[id];
  const hasProj = !!(b.projected && b.projected.field);
  const mode = hasProj && (store.get("bracketMode") || "today") === "projected" ? "projected" : "today";
  const view = mode === "projected" ? b.projected : b;
  const P = mode === "projected";
  const lines = [];
  for (const r of view.field) (lines[r.seed] ||= []).push(r);

  const chip = (r) => {
    const t = T(r.id);
    const recText = P && t.proj ? `projected ${projRec(t.proj.wins, t.proj.losses)}` : rec(t.wins, t.losses);
    return `<a class="seed-team" href="#/team/${t.id}" title="${esc(t.name)} · ${esc(t.conf)} · ${recText}${P ? ` · ${pctText(r.chance)} to make the field` : ""}">
      ${logo(t)}<span class="nm">${esc(t.name)}</span>
      ${r.bid === "auto" ? `<span class="tag aq" title="Projected conference champion (automatic bid)">AQ</span>` : ""}
      ${r.firstFour ? `<span class="tag ff" title="Plays in the Opening Round (Dayton)">OR</span>` : ""}
    </a>`;
  };
  const bubbleCard = (title, list, note) => `<section class="card">
    <div class="card-head"><span>${title}</span></div>
    <div class="table-wrap"><table class="bubble pin"><tbody>${list.map((r) => { const t = T(r.id); return `<tr>
      <td><a class="team-cell" href="#/team/${t.id}" style="text-decoration:none">${logo(t)}${esc(t.name)}</a></td>
      <td class="num c" title="${P ? "Projected final record" : "Record"}">${P && t.proj ? projRec(t.proj.wins, t.proj.losses) : rec(t.wins, t.losses)}</td>
      <td class="num c dim" title="${P ? "Projected final " : ""}Wins Above Bubble rank">WAB ${rankVal(P && t.proj ? t.proj.wabRank : t.wabRank)}</td>
      <td class="num c dim" title="Torvik rank">TRK ${rankVal(t.trank)}</td>
      <td class="num c odds">${pctText(r.chance)}</td></tr>`; }).join("")}</tbody></table></div>
    ${note ? `<div class="empty">${note}</div>` : ""}
  </section>`;

  const confBids = {};
  for (const r of view.field) { const c = T(r.id).confShort; confBids[c] = (confBids[c] || 0) + 1; }
  const multi = Object.entries(confBids).filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));

  app.innerHTML = `
    <h1 class="page-title">Bracketology</h1>
    ${staleNotice()}
    ${hasProj ? `<div class="mode-toggle" role="tablist" aria-label="Projection mode">
      <button role="tab" data-mode="today" class="${P ? "" : "on"}" aria-selected="${!P}">If the season ended today</button>
      <button role="tab" data-mode="projected" class="${P ? "on" : ""}" aria-selected="${P}">Projected Selection Sunday</button>
    </div>` : ""}
    <p class="page-sub">${P ? `The most likely ${b.fieldSize}-team field after the rest of the season plays out.`
      : `The projected ${b.fieldSize}-team field if the season ended today.`}
      ${b.fieldSize === 76 ? ` New for 2027: 76 teams (32 automatic bids, 44 at-large) and a 12-game Opening Round —
      the 12 lowest automatic qualifiers and the last 12 at-large teams in.` : ""}</p>
    ${P ? `<div class="notice">
      <b>How it works:</b> every remaining game (${b.projected.remainingGames.toLocaleString()} of them) gets a win chance from Torvik's
      offense, defense and tempo ratings plus home court. That game model called <b>${Math.round(b.projected.gameAccuracy * 100)}%</b>
      of this season's ${b.projected.gamesChecked.toLocaleString()} finished games correctly. The season is then played out
      <b>${b.projected.sims.toLocaleString()} times</b>; each run recalculates Wins Above Bubble, crowns conference champions
      and runs the bracket model. Percentages are how often a team made the field. Seeding uses projected WAB + Torvik
      (future NET and SOR can't be projected). Conference tournaments aren't simulated yet, so auto bids go to the likeliest regular-season champion.
    </div>` : `<div class="notice">
      <b>How it works:</b> the model learned from ${b.seasons.length} tournaments (${b.seasons[0]}–${b.seasons[b.seasons.length - 1]})
      how teams' rankings on Selection Sunday turned into bids and seeds. It picks the field using
      <b>${b.selectUses.join(" + ")}</b> and seeds it using <b>${b.seedUses.join(" + ")}</b>${b.seedUses.includes("NET") ? "" : " (NET joins once it's released)"}.
      Tested on the ${bt.seasons.length} past tournaments where all of those were available, it picked
      <b>${bt.atLargePicked} of ${bt.atLargeTotal}</b> at-large teams correctly and had seeds within one line
      <b>${bt.seedWithin1Pct}%</b> of the time (exact ${bt.seedExactPct}%).
      Conference champions (AQ) are projected as the league leader. It's noisy early in the season and sharpens by March.
    </div>`}
    <div class="bracket-layout">
      <section class="card">
        <div class="card-head"><span>Seed List</span><span class="dim-head">AQ = auto bid · OR = Opening Round</span></div>
        <div class="seed-lines">${lines.map((l, seed) => l ? `<div class="seed-line">
          <div class="seed-num">${seed}</div><div class="seed-teams">${l.map(chip).join("")}</div></div>` : "").join("")}
        </div>
      </section>
      <div class="side">
        ${bubbleCard("Last Four Byes", view.bubble.lastFourByes)}
        ${bubbleCard("Last Four In", view.bubble.lastFourIn)}
        ${bubbleCard("First Four Out", view.bubble.firstFourOut)}
        ${bubbleCard("Next Four Out", view.bubble.nextFourOut, P
          ? "% = share of simulated seasons in which the team made the field."
          : "% = how often teams ranked like this got an at-large bid in past seasons.")}
        <section class="card">
          <div class="card-head"><span>Multi-Bid Conferences</span></div>
          <table class="bubble"><tbody>${multi.map(([c, n]) => `<tr><td>${esc(c)}</td><td class="num c">${n}</td></tr>`).join("")}</tbody></table>
        </section>
      </div>
    </div>
    <section class="card guide-card">
      <div class="card-head"><span>What a Ranking Has Meant on Selection Sunday</span></div>
      <div class="guide-tabs" role="tablist">
        <button class="on" data-mode="avgSeed">Average seed</button><button data-mode="inField">Made the field</button>
      </div>
      <div class="table-wrap"><table class="guide pin" id="guide"></table></div>
      <div class="empty" id="guide-note"></div>
    </section>`;
  const systems = Object.keys(b.guide[0]).filter((k) => k !== "range");
  const drawGuide = (mode) => {
    document.getElementById("guide").innerHTML = `
      <thead><tr><th>Rank</th>${systems.map((sy) => `<th class="c">${sy}</th>`).join("")}</tr></thead>
      <tbody>${b.guide.map((g) => `<tr><td class="num">${g.range}</td>${systems.map((sy) => {
        const v = g[sy][mode];
        return `<td class="num c">${v == null ? "—" : mode === "inField" ? v + "%" : `<b>${v}</b>`}</td>`;
      }).join("")}</tr>`).join("")}</tbody>`;
    document.getElementById("guide-note").innerHTML = mode === "avgSeed"
      ? `Example: teams ranked 5–8 by KenPom on Selection Sunday got an average seed of ${b.guide[1].KenPom.avgSeed}; by NET, ${b.guide[1].NET.avgSeed}.
         NET exists since ${b.guideSeasons.NET[0]}; SOR is missing a few early seasons; the rest go back to ${b.seasons[0]}.`
      : `Share of teams in each ranking range that made the tournament (automatic or at-large bid).`;
  };
  app.querySelectorAll(".guide-tabs button").forEach((btn) => btn.addEventListener("click", () => {
    app.querySelectorAll(".guide-tabs button").forEach((x) => x.classList.toggle("on", x === btn));
    drawGuide(btn.dataset.mode);
  }));
  drawGuide("avgSeed");
  app.querySelectorAll(".mode-toggle button").forEach((btn) => btn.addEventListener("click", () => {
    store.set("bracketMode", btn.dataset.mode);
    renderBracket();
  }));
}

boot().catch((e) => {
  app.innerHTML = `<p class="loading">Couldn't load the data (${esc(e.message)}).</p>`;
});

// Hoops Resume - front end.
// Reads data/teams.json (all teams) and data/team/<id>.json (one team's games).
// Pages:  #/            -> every team, sortable
//         #/team/<id>   -> one team's resume
//         #/margin      -> margin of defeat (points lost by, and who to)

const state = { meta: null, byId: {}, sort: null, search: "", conf: "", modTop: "50", modConf: "" };
const app = document.getElementById("app");

const QUAD_NAMES = { 1: "Quad 1", 2: "Quad 2", 3: "Quad 3", 4: "Quad 4", 0: "Non-D1" };
const LOC = { H: "vs", A: "@", N: "N" };

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rec = (w, l) => `${w}-${l}`;
const fmtDate = (iso) => { const [y, m, d] = iso.split("-"); return `${+m}/${+d}`; };
const logo = (t, cls = "logo") => t && t.logo
  ? `<img class="${cls}" src="${esc(t.logo)}" alt="" loading="lazy">`
  : `<span class="${cls} blank"></span>`;
const rankVal = (v) => (v == null ? "—" : v);
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
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const m = location.hash.match(/^#\/team\/(\w+)/);
  const page = m ? "team" : location.hash.startsWith("#/margin") ? "margin" : "home";
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  if (m && state.byId[m[1]]) renderTeam(m[1]);
  else if (page === "margin") renderMargin();
  else renderHome();
  window.scrollTo(0, 0);
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
];

function renderHome() {
  document.title = "Hoops Resume";
  const confs = [...new Set(state.meta.teams.map((t) => t.conf))].sort();
  app.innerHTML = `
    ${quadNotice()}
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
  document.title = `${t.name} · Hoops Resume`;
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
  const color = "#" + (t.color || "0b1d4a");

  const tile = (label, v, hint = "") =>
    `<div class="tile"><div class="label">${label}</div><div class="value num ${v == null ? "na" : ""}">${v ?? "—"}</div>${hint ? `<div class="hint">${hint}</div>` : ""}</div>`;

  app.innerHTML = `
    <div class="picker">
      <a class="back" href="#/">← All teams</a>
      <select id="pick-conf" aria-label="Conference">${confs.map((c) => `<option ${c === t.conf ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="pick-team" aria-label="School">${confTeams.slice().sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => `<option value="${x.id}" ${x.id === id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
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
      ${tile("AP", t.ap, t.ap ? "" : "Unranked")}
      ${tile("NET", t.net, t.net ? "" : "Not out yet")}
      ${tile("BPI", t.bpiRank, t.bpi != null ? `Rating ${t.bpi > 0 ? "+" : ""}${t.bpi}` : "")}
      ${tile("Torvik", t.trank)}
      ${tile("Strength of Record", t.sor)}
      ${tile("Wins Above Bubble", t.wabRank, t.wab != null ? `${t.wab > 0 ? "+" : ""}${t.wab} wins` : "")}
      ${tile("SOS", t.sos)}
      ${tile("Non-Con SOS", t.ncsos)}
    </div>

    <div class="layout">
      <div class="quads">
        ${[1, 2, 3, 4].map((q) => quadCard(q, t, games)).join("")}
        ${games.some((g) => g.quad === 0) ? quadCard(0, t, games) : ""}
        ${rosterCard(roster)}
      </div>
      <div class="side">
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

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function gameRow(g) {
  const opp = state.byId[g.oppId];
  const name = opp ? `<a href="#/team/${opp.id}">${esc(opp.name)}</a>` : `<span>${esc(g.oppName)}</span>`;
  const rk = g.oppRank ? `<span class="rk">${rankSourceLabel()} ${g.oppRank}</span>` : "";
  const res = g.final ? `<span class="chip ${g.result}">${g.result}</span>` : `<span class="chip U">–</span>`;
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
    ${shown.length ? `<table class="games"><tbody>${shown.map(gameRow).join("")}</tbody></table>` : `<div class="empty">No games.</div>`}
  </section>`;
}

function listCard(title, list, emptyText) {
  return `<section class="card">
    <div class="card-head"><span>${title}</span></div>
    ${list.length ? `<table class="games"><tbody>${list.map(gameRow).join("")}</tbody></table>` : `<div class="empty">${emptyText}</div>`}
  </section>`;
}

function standingsCard(t, confTeams) {
  return `<section class="card">
    <div class="card-head"><span>${esc(t.conf)} Standings</span></div>
    <table class="standings">
      <thead><tr><th>Team</th><th class="c">Conf</th><th class="c">Overall</th></tr></thead>
      <tbody>${confTeams.map((x) => `
        <tr class="${x.id === t.id ? "me" : ""}" data-id="${x.id}">
          <td><span class="team-cell">${logo(x)}${esc(x.name)}</span></td>
          <td class="num c">${rec(x.confWins, x.confLosses)}</td>
          <td class="num c">${rec(x.wins, x.losses)}</td>
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
  document.title = "Margin of Defeat · Hoops Resume";
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

boot().catch((e) => {
  app.innerHTML = `<p class="loading">Couldn't load the data (${esc(e.message)}).</p>`;
});

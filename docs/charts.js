// Nasta's Bracket Lab - charts (hand-drawn SVG, no libraries).
// Each draw function takes a container element and fills it with an SVG sized to the
// container's current width. Charts.redrawAll() re-draws them when the window is resized.

const Charts = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const active = new Map(); // container -> redraw function
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDay = (iso) => { const [, m, d] = iso.split("-"); return `${+m}/${+d}`; };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const toTime = (iso) => Date.parse(iso + "T12:00:00");

  // Trend series: fixed order and color slot, so a team's lines keep their colors.
  const SERIES = [
    { key: "master", label: "Master", slot: 1, width: 3 },
    { key: "bpi", label: "BPI", slot: 2 },
    { key: "torvik", label: "Torvik", slot: 3 },
    { key: "sor", label: "SOR", slot: 4 },
    { key: "wab", label: "WAB", slot: 5 },
    { key: "net", label: "NET", slot: 6 },
  ];

  // ---------- tooltip (one shared element) ----------
  let tip;
  function tooltip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.setAttribute("role", "status");
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(evt, html) {
    const t = tooltip();
    t.innerHTML = html;
    t.style.display = "block";
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    t.style.left = `${Math.max(8, x)}px`;
    t.style.top = `${Math.max(8, y)}px`;
  }
  function hideTip() { if (tip) tip.style.display = "none"; }
  document.addEventListener("scroll", hideTip, { passive: true });

  // ---------- svg helpers ----------
  function svg(w, h, label) {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.setAttribute("width", w);
    s.setAttribute("height", h);
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", label);
    s.classList.add("chart");
    return s;
  }
  function el(parent, tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    parent.appendChild(e);
    return e;
  }
  const logScale = (lo, hi, a, b) => (v) => a + (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (b - a);
  const linScale = (lo, hi, a, b) => (v) => a + (v - lo) / (hi - lo || 1) * (b - a);
  // Rank gridlines: nice values inside the range, thinned to about `max` labels.
  function rankTicks(lo, hi, max = 7) {
    const nice = [1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250, 350];
    let t = nice.filter((v) => v >= lo && v <= hi);
    while (t.length > max) t = t.filter((_, i) => i % 2 === 0);
    return t;
  }
  function monthTicks(t0, t1) {
    const out = [];
    const d = new Date(t0);
    d.setDate(1); d.setHours(12);
    if (d.getTime() < t0) d.setMonth(d.getMonth() + 1);
    while (d.getTime() <= t1) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
    return out;
  }
  function mount(container, draw) {
    active.set(container, draw);
    draw();
  }
  function redrawAll() {
    for (const [c, draw] of active) {
      if (!document.body.contains(c)) active.delete(c);
      else draw();
    }
  }
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(redrawAll, 150); });

  // ---------- 1. Résumé: every game by opponent rank ----------
  // games: team games ({date, oppId, oppName, oppRank, loc, final, result, score, quad, winProb})
  function resume(container, games, opts) {
    mount(container, () => {
      container.innerHTML = "";
      const W = Math.max(300, container.clientWidth), H = W < 500 ? 240 : 270;
      const m = { t: 12, r: 14, b: 28, l: 52 };
      const s = svg(W, H, "Every game by opponent rank");
      const list = games.filter((g) => g.date);
      if (!list.length) { container.textContent = "No games yet."; return; }
      const t0 = toTime(list[0].date) - 4 * 864e5, t1 = toTime(list[list.length - 1].date) + 4 * 864e5;
      const x = linScale(t0, t1, m.l, W - m.r);
      const nonD1Y = H - m.b - 6;
      const y = logScale(1, 365, m.t + 6, nonD1Y - 22);

      // grid + rank labels
      for (const v of [1, 5, 10, 25, 50, 100, 200, 350]) {
        el(s, "line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" });
        el(s, "text", { x: m.l - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, v);
      }
      if (list.some((g) => g.quad === 0)) el(s, "text", { x: m.l - 8, y: nonD1Y + 4, class: "axis", "text-anchor": "end" }, "Non-D1");
      for (const tm of monthTicks(t0, t1)) {
        el(s, "line", { x1: x(tm), x2: x(tm), y1: m.t, y2: H - m.b, class: "grid faint" });
        el(s, "text", { x: x(tm) + 3, y: H - 8, class: "axis" }, MONTHS[new Date(tm).getMonth()]);
      }
      // today marker
      const now = Date.now();
      if (now > t0 && now < t1) {
        el(s, "line", { x1: x(now), x2: x(now), y1: m.t, y2: H - m.b, class: "today" });
        el(s, "text", { x: x(now) + 4, y: m.t + 10, class: "axis" }, "Today");
      }
      // dots
      for (const g of list) {
        const cx = x(toTime(g.date));
        const cy = g.quad === 0 ? nonD1Y : y(Math.min(365, Math.max(1, g.oppRank || 365)));
        const cls = g.final ? (g.result === "W" ? "dot win" : "dot loss") : "dot upcoming";
        el(s, "circle", { cx, cy, r: 5.5, class: cls });
        const hit = el(s, "circle", { cx, cy, r: 12, class: "hit" });
        const opp = opts.byId[g.oppId];
        const where = g.loc === "H" ? "vs" : g.loc === "A" ? "at" : "vs (neutral)";
        const qText = g.quad === 0 ? "Non-D1" : g.quad ? `Quad ${g.quad}` : "";
        const html = `<b>${fmtDay(g.date)} ${where} ${esc(opp ? opp.name : g.oppName)}</b><br>
          ${g.final ? `${g.result === "W" ? "Won" : "Lost"} ${esc(g.score)}` : g.winProb != null ? `${Math.round(g.winProb * 100)}% chance to win` : "Upcoming"}<br>
          <span class="tip-dim">${g.oppRank ? `${opts.rankLabel} ${g.oppRank}` : ""}${qText ? ` · ${qText}` : ""}</span>`;
        hit.addEventListener("pointerenter", (e) => showTip(e, html));
        hit.addEventListener("pointermove", (e) => showTip(e, html));
        hit.addEventListener("pointerleave", hideTip);
        if (opp) hit.addEventListener("click", () => { hideTip(); location.hash = `#/team/${opp.id}`; });
      }
      container.appendChild(s);
    });
  }

  // ---------- 2. Ranking trends ----------
  // trend: {dates: [...], master: [...], bpi: [...], ...}
  function trends(container, trend) {
    mount(container, () => {
      container.innerHTML = "";
      if (!trend || !trend.dates || trend.dates.length < 2) {
        container.innerHTML = `<div class="empty">Trend lines fill in as the season goes (one point per day).</div>`;
        return;
      }
      const series = SERIES.filter((sr) => (trend[sr.key] || []).some((v) => v != null));
      const W = Math.max(300, container.clientWidth), H = W < 500 ? 220 : 250;
      const m = { t: 14, r: 16, b: 28, l: 40 };
      const s = svg(W, H, "Ranking trends");
      const times = trend.dates.map(toTime);
      const all = series.flatMap((sr) => trend[sr.key].filter((v) => v != null));
      const lo = Math.max(1, Math.min(...all) / 1.4), hi = Math.max(...all) * 1.25;
      const x = linScale(times[0], times[times.length - 1], m.l, W - m.r);
      const y = logScale(lo, hi, m.t, H - m.b); // rank 1 at the top
      for (const v of rankTicks(lo, hi)) {
        el(s, "line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" });
        el(s, "text", { x: m.l - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, v);
      }
      // date labels: first, last and a few between
      const step = Math.max(1, Math.ceil(times.length / (W < 500 ? 4 : 7)));
      times.forEach((tm, i) => {
        if (i % step === 0 || i === times.length - 1) {
          el(s, "text", { x: x(tm), y: H - 8, class: "axis", "text-anchor": i === 0 ? "start" : i === times.length - 1 ? "end" : "middle" }, fmtDay(trend.dates[i]));
        }
      });
      for (const sr of [...series].reverse()) {   // Master last, so it sits on top where lines overlap
        const pts = trend[sr.key].map((v, i) => (v == null ? null : [x(times[i]), y(v)]));
        let d = "", pen = false;
        for (const p of pts) { if (!p) { pen = false; continue; } d += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`; pen = true; }
        el(s, "path", { d, class: `line s${sr.slot}`, "stroke-width": sr.width || 2 });
        if (times.length <= 20) for (const p of pts) if (p) el(s, "circle", { cx: p[0], cy: p[1], r: 3.5, class: `pt s${sr.slot}` });
      }
      // crosshair + tooltip
      const cross = el(s, "line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, class: "cross", visibility: "hidden" });
      const overlay = el(s, "rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, class: "hit" });
      const near = (evt) => {
        const r = s.getBoundingClientRect();
        const px = (evt.clientX - r.left) * (W / r.width);
        let best = 0;
        times.forEach((tm, i) => { if (Math.abs(x(tm) - px) < Math.abs(x(times[best]) - px)) best = i; });
        return best;
      };
      const move = (evt) => {
        const i = near(evt);
        cross.setAttribute("x1", x(times[i])); cross.setAttribute("x2", x(times[i])); cross.setAttribute("visibility", "visible");
        const rows = series.map((sr) => `<span class="tip-row"><i class="sw s${sr.slot}"></i>${sr.label}<b>${trend[sr.key][i] ?? "—"}</b></span>`).join("");
        showTip(evt, `<b>${fmtDay(trend.dates[i])}</b>${rows}`);
      };
      overlay.addEventListener("pointermove", move);
      overlay.addEventListener("pointerenter", move);
      overlay.addEventListener("pointerleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); });
      container.appendChild(s);
      // legend
      const lg = document.createElement("div");
      lg.className = "legend";
      // Legend doubles as a value readout (latest rank per series), so identity and value never rely on color alone.
      const latest = (sr) => { const v = trend[sr.key]; for (let i = v.length - 1; i >= 0; i--) if (v[i] != null) return v[i]; return "—"; };
      lg.innerHTML = series.map((sr) => `<span><i class="sw s${sr.slot}"></i>${sr.label} <b>${latest(sr)}</b></span>`).join("")
        + `<span class="legend-note">latest</span>`;
      container.appendChild(lg);
    });
  }

  // ---------- 3. Best vs most deserving (Torvik rank vs WAB rank) ----------
  function scatter(container, teams, opts) {
    mount(container, () => {
      container.innerHTML = "";
      const pts = teams.filter((t) => t.trank && t.wabRank);
      const W = Math.max(300, container.clientWidth), H = Math.min(560, Math.max(320, Math.round(W * 0.62)));
      const m = { t: 16, r: 18, b: 42, l: 52 };
      const s = svg(W, H, "Torvik rank versus Wins Above Bubble rank for every team");
      const x = logScale(365, 1, m.l, W - m.r);   // best (1) at the right
      const y = logScale(1, 365, m.t, H - m.b);   // best (1) at the top
      const ticks = W < 500 ? [1, 5, 25, 100, 350] : [1, 2, 5, 10, 25, 50, 100, 200, 350];
      for (const v of ticks) {
        el(s, "line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "grid" });
        el(s, "text", { x: m.l - 8, y: y(v) + 4, class: "axis", "text-anchor": "end" }, v);
        el(s, "line", { x1: x(v), x2: x(v), y1: m.t, y2: H - m.b, class: "grid" });
        el(s, "text", { x: x(v), y: H - m.b + 16, class: "axis", "text-anchor": "middle" }, v);
      }
      el(s, "text", { x: (m.l + W - m.r) / 2, y: H - 6, class: "axis strong", "text-anchor": "middle" }, "Torvik rank: how good they are  →  better");
      el(s, "text", { x: 14, y: (m.t + H - m.b) / 2, class: "axis strong", "text-anchor": "middle", transform: `rotate(-90 14 ${(m.t + H - m.b) / 2})` }, "WAB rank: what they've earned  →  better");
      el(s, "line", { x1: x(365), y1: y(365), x2: x(1), y2: y(1), class: "diag" });
      if (W >= 420) {
        el(s, "text", { x: x(250), y: y(3), class: "corner" }, "Résumé ahead of rating");
        el(s, "text", { x: x(1.5), y: y(250), class: "corner", "text-anchor": "end" }, "Rating ahead of résumé");
      }
      const hl = opts.highlight || (() => false);
      const ordered = [...pts].sort((a, b) => hl(a) - hl(b)); // highlighted on top
      for (const t of ordered) {
        const on = hl(t);
        const c = el(s, "circle", { cx: x(t.trank), cy: y(t.wabRank), r: on ? 5.5 : 4, class: on ? "dot hl" : "dot base" });
        const html = `<b>${esc(t.name)}</b> <span class="tip-dim">${esc(t.confShort)} · ${t.wins}-${t.losses}</span><br>
          Torvik ${t.trank} · WAB ${t.wabRank}${t.masterRank ? ` · Master ${t.masterRank}` : ""}`;
        c.addEventListener("pointerenter", (e) => showTip(e, html));
        c.addEventListener("pointermove", (e) => showTip(e, html));
        c.addEventListener("pointerleave", hideTip);
        c.addEventListener("click", () => { hideTip(); location.hash = `#/team/${t.id}`; });
        if (on && opts.labelHighlighted) el(s, "text", { x: x(t.trank) + 7, y: y(t.wabRank) + 4, class: "lbl" }, t.name);
      }
      container.appendChild(s);
    });
  }

  // ---------- 4. Movers ----------
  // rows: [{id, from, to, change}], metric "odds" | "master"
  function movers(container, rows, opts) {
    mount(container, () => {
      container.innerHTML = "";
      if (!rows.length) { container.innerHTML = `<div class="empty">No big moves yet.</div>`; return; }
      const W = Math.max(280, container.clientWidth), rowH = 30, labelW = Math.min(150, W * 0.42), valW = 92;
      const H = rows.length * rowH + 6;
      const s = svg(W, H, opts.title);
      const max = Math.max(...rows.map((r) => Math.abs(r.change)));
      const bw = (v) => Math.max(3, (Math.abs(v) / max) * (W - labelW - valW - 8));
      rows.forEach((r, i) => {
        const t = opts.byId[r.id];
        const yy = i * rowH + 4;
        el(s, "text", { x: labelW - 8, y: yy + 17, class: "lbl", "text-anchor": "end" }, t ? t.name : r.id);
        el(s, "rect", { x: labelW, y: yy + 7, width: bw(r.change), height: 14, rx: 4, class: r.change > 0 ? "bar up" : "bar down" });
        const val = opts.metric === "odds"
          ? `${r.change > 0 ? "+" : ""}${Math.round(r.change * 100)} pts`
          : `${r.from} → ${r.to}`;
        el(s, "text", { x: labelW + bw(r.change) + 6, y: yy + 18, class: "val" }, val);
        const hit = el(s, "rect", { x: 0, y: yy, width: W, height: rowH, class: "hit" });
        const html = opts.metric === "odds"
          ? `<b>${esc(t ? t.name : "")}</b><br>Tournament odds ${Math.round(r.from * 100)}% → ${Math.round(r.to * 100)}%`
          : `<b>${esc(t ? t.name : "")}</b><br>Master Rank ${r.from} → ${r.to}`;
        hit.addEventListener("pointerenter", (e) => showTip(e, html));
        hit.addEventListener("pointermove", (e) => showTip(e, html));
        hit.addEventListener("pointerleave", hideTip);
        if (t) hit.addEventListener("click", () => { hideTip(); location.hash = `#/team/${t.id}`; });
      });
      container.appendChild(s);
    });
  }

  return { resume, trends, scatter, movers, redrawAll, hideTip };
})();

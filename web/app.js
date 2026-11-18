/* Swiss certificate landscape: choropleth of cantons and municipalities. */
(function () {
  "use strict";

  // Self-hosted copy first (the published site ships one), CDN as fallback.
  const TOPO_LOCAL = "data/ch-combined.json";
  const TOPO_CDN = "https://unpkg.com/swiss-maps@4.7.0/2026/ch-combined.json";
  const fetchTopo = () => fetch(TOPO_LOCAL).then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .catch(() => fetch(TOPO_CDN).then((r) => r.json()));
  const params = new URLSearchParams(location.search);
  const DATA_URL = params.get("data") || "data/map.json";

  const state = {
    lang: pickLang(), level: "canton", metric: "tm", selected: null,
    data: null, topo: null, layer: null, lakes: null, sort: { key: "tm", dir: -1 },
  };

  function pickLang() {
    const p = params.get("lang");
    if (p && I18N[p]) return p;
    try { const s = localStorage.getItem("lang"); if (s && I18N[s]) return s; } catch (e) { /* storage blocked */ }
    const nav = (navigator.language || "de").slice(0, 2);
    return I18N[nav] ? nav : "de";
  }
  const t = (k) => (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || k;
  const fmt = (v) => (v === null || v === undefined ? "–" : String(v));
  const pct = (x) => (x === null || x === undefined ? "–" : Math.round(100 * x) + " %");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const css = (name) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();

  /* ---- colour ----------------------------------------------------------- */
  const BINS = [0, 20, 40, 60, 80];          // 0-19, 20-39, 40-59, 60-79, 80-100
  function seqColor(v) {
    if (v === null || v === undefined) return css("--nodata");
    let i = 0;
    for (let b = 0; b < BINS.length; b++) if (v >= BINS[b]) i = b;
    return css("--seq-" + (i + 1));
  }
  const CAA_COLORS = { swiss: "--cat-1", other: "--cat-2", none: "--nodata" };
  const TM_CAT = { tm_own: "ownership", tm_sov: "sovereignty", tm_sec: "security", tm_prv: "privacy" };
  const LIGHT_COLORS = { green: "--good", yellow: "--warning", red: "--critical" };
  const isTM = (m) => m === "tm" || m in TM_CAT;
  function lightOf(v) {
    if (v === null || v === undefined) return "none";
    return v >= 80 ? "green" : v >= 50 ? "yellow" : "red";
  }
  function colorFor(e) {
    if (!e) return css("--nodata");
    if (state.metric === "caa") return e.caa ? css(CAA_COLORS[e.caa]) : css("--nodata");
    if (isTM(state.metric)) {
      const l = lightOf(value(e));
      return l === "none" ? css("--nodata") : css(LIGHT_COLORS[l]);
    }
    return seqColor(value(e));
  }
  function value(e, metric) {
    const m = metric || state.metric;
    if (!e) return null;
    if (m === "tm") return e.tm && e.tm.o !== undefined ? e.tm.o : null;
    if (m in TM_CAT) return e.tm && e.tm.c ? (e.tm.c[TM_CAT[m]] === undefined ? null : e.tm.c[TM_CAT[m]]) : null;
    return e[m] === undefined ? null : e[m];
  }
  function valueText(e) {
    if (!e) return t("no_data");
    if (state.metric === "caa") return e.caa ? t("caa_" + e.caa) : t("no_data");
    const v = value(e);
    return v === null ? t("no_data") : v + " / 100";
  }

  /* ---- i18n ------------------------------------------------------------- */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === state.lang));
    document.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === state.level));
    updateNote();
  }
  function updateNote() {
    const data = state.data;
    if (!data) return;
    let note = t("data_note").replace("{date}", (data.generated || "").slice(0, 10));
    if (data.ct_lag_days && data.ct_lag_days > 7) note += " " + t("lag_note").replace("{lag}", Math.round(data.ct_lag_days));
    document.getElementById("datanote").textContent = note;
  }

  /* ---- map -------------------------------------------------------------- */
  const map = L.map("map", { zoomControl: true, attributionControl: true, minZoom: 7, maxZoom: 13, zoomSnap: 0.25 })
    .setView([46.8, 8.23], 8);
  map.attributionControl.setPrefix("");
  map.attributionControl.addAttribution('Geodata: <a href="https://github.com/interactivethings/swiss-maps">swiss-maps</a> (swisstopo)');

  const tip = document.getElementById("tooltip");
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = document.querySelector(".mapwrap").getBoundingClientRect();
    let x = ev.originalEvent.clientX - r.left + 14, y = ev.originalEvent.clientY - r.top + 14;
    if (x + tip.offsetWidth > r.width - 8) x -= tip.offsetWidth + 28;
    if (y + tip.offsetHeight > r.height - 8) y -= tip.offsetHeight + 28;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.hidden = true; }

  function entities() { return (state.data && state.data.entities[state.level]) || {}; }

  function draw() {
    if (!state.topo || !state.data) return;
    if (state.layer) state.layer.remove();
    const obj = state.level === "canton" ? state.topo.objects.cantons : state.topo.objects.municipalities;
    const ents = entities();
    const fc = topojson.feature(state.topo, obj);
    state.layer = L.geoJSON(fc, {
      style: (f) => ({ fillColor: colorFor(ents[String(f.id)]), fillOpacity: 1, color: css("--surface-1"),
                       weight: state.level === "canton" ? 1.2 : 0.4 }),
      onEachFeature: (f, lyr) => {
        const id = String(f.id), e = ents[id];
        const name = (e && e.n) || (f.properties && f.properties.name) || id;
        lyr.on("mousemove", (ev) => {
          showTip(ev, "<b>" + esc(name) + "</b><br>" + esc(t("m_" + state.metric)) + ": " + esc(valueText(e)));
          lyr.setStyle({ weight: 2, color: css("--text-primary") });
          lyr.bringToFront();
        });
        lyr.on("mouseout", () => { hideTip(); state.layer.resetStyle(lyr); });
        lyr.on("click", () => select(state.level, id));
      },
    }).addTo(map);
    if (state.lakes) state.lakes.bringToFront();
    legend();
  }

  function legend() {
    const el = document.getElementById("legend");
    let rows = "";
    if (isTM(state.metric)) {
      rows = [["green", "80–100"], ["yellow", "50–79"], ["red", "0–49"]].map(([k, r]) =>
        '<div class="row"><span class="sw" style="background:' + css(LIGHT_COLORS[k]) + '"></span>' + esc(t("light_" + k)) + " " + r + "</div>").join("");
      rows += '<div class="row"><span class="sw" style="background:' + css("--nodata") + '"></span>' + esc(t("not_assessed")) + "</div>";
    } else if (state.metric === "caa") {
      rows = ["swiss", "other", "none"].map((k) =>
        '<div class="row"><span class="sw" style="background:' + css(CAA_COLORS[k]) + '"></span>' + esc(t("caa_" + k)) + "</div>").join("");
    } else {
      const labels = ["0–19", "20–39", "40–59", "60–79", "80–100"];
      rows = labels.map((l, i) => '<div class="row"><span class="sw" style="background:' + css("--seq-" + (i + 1)) + '"></span>' + l + "</div>").join("");
      rows += '<div class="row"><span class="sw" style="background:' + css("--nodata") + '"></span>' + esc(t("no_data")) + "</div>";
    }
    el.innerHTML = '<div class="t">' + esc(t("m_" + state.metric)) + '</div><div class="d">' + esc(t("m_" + state.metric + "_d")) + "</div>" + rows;
  }

  /* ---- side panel -------------------------------------------------------- */
  function zoneBar(z) {
    const parts = [["ch", "--cat-1"], ["eea", "--cat-3"], ["third", "--cat-2"], ["unknown", "--nodata"]];
    const segs = parts.filter(([k]) => z[k] > 0).map(([k, c]) =>
      '<span title="' + esc(t("z_" + k)) + " " + pct(z[k]) + '" style="width:' + (100 * z[k]) + "%;background:" + css(c) + '"></span>').join("");
    const keys = parts.filter(([k]) => z[k] > 0).map(([k, c]) =>
      '<span><i style="background:' + css(c) + '"></i>' + esc(t("z_" + k)) + " " + pct(z[k]) + "</span>").join("");
    return '<div class="bar" role="img" aria-label="' + esc(t("zones")) + '">' + segs + '</div><div class="keyrow">' + keys + "</div>";
  }

  function detail(level, id) {
    const e = (state.data.entities[level] || {})[id];
    const panel = document.getElementById("panel");
    if (!e) { panel.innerHTML = '<button class="close" data-close>✕</button><p class="muted">' + esc(t("no_data")) + "</p>"; return; }
    const kpi = (v, l) => '<div class="kpi"><div class="v">' + esc(fmt(v)) + '</div><div class="l">' + esc(l) + "</div></div>";
    const vc = e.v || {};
    const cas = (e.cas || []).map((c) => "<tr><td>" + esc(c[0]) + "</td><td>" + esc(c[1]) + '</td><td class="num">' + c[3] + "</td></tr>").join("");
    const checks = Object.entries(e.chk || {}).map(([k, s]) =>
      '<li><span class="st ' + (s === "n/a" ? "na" : s) + '">' + esc(t(s)) + "</span><span>" + esc(t("c_" + k)) + "</span></li>").join("");
    const dict = (o) => Object.entries(o || {}).map(([k, v]) => esc(k) + " " + v).join(", ") || "–";
    panel.innerHTML =
      '<button class="close" data-close aria-label="' + esc(t("close")) + '">✕</button>' +
      "<h2>" + esc(e.n) + "</h2>" +
      '<p class="sub">' + esc((e.d || []).join(", ")) + "</p>" +
      (e.sd ? '<p class="note">' + esc(t("shared")) + "</p>" : "") +
      tmSection(e) + stackSection(e) +
      "<h3>" + esc(t("m_s")) + " · " + esc(t("m_a")) + "</h3>" +
      '<div class="kpis">' + kpi(e.s, t("m_s")) + kpi(e.a, t("m_a")) + kpi(e.cs, t("m_cs")) + kpi(e.ca, t("m_ca")) + "</div>" +
      '<p class="sub" style="margin-top:8px">' + esc(t("hosts_in_use")) + ": <b>" + e.h + "</b> (" + esc(t("critical")) + " " + e.hc + ") · " +
      e.hf + " " + esc(t("hosts_found")) + "</p>" +
      "<h3>" + esc(t("zones")) + "</h3>" + zoneBar(e.z || {}) +
      "<h3>" + esc(t("cas")) + "</h3><table><thead><tr><th>" + esc(t("ca_col")) + "</th><th>" + esc(t("country_col")) +
      '</th><th class="num">' + esc(t("hosts_col")) + "</th></tr></thead><tbody>" + (cas || '<tr><td colspan="3">–</td></tr>') + "</tbody></table>" +
      "<h3>" + esc(t("validation")) + "</h3><p class=\"sub\">DV " + (vc.DV || 0) + " · OV " + ((vc.OV || 0) + (vc.IV || 0)) + " · EV " + (vc.EV || 0) +
      (vc.unknown ? " · ? " + vc.unknown : "") + " · " + esc(t("automated")) + " " + pct(e.auto) + "</p>" +
      "<h3>" + esc(t("m_caa")) + "</h3><p class=\"sub\">" + esc(e.caa ? t("caa_" + e.caa) : t("no_data")) +
      ((e.caai || []).length ? ": " + esc(e.caai.join(", ")) : "") + "</p>" +
      "<h3>" + esc(t("checks")) + '</h3><ul class="checks">' + checks + "</ul>" +
      "<h3>" + esc(t("platforms")) + '</h3><p class="sub">' + dict(e.plat) + "</p>" +
      "<h3>" + esc(t("network")) + '</h3><p class="sub">' + dict(e.net) + "</p>";
  }

  function chip(l, text) {
    const col = l === "none" ? css("--nodata") : css(LIGHT_COLORS[l]);
    return '<span class="chip"><i style="background:' + col + '"></i>' + esc(text || t(l === "none" ? "not_assessed" : "light_" + l)) + "</span>";
  }
  function tmSection(e) {
    const tm = e.tm || {};
    if (tm.o === undefined || tm.o === null) return "";
    const cats = [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]];
    const rows = cats.map(([c, m]) => {
      const v = tm.c ? tm.c[c] : null;
      return '<div class="cat"><span>' + esc(t("m_" + m)) + '</span><span class="num">' + fmt(v) + "</span>" + chip(lightOf(v)) + "</div>";
    }).join("");
    const checks = Object.entries(tm.k || {}).map(([id, c]) =>
      "<tr><td>" + esc(t(id)) + '</td><td class="num">' + Math.round(100 * (c.pass + 0.5 * c.partial) / c.assessed) + ' %</td><td class="num">' + c.assessed + "</td></tr>").join("");
    return "<h3>" + esc(t("trustmark")) + '</h3><div class="tmhead"><span class="v">' + fmt(tm.o) + "</span>" + chip(lightOf(tm.o)) +
      (tm.el ? chip("green", t("eligible")) : "") + '</div><p class="sub">' + (tm.n || 0) + " " + esc(t("resources")) +
      (tm.ko ? " · " + tm.ko + " " + esc(t("knockouts")) : "") + "</p>" + rows +
      '<table style="margin-top:8px"><thead><tr><th>' + esc(t("check_col")) + '</th><th class="num">' + esc(t("pass_col")) +
      '</th><th class="num">n</th></tr></thead><tbody>' + checks + "</tbody></table>";
  }
  function stackSection(e) {
    const st = e.stack;
    if (!st) return "";
    const list = (arr, fmtItem) => (arr && arr.length ? arr.map(fmtItem).join("<br>") : "–");
    return "<h3>" + esc(t("stack")) + '</h3><table class="stack"><tbody>' +
      "<tr><td>" + esc(t("st_tld")) + "</td><td>." + esc((st.tld || []).join(", .")) + "</td></tr>" +
      "<tr><td>" + esc(t("st_dns")) + "</td><td>" + list(st.dns, (x) => esc(x[0]) + " (" + esc(x[1]) + ")") + "</td></tr>" +
      "<tr><td>" + esc(t("st_dnssec")) + "</td><td>" + esc(t(st.dnssec ? "yes" : "no")) + "</td></tr>" +
      "<tr><td>" + esc(t("st_host")) + "</td><td>" + list(st.host, (x) => esc(x[0]) + ": " + x[1]) + "</td></tr>" +
      "<tr><td>" + esc(t("st_ca")) + "</td><td>" + list(st.ca, (x) => esc(x[0]) + " (" + esc(x[1]) + "): " + x[2]) + "</td></tr>" +
      "<tr><td>" + esc(t("st_root")) + "</td><td>" + list(st.root, (x) => esc(x[0]) + ": " + x[1]) + "</td></tr>" +
      "</tbody></table>";
  }

  function overview() {
    const panel = document.getElementById("panel");
    const cantons = Object.entries(state.data.entities.canton || {});
    const all = Object.values(state.data.entities[state.level] || {});
    const hosts = all.reduce((a, e) => a + (e.h || 0), 0);
    const zsum = { ch: 0, eea: 0, third: 0, unknown: 0 };
    all.forEach((e) => Object.keys(zsum).forEach((k) => { zsum[k] += (e.z && e.z[k] ? e.z[k] : 0) * (e.h || 0); }));
    if (hosts) Object.keys(zsum).forEach((k) => { zsum[k] = zsum[k] / hosts; });
    const key = state.sort.key, dir = state.sort.dir;
    cantons.sort((a, b) => {
      const va = key === "n" ? a[1].n : (value(a[1], key) === null ? -1 : value(a[1], key));
      const vb = key === "n" ? b[1].n : (value(b[1], key) === null ? -1 : value(b[1], key));
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
    const th = (k, label, num) => '<th data-sort="' + k + '"' + (num ? ' class="num"' : "") + ">" + esc(label) +
      (state.sort.key === k ? (state.sort.dir < 0 ? " ↓" : " ↑") : "") + "</th>";
    const rows = cantons.map(([id, e]) => '<tr class="click" data-sel="canton:' + id + '"><td>' + esc(e.c || e.n) +
      '</td><td class="num">' + fmt(value(e, "tm")) + '</td><td class="num">' + fmt(e.s) + '</td><td class="num">' + fmt(e.a) +
      '</td><td class="num">' + fmt(e.h) + "</td></tr>").join("");
    panel.innerHTML = "<h2>" + esc(t("overview")) + '</h2><p class="sub">' + esc(t("overview_text")) + "</p>" +
      "<h3>" + esc(t("national")) + ' · ' + esc(t(state.level === "canton" ? "level_canton" : "level_municipality")) + "</h3>" +
      '<p class="sub">' + esc(t("total_hosts")) + ": <b>" + hosts + "</b></p>" + zoneBar(zsum) +
      (cantons.length ? "<h3>" + esc(t("ranking")) + "</h3><table><thead><tr>" + th("n", t("rank_name")) + th("tm", "TM", 1) + th("s", t("s_short"), 1) +
        th("a", t("a_short"), 1) + th("h", t("h_short"), 1) + "</tr></thead><tbody>" + rows + "</tbody></table>" : "");
  }

  function select(level, id) {
    state.selected = level && id ? { level, id } : null;
    if (state.selected) detail(level, id); else overview();
    try {
      const u = new URL(location.href);
      if (state.selected) u.searchParams.set("sel", level + ":" + id); else u.searchParams.delete("sel");
      history.replaceState(null, "", u);
    } catch (e) { /* sandboxed viewers may refuse history changes */ }
  }

  function refreshPanel() {
    if (state.selected) detail(state.selected.level, state.selected.id); else overview();
  }

  /* ---- events ----------------------------------------------------------- */
  document.addEventListener("click", (ev) => {
    const lang = ev.target.closest("[data-lang]");
    if (lang) { state.lang = lang.dataset.lang; try { localStorage.setItem("lang", state.lang); } catch (e) { /* ignore */ }
      applyI18n(); legend(); refreshPanel(); return; }
    const lvl = ev.target.closest("[data-level]");
    if (lvl) { state.level = lvl.dataset.level; applyI18n(); draw(); refreshPanel(); fillSearch(); return; }
    if (ev.target.closest("[data-close]")) { select(null, null); return; }
    const sel = ev.target.closest("[data-sel]");
    if (sel) { const [l, i] = sel.dataset.sel.split(":"); select(l, i); return; }
    const srt = ev.target.closest("[data-sort]");
    if (srt) { const k = srt.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "n" ? 1 : -1) }; overview(); }
  });
  document.getElementById("metric").addEventListener("change", (ev) => { state.metric = ev.target.value; draw(); });
  const search = document.getElementById("search");
  function fillSearch() {
    const dl = document.getElementById("names");
    const opts = [];
    for (const lvl of ["canton", "municipality"]) {
      for (const [id, e] of Object.entries((state.data && state.data.entities[lvl]) || {})) opts.push(e.n);
    }
    dl.innerHTML = opts.sort().map((n) => '<option value="' + esc(n) + '">').join("");
  }
  search.addEventListener("change", () => {
    const q = search.value.trim().toLowerCase();
    for (const lvl of ["canton", "municipality"]) {
      for (const [id, e] of Object.entries(state.data.entities[lvl] || {})) {
        if (e.n.toLowerCase() === q) {
          if (state.level !== lvl) { state.level = lvl; applyI18n(); draw(); }
          select(lvl, id);
          state.layer.eachLayer((l) => { if (String(l.feature.id) === id) map.fitBounds(l.getBounds(), { maxZoom: 11 }); });
          return;
        }
      }
    }
  });

  /* ---- load ------------------------------------------------------------- */
  applyI18n();
  Promise.all([fetchTopo(), fetch(DATA_URL).then((r) => r.json())])
    .then(([topo, data]) => {
      state.topo = topo; state.data = data;
      if (topo.objects.lakes) {
        state.lakes = L.geoJSON(topojson.feature(topo, topo.objects.lakes), {
          interactive: false, style: { fillColor: css("--lake"), fillOpacity: 1, weight: 0.6, color: css("--outline") } }).addTo(map);
      }
      const sel = params.get("sel");
      if (params.get("level") === "municipality" || (sel && sel.startsWith("municipality:"))) state.level = "municipality";
      applyI18n(); draw(); fillSearch();
      if (sel) { const [l, i] = sel.split(":"); select(l, i); } else overview();
    })
    .catch((err) => {
      document.getElementById("panel").innerHTML = '<p class="note">Map data could not be loaded: ' + esc(err.message) + "</p>";
    });
})();

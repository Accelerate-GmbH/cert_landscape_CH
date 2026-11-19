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
    const sectorView = state.level === "sector";
    document.getElementById("map").hidden = sectorView;
    document.getElementById("matrix").hidden = !sectorView;
    document.getElementById("legend").hidden = sectorView;
    document.querySelector(".metric").hidden = sectorView;
    if (sectorView) { renderMatrix(); return; }
    setTimeout(() => map.invalidateSize(), 0);
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
          showTip(ev, "<b>" + esc(name) + "</b><br>" + esc(t("m_" + state.metric)) + ": " + esc(isTM(state.metric) && value(e) !== null ? value(e) + " / 100" : valueText(e)));
          lyr.setStyle({ weight: 2, color: css("--text-primary") });
          lyr.bringToFront();
        });
        lyr.on("mouseout", () => { hideTip(); state.layer.resetStyle(lyr); });
        lyr.on("click", () => select(state.level, id));
      },
    }).addTo(map);
    if (state.lakes) state.lakes.bringToFront();
    legend();
    drawOrgs();
  }

  /* ---- organisations: grouped per canton (zoomed out) or place ---------- */
  const CANTON_CODES = ["ZH","BE","LU","UR","SZ","OW","NW","GL","ZG","FR","SO","BS","BL","SH","AR","AI","SG","GR","AG","TG","TI","VD","VS","NE","GE","JU"];
  const centers = { canton: {}, municipality: {} };
  function computeCenters() {
    for (const [lvl, obj] of [["canton", state.topo.objects.cantons], ["municipality", state.topo.objects.municipalities]]) {
      topojson.feature(state.topo, obj).features.forEach((f) => { centers[lvl][String(f.id)] = L.geoJSON(f).getBounds().getCenter(); });
    }
  }
  let orgLayer = null;
  function orgList() {
    const sf = document.getElementById("sectorfilter").value;
    return Object.entries((state.data.entities.organisation) || {}).filter(([, o]) => !sf || o.sec === sf);
  }
  function donut(counts, n) {
    const total = counts.green + counts.yellow + counts.red + counts.none || 1;
    const r = 9 + 4 * Math.sqrt(n), c = 2 * Math.PI * (r - 4);
    let off = 0, segs = "";
    for (const [k, col] of [["green", css("--good")], ["yellow", css("--warning")], ["red", css("--critical")], ["none", css("--nodata")]]) {
      if (!counts[k]) continue;
      const len = c * counts[k] / total;
      segs += '<circle r="' + (r - 4) + '" fill="none" stroke="' + col + '" stroke-width="8" stroke-dasharray="' + len + " " + (c - len) +
        '" stroke-dashoffset="' + (-off) + '" transform="rotate(-90)"/>';
      off += len;
    }
    return '<svg width="' + 2 * r + '" height="' + 2 * r + '" viewBox="' + (-r) + " " + (-r) + " " + 2 * r + " " + 2 * r + '">' +
      '<circle r="' + r + '" fill="' + css("--surface-1") + '"/>' + segs +
      '<text text-anchor="middle" dy="0.35em" font-size="11" font-weight="600" fill="' + css("--text-primary") + '">' + n + "</text></svg>";
  }
  function drawOrgs() {
    if (orgLayer) { orgLayer.remove(); orgLayer = null; }
    if (state.level === "sector" || !document.getElementById("showorgs").checked) return;
    const byPlace = map.getZoom() >= 9.5;
    const groups = {};
    for (const [id, o] of orgList()) {
      const cid = String(CANTON_CODES.indexOf(o.kt) + 1);
      const key = byPlace && o.bfs && centers.municipality[o.bfs] ? "municipality:" + o.bfs : "canton:" + cid;
      if (!centers[key.split(":")[0]][key.split(":")[1]]) continue;
      (groups[key] = groups[key] || []).push(id);
    }
    orgLayer = L.layerGroup().addTo(map);
    for (const [key, ids] of Object.entries(groups)) {
      const [lvl, gid] = key.split(":");
      const counts = { green: 0, yellow: 0, red: 0, none: 0 };
      ids.forEach((id) => { counts[lightOf(value(state.data.entities.organisation[id], "tm"))]++; });
      const r = 9 + 4 * Math.sqrt(ids.length);
      const m = L.marker(centers[lvl][gid], { icon: L.divIcon({ className: "orgicon", html: donut(counts, ids.length), iconSize: [2 * r, 2 * r] }),
        riseOnHover: true, keyboard: true, title: ids.length + " " + t("orgs_here") });
      m.on("click", () => (ids.length === 1 ? select("organisation", ids[0]) : orgGroupPanel(ids, lvl, gid)));
      orgLayer.addLayer(m);
    }
  }
  function orgGroupPanel(ids, lvl, gid) {
    const place = lvl === "canton" ? CANTON_CODES[Number(gid) - 1] : ((state.data.entities.municipality[gid] || {}).n || gid);
    const rows = ids.map((id) => [id, state.data.entities.organisation[id]])
      .sort((a, b) => a[1].n.localeCompare(b[1].n))
      .map(([id, o]) => '<tr class="click" data-sel="organisation:' + id + '"><td>' + esc(o.n) + '<span class="src">' + esc(o.sec) +
        (o.sub ? " · " + esc(o.sub) : "") + '</span></td><td class="num">' + fmt(value(o, "tm")) + "</td><td>" + chip(lightOf(value(o, "tm")), " ") + "</td></tr>").join("");
    document.getElementById("panel").innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(place) + '</h2><p class="sub">' +
      ids.length + " " + esc(t("n_orgs")) + '</p><table><thead><tr><th>' + esc(t("orgs_here")) + '</th><th class="num">TM</th><th></th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  /* ---- sector matrix ------------------------------------------------------- */
  const CHECK_IDS = ["own.identity", "own.revocation", "own.dnssec", "own.caa", "own.ct", "sov.ca", "sov.dns", "sov.hosting", "sov.tld", "sec.tls13", "sec.pqc", "prv.ech"];
  const CHECK_SHORT = { "own.identity": "OV/EV", "own.revocation": "OCSP/CRL", "own.dnssec": "DNSSEC", "own.caa": "CAA", "own.ct": "SCT",
    "sov.ca": "CA", "sov.dns": "DNS", "sov.hosting": "Host", "sov.tld": "TLD", "sec.tls13": "TLS 1.3", "sec.pqc": "PQC", "prv.ech": "ECH" };
  const CATS = [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]];
  function share(k) { return k && k.assessed ? Math.round(100 * (k.pass + 0.5 * k.partial) / k.assessed) : null; }
  function cell(v, title) {
    if (v === null || v === undefined) return '<td class="cell sup">–</td>';
    const l = lightOf(v);
    const col = css(LIGHT_COLORS[l]);
    return '<td class="cell" title="' + esc(title || "") + '" style="background:' + col + "22;box-shadow:inset 3px 0 " + col + '">' + v + "</td>";
  }
  function matrixRow(cls, label, part, key) {
    if (!part) return "";
    if (part.suppressed) return '<tr class="' + cls + '" data-sector="' + esc(key) + '"><td class="name">' + label + '</td><td class="sup" colspan="' +
      (5 + CHECK_IDS.length) + '">' + esc(t("suppressed")) + " (n = " + part.n + ")</td></tr>";
    return '<tr class="' + cls + ' click" data-sector="' + esc(key) + '"><td class="name">' + label + '<span class="src">n = ' + part.n + "</span></td>" +
      cell(part.o, t("m_tm")) + CATS.map(([c, m]) => cell(part.c ? part.c[c] : null, t("m_" + m))).join("") +
      CHECK_IDS.map((id) => cell(share((part.k || {})[id]), t(id))).join("") + "</tr>";
  }
  function renderMatrix() {
    const sec = state.data.sectors || {};
    const names = Object.keys(sec).filter((k) => !k.startsWith("@")).sort((a, b) => a.localeCompare(b));
    const bench = ["@Kantone", "@Gemeinden", "@Bund"].filter((k) => sec[k]);
    const benchLabel = { "@Kantone": "bench_canton", "@Gemeinden": "bench_municipality", "@Bund": "bench_federal" };
    let rows = "";
    for (const k of names.concat(bench)) {
      const d = sec[k];
      const isB = k.startsWith("@");
      const label = isB ? esc(t(benchLabel[k])) : esc(k) + '<span class="src">' + d.orgs + " " + esc(t("n_orgs")) + " · " + d.hosts + " " + esc(t("n_hosts")) + "</span>";
      rows += matrixRow("sec" + (isB ? " bench" : ""), label, d.all, k);
      rows += matrixRow("sub", esc(t("m_krit")), d.krit, k) + matrixRow("sub", esc(t("m_other")), d.other, k);
    }
    const CS = { tm_own: "cs_own", tm_sov: "cs_sov", tm_sec: "cs_sec", tm_prv: "cs_prv" };
    const head = "<th></th><th>TM</th>" + CATS.map(([, m]) => '<th title="' + esc(t("m_" + m)) + '">' + esc(t(CS[m])) + "</th>").join("") +
      CHECK_IDS.map((id) => '<th title="' + esc(t(id)) + " · " + esc(t("source_col")) + ": " + esc((SRC[id] || []).join(", ")) + '">' + CHECK_SHORT[id] + "</th>").join("");
    document.getElementById("matrix").innerHTML = "<h2>" + esc(t("matrix_title")) + '</h2><p class="sub">' + esc(t("matrix_note")) + "</p>" +
      (names.length || bench.length ? "<table><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="muted">' + esc(t("no_data")) + "</p>");
  }
  function sectorPanel(key) {
    const d = (state.data.sectors || {})[key];
    if (!d) return;
    if (key.startsWith("@")) { select(null, null); return; }
    const pubs = Object.entries(state.data.entities.organisation || {}).filter(([, o]) => o.sec === key)
      .sort((a, b) => a[1].n.localeCompare(b[1].n));
    const rows = pubs.map(([id, o]) => '<tr class="click" data-sel="organisation:' + id + '"><td>' + esc(o.n) + (o.sub ? '<span class="src">' + esc(o.sub) + "</span>" : "") +
      '</td><td class="num">' + fmt(value(o, "tm")) + "</td><td>" + chip(lightOf(value(o, "tm")), " ") + "</td></tr>").join("");
    const subs = Object.entries(d.subs || {}).map(([k, v]) => esc(k) + " " + v).join(", ");
    const hidden = d.orgs - pubs.length;
    document.getElementById("panel").innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(key) + '</h2><p class="sub">' +
      d.orgs + " " + esc(t("n_orgs")) + " · " + d.hosts + " " + esc(t("n_hosts")) + "</p>" +
      (subs ? "<h3>" + esc(t("subsector")) + '</h3><p class="sub">' + subs + "</p>" : "") +
      (pubs.length ? "<h3>" + esc(t("orgs_here")) + '</h3><table><tbody>' + rows + "</tbody></table>" : "") +
      (hidden > 0 ? '<p class="note">' + esc(t("agg_note").replace("{n}", hidden)) + "</p>" : "");
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
    const ls = state.metric === "tm" ? ["tls", "ocsp", "dns", "sct", "ccadb", "cymru"].map((x) => SRCL[x]()).join(", ") : src(state.metric);
    el.innerHTML = '<div class="t">' + esc(t("m_" + state.metric)) + '</div><div class="d">' + esc(t("m_" + state.metric + "_d")) +
      (ls ? '<br><span class="src">' + esc(t("source_col")) + ": " + ls + "</span>" : "") + "</div>" + rows;
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
    const kpi = (v, l, k) => '<div class="kpi"><div class="v">' + esc(fmt(v)) + '</div><div class="l">' + esc(l) + "</div>" + srcSpan(k) + "</div>";
    const vc = e.v || {};
    const cas = (e.cas || []).map((c) => "<tr><td>" + esc(c[0]) + "</td><td>" + esc(c[1]) + '</td><td class="num">' + c[3] + "</td></tr>").join("");
    const checks = Object.entries(e.chk || {}).map(([k, s]) =>
      '<li><span class="st ' + (s === "n/a" ? "na" : s) + '">' + esc(t(s)) + "</span><span>" + esc(t("c_" + k)) + "</span></li>").join("");
    const dict = (o) => Object.entries(o || {}).map(([k, v]) => esc(k) + " " + v).join(", ") || "–";
    panel.innerHTML =
      '<button class="close" data-close aria-label="' + esc(t("close")) + '">✕</button>' +
      "<h2>" + esc(e.n) + "</h2>" +
      '<p class="sub">' + esc((e.d || []).join(", ")) + "</p>" +
      (level === "organisation" ? '<p class="sub">' + esc(t("sector")) + ": " + esc(e.sec || "–") + (e.sub ? " · " + esc(e.sub) : "") +
        "<br>" + esc(t("place")) + ": " + esc(e.ort || "–") + (e.kt ? " (" + esc(e.kt) + ")" : "") + (e.uid ? " · " + esc(e.uid) : "") + "</p>" : "") +
      (e.sd ? '<p class="note">' + esc(t("shared")) + "</p>" : "") +
      tmSection(e) + stackSection(e) +
      (e.tm && e.tm.n ? "<h3>" + esc(t("res_title")) + '</h3><p><button class="linkbtn" data-res="' + level + ":" + id + '">' +
        esc(t("res_show")) + " (" + e.tm.n + ")</button></p>" : "") +
      "<h3>" + esc(t("m_s")) + " · " + esc(t("m_a")) + "</h3>" +
      '<div class="kpis">' + kpi(e.s, t("m_s"), "s") + kpi(e.a, t("m_a"), "a") + kpi(e.cs, t("m_cs"), "cs") + kpi(e.ca, t("m_ca"), "ca") + "</div>" +
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

  /* Where each number comes from, shown next to it. */
  const SRCL = {
    tls: () => esc(t("src_tls")),
    ocsp: () => esc(t("src_revocation")),
    sct: () => esc(t("src_sct")),
    name: () => esc(t("src_name")),
    dns: () => '<a href="https://developers.google.com/speed/public-dns/docs/doh">' + esc(t("src_dns")) + "</a>",
    ccadb: () => '<a href="https://www.ccadb.org">CCADB</a>',
    cymru: () => '<a href="https://www.team-cymru.com/ip-asn-mapping">Team Cymru</a>',
    ct: () => '<a href="https://crt.sh">' + esc(t("src_ct")) + " (crt.sh)</a>",
  };
  const SRC = {
    "own.identity": ["tls", "ct"], "own.revocation": ["ocsp"], "own.dnssec": ["dns"], "own.caa": ["dns"], "own.ct": ["sct"],
    "sov.ca": ["ccadb"], "sov.dns": ["dns", "cymru"], "sov.hosting": ["cymru"], "sov.tld": ["name"],
    "sec.tls13": ["tls"], "sec.pqc": ["tls"], "prv.ech": ["dns"],
    s: ["ct", "ccadb"], cs: ["ct", "ccadb"], a: ["ct", "tls"], ca: ["ct", "tls"], caa: ["dns"],
    tm_own: ["tls", "ocsp", "dns", "sct"], tm_sov: ["ccadb", "dns", "cymru"], tm_sec: ["tls"], tm_prv: ["dns"],
    st_tld: ["name"], st_dns: ["dns", "cymru"], st_dnssec: ["dns"], st_host: ["cymru"], st_ca: ["ct", "ccadb"], st_root: ["ccadb"],
  };
  const src = (k) => (SRC[k] || []).map((x) => SRCL[x]()).join(", ");
  const srcSpan = (k) => (SRC[k] ? '<span class="src">' + esc(t("source_col")) + ": " + src(k) + "</span>" : "");

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
      return '<div class="cat"><span>' + esc(t("m_" + m)) + srcSpan(m) + '</span><span class="num">' + fmt(v) + "</span>" + chip(lightOf(v)) + "</div>";
    }).join("");
    const checks = Object.entries(tm.k || {}).map(([id, c]) =>
      "<tr><td>" + esc(t(id)) + '</td><td class="num">' + Math.round(100 * (c.pass + 0.5 * c.partial) / c.assessed) + ' %</td><td class="num">' + c.assessed +
      '</td><td class="srccell">' + src(id) + "</td></tr>").join("");
    return "<h3>" + esc(t("trustmark")) + '</h3><div class="tmhead"><span class="v">' + fmt(tm.o) + "</span>" + chip(lightOf(tm.o)) +
      (tm.el ? chip("green", t("eligible")) : "") + '</div><p class="sub">' + (tm.n || 0) + " " + esc(t("resources")) +
      (tm.ko ? " · " + tm.ko + " " + esc(t("knockouts")) : "") + "</p>" + rows +
      '<table style="margin-top:8px"><thead><tr><th>' + esc(t("check_col")) + '</th><th class="num">' + esc(t("pass_col")) +
      '</th><th class="num">n</th><th>' + esc(t("source_col")) + '</th></tr></thead><tbody>' + checks + "</tbody></table>";
  }
  function stackSection(e) {
    const st = e.stack;
    if (!st) return "";
    const list = (arr, fmtItem) => (arr && arr.length ? arr.map(fmtItem).join("<br>") : "–");
    return "<h3>" + esc(t("stack")) + '</h3><table class="stack"><tbody>' +
      "<tr><td>" + esc(t("st_tld")) + srcSpan("st_tld") + "</td><td>." + esc((st.tld || []).join(", .")) + "</td></tr>" +
      "<tr><td>" + esc(t("st_dns")) + srcSpan("st_dns") + "</td><td>" + list(st.dns, (x) => esc(x[0]) + " (" + esc(x[1]) + ")") + "</td></tr>" +
      "<tr><td>" + esc(t("st_dnssec")) + srcSpan("st_dnssec") + "</td><td>" + esc(t(st.dnssec ? "yes" : "no")) + "</td></tr>" +
      "<tr><td>" + esc(t("st_host")) + srcSpan("st_host") + "</td><td>" + list(st.host, (x) => esc(x[0]) + ": " + x[1]) + "</td></tr>" +
      "<tr><td>" + esc(t("st_ca")) + srcSpan("st_ca") + "</td><td>" + list(st.ca, (x) => esc(x[0]) + " (" + esc(x[1]) + "): " + x[2]) + "</td></tr>" +
      "<tr><td>" + esc(t("st_root")) + srcSpan("st_root") + "</td><td>" + list(st.root, (x) => esc(x[0]) + ": " + x[1]) + "</td></tr>" +
      "</tbody></table>";
  }

  /* ---- drill-down: entity -> resources -> checks -> sources ------------- */
  const cache = {};
  const enc = encodeURIComponent;
  const ext = (href, text) => '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(text) + "</a>";
  const dnsLink = (name, type) => ext("https://dns.google/query?name=" + enc(name) + "&rr_type=" + type, "dns.google " + type);
  const asLink = (asn) => (asn ? ext("https://bgp.he.net/AS" + enc(asn), "AS" + asn) : "");
  const ctLink = (c) => c.sha ? ext("https://crt.sh/?sha256=" + enc(c.sha), "crt.sh") :
    (c.src === "crtsh" && c.id ? ext("https://crt.sh/?id=" + enc(c.id), "crt.sh") : "");
  const labsLink = (h) => ext("https://www.ssllabs.com/ssltest/analyze.html?d=" + enc(h) + "&hideResults=on", "SSL Labs");
  function checkLinks(id, r, dom) {
    const h = r.h;
    const ips = (r.ep || []).map((x) => asLink(x.asn)).filter(Boolean);
    switch (id) {
      case "own.identity": case "own.ct": return [ctLink(r.cert), labsLink(h)];
      case "own.revocation": return [...new Set((r.ep || []).map((x) => x.revu).filter(Boolean))].map((u) => ext(u, u.replace(/^https?:\/\//, "").slice(0, 40)));
      case "own.dnssec": return [dnsLink(h, "A"), ext("https://dnsviz.net/d/" + enc(h) + "/dnssec/", "DNSViz")];
      case "own.caa": return [dnsLink(r.caa || h, "CAA")];
      case "sov.ca": return [ctLink(r.cert), ext("https://crt.sh/?CN=" + enc(r.root.name || ""), "crt.sh root"), ext("https://www.ccadb.org/resources", "CCADB")];
      case "sov.dns": return [dnsLink(dom || h, "NS")];
      case "sov.hosting": return [...new Set(ips)];
      case "sec.tls13": case "sec.pqc": return [labsLink(h)];
      case "prv.ech": return [dnsLink(h, "HTTPS")];
      default: return [];
    }
  }
  function loadResources(level, id) {
    const key = level + "-" + id;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch("data/resources/" + key + ".json").then((r) => (r.ok ? r.json() : [])).then((d) => (cache[key] = d));
  }
  function resourceList(level, id) {
    const e = state.data.entities[level][id];
    const panel = document.getElementById("panel");
    panel.innerHTML = '<p class="muted">' + esc(t("loading")) + "</p>";
    loadResources(level, id).then((list) => {
      const rows = list.map((r, i) => '<tr class="click" data-rdetail="' + level + ":" + id + ":" + i + '"><td>' + esc(r.h) +
        (r.crit ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (r.ko ? ' <span class="chip">K.-o.</span>' : "") +
        '</td><td class="num">' + fmt(r.o) + "</td><td>" + chip(lightOf(r.o), " ") + "</td></tr>").join("");
      panel.innerHTML = '<button class="close" data-sel="' + level + ":" + id + '">← ' + esc(t("back")) + "</button>" +
        "<h2>" + esc(e.n) + '</h2><p class="sub">' + esc(t("res_title")) + ": " + list.length + "</p>" +
        '<table><thead><tr><th>Hostname</th><th class="num">TM</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
    });
  }
  function resourceDetail(level, id, idx) {
    const e = state.data.entities[level][id];
    const r = cache[level + "-" + id][idx];
    const dom = (e.d || []).find((d) => r.h === d || r.h.endsWith("." + d)) || "";
    const panel = document.getElementById("panel");
    const chk = r.chk.map(([cid, st, val, method, ev]) => {
      const links = checkLinks(cid, r, dom).filter(Boolean).join(" · ");
      return '<tr><td>' + esc(t(cid)) + '<br><span class="st ' + (st === "n/a" ? "na" : st === "partial" ? "na" : st) + '">' +
        esc(t("status_" + st)) + "</span>" + '<span class="src">' + esc(method) + "</span></td>" +
        '<td class="ev">' + esc(String(val === null || val === undefined ? "" : val)) + (ev ? '<span class="src">' + esc(ev) + "</span>" : "") +
        '</td><td class="srccell">' + links + "</td></tr>";
    }).join("");
    const eps = (r.ep || []).map((x) => "<tr><td>" + esc(x.ip) + '<span class="src">' + (x.at ? esc(t("checked")) + " " + esc(x.at) : esc(t("not_probed"))) +
      "</span></td><td>" + esc(x.tls || "") + (x.grp ? '<span class="src">' + esc(x.grp) + (x.pq ? " · PQ " + esc(x.pq) : "") + "</span>" : "") +
      "</td><td>" + esc(x.val || "") + (x.rev ? '<span class="src">' + esc(x.revm || "") + " " + esc(x.rev) + " · SCT " + (x.scts || 0) + "</span>" : "") +
      (x.err ? '<span class="src">' + esc(x.err) + "</span>" : "") + "</td><td>" + asLink(x.asn) + '<span class="src">' + esc(x.as || "") + " " + esc(x.cc || "") + "</span></td></tr>").join("");
    const c = r.cert;
    panel.innerHTML = '<button class="close" data-res="' + level + ":" + id + '">← ' + esc(t("back")) + "</button>" +
      "<h2>" + esc(r.h) + '</h2><p class="sub">' + esc(e.n) + (r.crit ? " · " + esc(t("crit_tag")) : "") + "</p>" +
      (r.ko ? '<p class="note">K.-o.: ' + esc(r.ko) + "</p>" : "") +
      '<div class="tmhead"><span class="v">' + fmt(r.o) + "</span>" + chip(lightOf(r.o)) + "</div>" +
      [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]].map(([k, m]) =>
        '<div class="cat"><span>' + esc(t("m_" + m)) + '</span><span class="num">' + fmt(r.c ? r.c[k] : null) + "</span>" + chip(lightOf(r.c ? r.c[k] : null)) + "</div>").join("") +
      "<h3>" + esc(t("checks")) + '</h3><table class="checks-t"><thead><tr><th>' + esc(t("check_col")) + "</th><th>" + esc(t("value_col")) +
      "</th><th>" + esc(t("verify_at")) + "</th></tr></thead><tbody>" + chk + "</tbody></table>" +
      "<h3>" + esc(t("cert")) + '</h3><p class="sub">' + esc(c.val) + " · " + esc(c.org) + " · " + esc(c.iss) + " · " + esc((c.exp || "").slice(0, 10)) +
      "<br>Root: " + esc(r.root.name) + " (" + esc(r.root.owner) + ", " + esc(r.root.cc) + ") · " + ctLink(c) + " · " + labsLink(r.h) + "</p>" +
      "<h3>" + esc(t("endpoints")) + "</h3><table><thead><tr><th>" + esc(t("ip_col")) + "</th><th>TLS</th><th>" + esc(t("cert")) +
      "</th><th>" + esc(t("net_col")) + "</th></tr></thead><tbody>" + eps + "</tbody></table>";
  }

  function overview() {
    const panel = document.getElementById("panel");
    const cantons = Object.entries(state.data.entities.canton || {});
    const lvlForStats = state.level === "sector" ? "canton" : state.level;
    const all = Object.values(state.data.entities[lvlForStats] || {});
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
      "<h3>" + esc(t("national")) + ' · ' + esc(t(lvlForStats === "canton" ? "level_canton" : "level_municipality")) + "</h3>" +
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
      applyI18n(); legend(); refreshPanel(); if (state.data) fillSectors(); if (state.level === "sector") renderMatrix(); return; }
    const lvl = ev.target.closest("[data-level]");
    if (lvl) { state.level = lvl.dataset.level; applyI18n(); draw(); refreshPanel(); fillSearch(); return; }
    if (ev.target.closest("[data-close]")) { select(null, null); return; }
    const res = ev.target.closest("[data-res]");
    if (res) { const [l, i] = res.dataset.res.split(":"); resourceList(l, i); return; }
    const rd = ev.target.closest("[data-rdetail]");
    if (rd) { const [l, i, k] = rd.dataset.rdetail.split(":"); resourceDetail(l, i, Number(k)); return; }
    const sel = ev.target.closest("[data-sel]");
    if (sel) { const [l, i] = sel.dataset.sel.split(":"); select(l, i); return; }
    const sr = ev.target.closest("[data-sector]");
    if (sr) { sectorPanel(sr.dataset.sector); return; }
    const srt = ev.target.closest("[data-sort]");
    if (srt) { const k = srt.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "n" ? 1 : -1) }; overview(); }
  });
  document.getElementById("metric").addEventListener("change", (ev) => { state.metric = ev.target.value; draw(); });
  document.getElementById("showorgs").addEventListener("change", drawOrgs);
  document.getElementById("sectorfilter").addEventListener("change", drawOrgs);
  map.on("zoomend", drawOrgs);
  function fillSectors() {
    const sel = document.getElementById("sectorfilter");
    const secs = new Set(Object.keys(state.data.sectors || {}).filter((k) => !k.startsWith("@")));
    Object.values(state.data.entities.organisation || {}).forEach((o) => o.sec && secs.add(o.sec));
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(t("all_sectors")) + "</option>" + [...secs].sort().map((k) => '<option value="' + esc(k) + '">' + esc(k) + "</option>").join("");
    sel.value = cur;
    const hasOrgs = Object.keys(state.data.entities.organisation || {}).length > 0;
    document.getElementById("orgtoggle").hidden = !hasOrgs;
    sel.hidden = !hasOrgs && !secs.size;
  }
  const search = document.getElementById("search");
  function fillSearch() {
    const dl = document.getElementById("names");
    const opts = [];
    for (const lvl of ["canton", "municipality", "organisation"]) {
      for (const [id, e] of Object.entries((state.data && state.data.entities[lvl]) || {})) opts.push(e.n);
    }
    dl.innerHTML = opts.sort().map((n) => '<option value="' + esc(n) + '">').join("");
  }
  search.addEventListener("change", () => {
    const q = search.value.trim().toLowerCase();
    for (const [id, o] of Object.entries(state.data.entities.organisation || {})) {
      if (o.n.toLowerCase() === q) {
        if (state.level === "sector") { state.level = "canton"; applyI18n(); draw(); }
        select("organisation", id);
        const c = (o.bfs && centers.municipality[o.bfs]) || centers.canton[String(CANTON_CODES.indexOf(o.kt) + 1)];
        if (c) map.setView(c, 11);
        return;
      }
    }
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
      computeCenters(); fillSectors();
      applyI18n(); draw(); fillSearch();
      if (sel) { const [l, i] = sel.split(":"); select(l, i); } else overview();
    })
    .catch((err) => {
      document.getElementById("panel").innerHTML = '<p class="note">Map data could not be loaded: ' + esc(err.message) + "</p>";
    });
})();

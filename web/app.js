/* Trust Posture Switzerland: map and tables for cantons, municipalities, federal administration and critical services. */
(function () {
  "use strict";

  // Self-hosted copy first (the published site ships one), CDN as fallback.
  const TOPO_LOCAL = "data/ch-combined.json";
  const TOPO_CDN = "https://unpkg.com/swiss-maps@4.7.0/2026/ch-combined.json";
  const fetchTopo = () => fetch(TOPO_LOCAL).then((r) => (r.ok ? r.json() : Promise.reject(r)))
    .catch(() => fetch(TOPO_CDN).then((r) => r.json()));
  const params = new URLSearchParams(location.search);
  const BUILD = window.BUILD && window.BUILD !== "__BUILD__" ? window.BUILD : String(Date.now());   // cache buster per publication
  const DATA_URL = params.get("data") || "data/map.json?v=" + BUILD;

  const state = {
    lang: pickLang(), view: pickView(), level: "canton", metric: "tm", selected: null, dim: "sektor",
    data: null, topo: null, layer: null, lakes: null, sort: { key: "tm", dir: -1 },
  };

  function pickLang() {
    const p = params.get("lang");
    if (p && I18N[p]) return p;
    try { const s = localStorage.getItem("lang"); if (s && I18N[s]) return s; } catch (e) { /* storage blocked */ }
    const nav = (navigator.language || "de").slice(0, 2);
    return I18N[nav] ? nav : "de";
  }
  function pickView() {
    const p = params.get("view");
    if (p === "simple" || p === "expert") return p;
    try { const s = localStorage.getItem("view"); if (s === "simple" || s === "expert") return s; } catch (e) { /* storage blocked */ }
    return "simple";
  }
  const G = () => (window.GUIDE && (GUIDE[state.lang] || GUIDE.en)) || { ui: {}, s: {} };
  const simple = () => state.view === "simple";
  function t(k) {
    const g = G();
    if (simple() && g.s && g.s[k]) return g.s[k];
    if (g.ui && g.ui[k]) return g.ui[k];
    const en = (window.GUIDE && GUIDE.en) || { ui: {}, s: {} };
    return (I18N[state.lang] && I18N[state.lang][k]) || I18N.en[k] || (simple() && en.s[k]) || en.ui[k] || k;
  }
  /* Fill rating parameters into explanation texts. */
  function fill(s) {
    const c = cfg(), d = (state.data && state.data.cfg) || {};
    const w = (k) => Math.round(100 * (c.cw[k] || 0));
    return String(s).replace(/\{g\}/g, c.g).replace(/\{y\}/g, c.y).replace(/\{g1\}/g, c.g - 1).replace(/\{y1\}/g, c.y - 1)
      .replace(/\{crit\}/g, c.crit).replace(/\{min_scts\}/g, d.min_scts || 2).replace(/\{min_orgs\}/g, d.min_orgs_per_sector || 5)
      .replace(/\{w_(\w+)\}/g, (_, k) => w(k));
  }
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
  const isTM = (m) => m === "tm" || m === "crit_seat" || m === "ml" || m in TM_CAT;
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
    if (m === "ml") return e.ml && e.ml.o !== undefined ? e.ml.o : null;
    if (m === "crit_seat") {
      const d = e.c && state.data.dims && state.data.dims.kanton ? state.data.dims.kanton[e.c] : null;
      return d && d.krit && !d.krit.suppressed && d.krit.o !== undefined ? d.krit.o : null;
    }
    if (m in TM_CAT) return e.tm && e.tm.c ? (e.tm.c[TM_CAT[m]] === undefined ? null : e.tm.c[TM_CAT[m]]) : null;
    return e[m] === undefined ? null : e[m];
  }
  function valueText(e) {
    if (!e) return t("no_data");
    if (state.metric === "caa") return e.caa ? t("caa_" + e.caa) : t("no_data");
    const v = value(e);
    return v === null ? t("no_data") : v + " / 100";
  }

  /* ---- metrics offered per view ------------------------------------------ */
  const METRICS_MAIN = ["tm", "tm_own", "tm_sov", "tm_sec", "tm_prv", "ml", "crit_seat"];
  const METRICS_MORE = ["s", "cs", "a", "ca", "caa", "gp"];
  function fillMetrics() {
    const sel = document.getElementById("metric");
    if (simple() && !METRICS_MAIN.includes(state.metric)) state.metric = "tm";
    const opt = (m) => '<option value="' + m + '"' + (m === state.metric ? " selected" : "") + ">" + esc(t("m_" + m)) + "</option>";
    sel.innerHTML = METRICS_MAIN.map(opt).join("") + (simple() ? "" : '<optgroup label="' + esc(t("more_metrics")) + '">' + METRICS_MORE.map(opt).join("") + "</optgroup>");
  }

  /* ---- i18n ------------------------------------------------------------- */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.lang === state.lang));
    document.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.level === state.level));
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === state.view));
    document.getElementById("viewseg").title = t("view_hint");
    document.querySelector(".viz-root").dataset.mode = state.view;
    fillMetrics();
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
    const sectorView = isTable();
    document.getElementById("map").hidden = sectorView;
    document.getElementById("matrix").hidden = !sectorView;
    document.getElementById("legend").hidden = sectorView;
    document.querySelector(".metric").hidden = sectorView;
    document.getElementById("orgtoggle").hidden = sectorView || !Object.keys(state.data.entities.organisation || {}).length;
    if (sectorView) { if (state.level === "federal") renderFederal(); else if (state.level === "hosts") renderHosts(); else renderMatrix(); return; }
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
        const name = (e && e.n) || (f.properties && f.properties.name) || featureName(state.level, id);
        lyr.on("mousemove", (ev) => {
          const v = value(e);
          const w = isTM(state.metric) && v === null ? whyOf(state.level, e) : null;
          showTip(ev, "<b>" + esc(name) + "</b><br>" + esc(t("m_" + state.metric)) + ": " + esc(isTM(state.metric) && v !== null ? v + " / 100" : valueText(e)) +
            (w ? '<br><span class="src">' + esc(t("whys_" + w)) + "</span>" : "") +
            (simple() && isTM(state.metric) ? "<br>" + chip(lightOf(v), t("verdict_" + lightOf(v))) : ""));
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
    drawFederal();
  }

  /* ---- federal administration: no area of its own, shown as a box ------- */
  const fedBox = L.control({ position: "topright" });
  fedBox.onAdd = () => { const d = L.DomUtil.create("div", "fedbox"); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); return d; };
  fedBox.addTo(map);
  function drawFederal() {
    const el = document.querySelector(".fedbox");
    const fed = Object.entries((state.data && state.data.entities.federal) || {});
    el.hidden = !fed.length;
    if (!fed.length) return;
    let sw = 0, sv = 0;
    fed.forEach(([, e]) => { const v = value(e); const w = (e.tm && e.tm.n) || e.h || 1; if (v !== null) { sw += w; sv += w * v; } });
    const total = sw ? Math.round(sv / sw) : null;
    const show = (v) => (isTM(state.metric) ? fmt(v) : valueText({ [state.metric]: v }) || fmt(v));
    const lightChip = (v) => (isTM(state.metric) ? chip(lightOf(v), " ") : "");
    el.innerHTML = '<button class="fedhead" data-fedtoggle aria-expanded="' + !!state.fedOpen + '"><span class="ft">' + esc(t("fed_title")) + "</span>" +
      '<span class="num">' + (total === null ? "–" : (isTM(state.metric) ? total : fmt(total))) + "</span>" + lightChip(total) + '<span class="caret">' + (state.fedOpen ? "▴" : "▾") + "</span></button>" +
      (state.fedOpen ? '<div class="fedlist"><p class="src">' + esc(t("fed_note")) + "</p>" + fed.sort((a, b) => (value(b[1]) ?? -1) - (value(a[1]) ?? -1)).map(([id, e]) =>
        '<button class="fedrow" data-sel="federal:' + esc(id) + '" title="' + esc(e.n) + '"><span>' + esc(e.c || e.n) + '</span><span class="num">' +
        esc(value(e) === null ? "–" : String(isTM(state.metric) ? value(e) : valueText(e))) + "</span>" + lightChip(value(e)) + "</button>").join("") + "</div>" : "");
  }

  /* ---- search with suggestions ----------------------------------------- */
  let hostIndex = null, hostIndexLoading = null;
  function loadHostIndex() {
    if (hostIndex || hostIndexLoading) return hostIndexLoading;
    const url = DATA_URL.replace(/map\.json(\?.*)?$/, "search.json") + "?v=" + BUILD;
    hostIndexLoading = fetch(url).then((r) => (r.ok ? r.json() : { h: {} })).catch(() => ({ h: {} })).then((j) => {
      hostIndex = [];
      for (const [key, hosts] of Object.entries(j.h || {})) hosts.forEach((h) => hostIndex.push([h, key, ""]));
      for (const [key, hosts] of Object.entries(j.u || {})) hosts.forEach(([h, code]) => hostIndex.push([h, key, code]));
      return hostIndex;
    });
    return hostIndexLoading;
  }
  const KIND_LABEL = { canton: "t_canton", municipality: "t_municipality", federal: "t_federal", organisation: "t_organisation" };
  function entityByKey(key) { const [l, ...rest] = key.split(":"); const id = rest.join(":"); return [l, id, ((state.data.entities[l] || {})[id])]; }
  function suggestions(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2 || !state.data) return [];
    const out = [];
    const score = (text) => { const i = text.toLowerCase().indexOf(q); return i < 0 ? -1 : (i === 0 ? 0 : (text[i - 1] === "." || text[i - 1] === " " ? 1 : 2)); };
    for (const lvl of ["canton", "federal", "municipality", "organisation"]) {
      for (const [id, e] of Object.entries(state.data.entities[lvl] || {})) {
        const sc = Math.min(...[score(e.n), e.c ? score(e.c) : -1].filter((x) => x >= 0).concat([99]));
        if (sc < 99) out.push({ kind: "entity", lvl, id, label: e.n, sub: t(KIND_LABEL[lvl]) + (lvl === "federal" && e.c ? " · " + e.c : ""), rank: sc * 10 });
        (e.d || []).forEach((d) => {
          const s2 = score(d);
          if (s2 >= 0) out.push({ kind: "domain", lvl, id, label: d, sub: t("t_domain") + " · " + e.n, rank: s2 * 10 + 1 });
          else if (q.endsWith("." + d.toLowerCase())) out.push({ kind: "domain", lvl, id, label: d, sub: t("t_domain") + " · " + e.n, rank: 25 });
        });
      }
    }
    (hostIndex || []).forEach(([h, key, code]) => {
      const s2 = score(h); if (s2 < 0) return;
      const [l, id, e] = entityByKey(key);
      if (e) out.push({ kind: "host", lvl: l, id, label: h, code, sub: t("t_host") + " · " + e.n + (code ? " · " + t("host_not_rated") : ""), rank: s2 * 10 + (code ? 3 : 2) });
    });
    const seen = new Set();
    return out.sort((a, b) => a.rank - b.rank || a.label.length - b.label.length || a.label.localeCompare(b.label))
      .filter((x) => { const k = x.kind + x.lvl + x.id + x.label; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
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
    if (isTable() || !document.getElementById("showorgs").checked) return;
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
      const perHost = state.orgMode === "host";
      let n = 0;
      ids.forEach((id) => {
        const o = state.data.entities.organisation[id];
        if (perHost) (o.hs || []).forEach((h) => { counts[lightOf(h[1])]++; n++; });
        else { counts[lightOf(value(o, "tm"))]++; n++; }
      });
      const r = 9 + 4 * Math.sqrt(ids.length);
      const m = L.marker(centers[lvl][gid], { icon: L.divIcon({ className: "orgicon", html: donut(counts, ids.length), iconSize: [2 * r, 2 * r] }),
        riseOnHover: true, keyboard: true, title: ids.length + " " + t("orgs_here") + (perHost ? " · " + n + " " + t("n_hosts") : "") });
      m.on("click", () => (ids.length === 1 ? select("organisation", ids[0]) : orgGroupPanel(ids, lvl, gid)));
      orgLayer.addLayer(m);
    }
  }
  function orgGroupPanel(ids, lvl, gid) {
    const place = lvl === "canton" ? CANTON_CODES[Number(gid) - 1] : ((state.data.entities.municipality[gid] || {}).n || gid);
    if (state.orgMode === "host") {
      const hosts = [];
      ids.forEach((id) => (state.data.entities.organisation[id].hs || []).forEach((h) => hosts.push([id, state.data.entities.organisation[id], h])));
      hosts.sort((a, b) => (b[2][1] ?? -1) - (a[2][1] ?? -1) || a[2][0].localeCompare(b[2][0]));
      document.getElementById("panel").innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(place) + '</h2><p class="sub">' +
        ids.length + " " + esc(t("n_orgs")) + " · " + hosts.length + " " + esc(t("n_hosts")) + "</p><table><tbody>" +
        hosts.map(([id, o, h]) => '<tr class="click" data-orghost="' + esc(id + "|" + h[0]) + '"><td>' + esc(h[0]) + (h[5] ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") +
          (h[9] ? urTag() : "") + '<span class="src">' + esc(o.n) + '</span></td><td class="num">' + fmt(h[1]) + "</td><td>" + chip(lightOf(h[1]), " ") + "</td></tr>").join("") +
        "</tbody></table>";
      return;
    }
    const rows = ids.map((id) => [id, state.data.entities.organisation[id]])
      .sort((a, b) => a[1].n.localeCompare(b[1].n))
      .map(([id, o]) => '<tr class="click" data-sel="organisation:' + id + '"><td>' + esc(o.n) + '<span class="src">' + esc(o.sec) +
        (o.sub ? " · " + esc(o.sub) : "") + '</span></td><td class="num">' + fmt(value(o, "tm")) + "</td><td>" + chip(lightOf(value(o, "tm")), " ") + "</td></tr>").join("");
    document.getElementById("panel").innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(place) + '</h2><p class="sub">' +
      ids.length + " " + esc(t("n_orgs")) + '</p><table><thead><tr><th>' + esc(t("orgs_here")) + '</th><th class="num">TP</th><th></th></tr></thead><tbody>' +
      rows + "</tbody></table>";
  }

  /* ---- critical-services list: dimensions and labels ---------------------- */
  const trSKI = (name) => (window.SKI && SKI[name] && SKI[name][state.lang]) || name;
  function dimData(dim) {
    const d = state.data.dims || {};
    return d[dim || state.dim] || (dim === "sektor" || !dim ? state.data.sectors : null) || {};
  }
  function dimLabel(dim, key) {
    if (key.startsWith("@")) return t({ "@Kantone": "bench_canton", "@Gemeinden": "bench_municipality", "@Bund": "bench_federal" }[key]);
    if (dim === "sektor") return key === "–" ? t("no_sector") : trSKI(key);
    if (dim === "teilsektor") return key.split(" / ").map((x) => (x === "–" ? t("no_sector") : trSKI(x))).join(" / ");
    if (dim === "service_typ") return key === "–" ? "–" : t("st_" + key);
    return key;
  }
  const LIST_DOC = "https://github.com/Accelerate-GmbH/cert_landscape_CH/blob/main/docs/CRITICAL_SERVICES.md";

  /* ---- explanations: every traffic light can be traced back ---------------- */
  const CAT_CHECKS = { ownership: ["own.identity", "own.revocation", "own.dnssec", "own.caa", "own.ct", "own.sectxt"],
    sovereignty: ["sov.ca", "sov.dns", "sov.registrar", "sov.hosting", "sov.tld"], security: ["sec.tls13", "sec.pqc", "sec.hsts"], privacy: ["prv.ech"] };
  const CAT_LABEL = { ownership: "tm_own", sovereignty: "tm_sov", security: "tm_sec", privacy: "tm_prv" };
  const PTS = { pass: 1, partial: 0.5, fail: 0 };
  function cfg() {
    const c = state.data.cfg || {};
    return { cw: c.category_weights || { ownership: 0.3, sovereignty: 0.3, security: 0.25, privacy: 0.15 },
      w: c.checks || {}, g: c.green || 80, y: c.yellow || 50, crit: c.critical_resource_weight || 3 };
  }
  /* Measured values in words where the raw value is a code (PQC: preferred/enabled/no per endpoint). */
  const urTag = () => ' <span class="urtag" title="' + esc(t("ur_title")) + '">' + esc(t("ur_tag")) + "</span>";
  function chkVal(cid, v) {
    if (v === null || v === undefined) return "";
    if (cid === "sec.pqc") return String(v).split("/").map((x) => (x ? t("pq_" + x) : "")).join(" / ");
    return String(v);
  }
  const stTag = (st) => '<span class="st ' + (st === "pass" ? "pass" : st === "fail" ? "fail" : "na") + '">' + esc(t("status_" + st)) + "</span>";
  function wmean(list, fn, crit) {
    let a = 0, b = 0;
    for (const r of list) { const v = fn(r); if (v === null || v === undefined) continue; const w = r.crit ? crit : 1; a += w * v; b += w; }
    return b ? Math.round(a / b) : null;
  }
  function head(title, value) {
    return '<h3>' + esc(t("how")) + "</h3><h2>" + esc(title) + '</h2><div class="tmhead"><span class="v">' + fmt(value) + "</span>" + chip(lightOf(value)) + "</div>";
  }
  function thresholdsNote() { const c = cfg(); return '<p class="src">' + esc(t("thresholds").replace("{g}", c.g).replace("{y}", c.y)) + "</p>"; }
  /* Formula in the expert view, plain explanation in the simple view. */
  function note(formula, plain) {
    if (simple()) return '<div class="plain"><b>' + esc(t("in_words")) + "</b><p>" + esc(fill(plain)) + "</p></div>";
    return '<p class="sub">' + esc(formula) + "</p>" + thresholdsNote();
  }
  const plainCat = (k) => (G().cats[k] || {}).s || "";
  const plainChk = (k) => (G().checks[k] || {}).s || "";
  function resRow(level, id, i, r, valueHtml) {
    return '<tr class="click" data-rdetail="' + level + ":" + id + ":" + i + '"><td>' + esc(r.h) + (r.crit ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (r.ur ? urTag() : "") +
      (r.ko ? ' <span class="chip">K.-o.</span>' : "") + "</td>" + valueHtml + "</tr>";
  }
  function explain(spec) {
    const p = spec.split("|");
    if (p[0] === "e") return explainEntity(p[1], p[2], p[3], p[4]);
    if (p[0] === "r") return explainResource(p[1], p[2], Number(p[3]), p[4], p[5]);
    if (p[0] === "s") return explainSector(p[1], p[2], p[3], p[4]);
  }
  function backTo(level, id) { return '<button class="close" data-sel="' + level + ":" + id + '">← ' + esc(t("back")) + "</button>"; }

  function explainEntity(level, id, kind, arg) {
    const e = state.data.entities[level][id];
    const panel = document.getElementById("panel");
    panel.innerHTML = '<p class="muted">' + esc(t("loading")) + "</p>";
    loadResources(level, id).then((list) => {
      const c = cfg();
      const idx = list.map((r, i) => [r, i]);
      let html = backTo(level, id);
      if (kind === "overall") {
        const rows = Object.keys(CAT_CHECKS).map((k) => {
          const v = e.tm.c ? e.tm.c[k] : null;
          return "<tr><td>" + esc(t("m_" + CAT_LABEL[k])) + '</td><td class="num">' + fmt(v) + '</td><td class="num">' + Math.round(100 * c.cw[k]) +
            " %</td><td>" + chip(lightOf(v), " ", v === null || v === undefined ? null : ["e", level, id, "cat", k].join("|")) + "</td></tr>";
        }).join("");
        const re = wmean(list, (r) => r.o, c.crit);
        html += head(e.n + " · " + t("m_tm"), e.tm.o) + note(t("f_ent_overall").replace("{cw}", c.crit), t("m_tm_d") + " " + G().lights.simple[lightOf(e.tm.o)]) +
          '<table><thead><tr><th></th><th class="num">' + esc(t("rating")) + '</th><th class="num">' + esc(t("weight")) + "</th><th></th></tr></thead><tbody>" + rows + "</tbody></table>" +
          '<p class="src">' + esc(t("recomputed").replace("{n}", list.length).replace("{v}", fmt(re))) + (e.tm.ko ? " · " + esc(t("ko_note")) : "") + "</p>" +
          "<h3>" + esc(t("weakest_first")) + '</h3><table><tbody>' +
          idx.slice().sort((a, b) => (a[0].o ?? 999) - (b[0].o ?? 999)).map(([r, i]) => resRow(level, id, i, r, '<td class="num">' + fmt(r.o) + "</td><td>" + chip(lightOf(r.o), " ") + "</td>")).join("") + "</tbody></table>";
      } else if (kind === "cat") {
        const v = e.tm.c ? e.tm.c[arg] : null;
        const k = e.tm.k || {};
        const rows = CAT_CHECKS[arg].map((cid) => {
          const x = k[cid];
          const sh = x ? Math.round(100 * (x.pass + 0.5 * x.partial) / x.assessed) : null;
          return '<tr class="click" data-explain="' + ["e", level, id, "chk", cid].join("|") + '"><td>' + esc(t(cid)) + '</td><td class="num">' + (c.w[cid] ?? 1) +
            '</td><td class="num">' + (x ? x.pass + " / " + x.partial + " / " + x.fail : "–") + '</td><td class="num">' + fmt(sh) + "</td><td>" + chip(lightOf(sh), " ") + "</td></tr>";
        }).join("");
        const re = wmean(list, (r) => (r.c ? r.c[arg] : null), c.crit);
        html += head(e.n + " · " + t("m_" + CAT_LABEL[arg]), v) + note(t("f_ent_cat").replace("{cw}", c.crit), plainCat(arg)) +
          '<table><thead><tr><th>' + esc(t("check_col")) + '</th><th class="num">' + esc(t("weight")) + '</th><th class="num">✓ / ½ / ✗</th><th class="num">%</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>" +
          '<p class="src">' + esc(t("recomputed").replace("{n}", list.length).replace("{v}", fmt(re))) + "</p>" +
          "<h3>" + esc(t("weakest_first")) + "</h3><table><tbody>" +
          idx.filter(([r]) => r.c && r.c[arg] !== null && r.c[arg] !== undefined).sort((a, b) => a[0].c[arg] - b[0].c[arg])
            .map(([r, i]) => resRow(level, id, i, r, '<td class="num">' + r.c[arg] + "</td><td>" + chip(lightOf(r.c[arg]), " ") + "</td>")).join("") + "</tbody></table>";
      } else if (kind === "chk") {
        const order = { fail: 0, partial: 1, pass: 2, "n/a": 3 };
        const rows = idx.map(([r, i]) => [r, i, (r.chk || []).find((x) => x[0] === arg)]).filter(([, , x]) => x)
          .sort((a, b) => order[a[2][1]] - order[b[2][1]]);
        const x = (e.tm.k || {})[arg] || { pass: 0, partial: 0, fail: 0, assessed: 0 };
        const sh = x.assessed ? Math.round(100 * (x.pass + 0.5 * x.partial) / x.assessed) : null;
        const dom = (r) => (e.d || []).find((d) => r.h === d || r.h.endsWith("." + d)) || "";
        html += head(e.n + " · " + t(arg), sh) + note(t("f_chk"), plainChk(arg)) +
          '<p class="sub">' + stTag("pass") + " " + x.pass + " · " + stTag("partial") + " " + x.partial + " · " + stTag("fail") + " " + x.fail +
          " · " + esc(t("source_col")) + ": " + src(arg) + "</p><table><tbody>" +
          rows.map(([r, i, y]) => resRow(level, id, i, r, "<td>" + stTag(y[1]) + "</td>" + (simple() ? "" : '<td class="ev">' + esc(chkVal(arg, y[2])) +
            (y[4] ? '<span class="src">' + esc(y[4]) + "</span>" : "") + '</td><td class="srccell">' + checkLinks(arg, r, dom(r)).filter(Boolean).join(" · ") + "</td>"))).join("") +
          "</tbody></table>";
      }
      panel.innerHTML = html;
    });
  }

  function explainResource(level, id, idx, kind, arg) {
    const r = cache[level + "-" + id][idx];
    const c = cfg();
    let html = '<button class="close" data-rdetail="' + level + ":" + id + ":" + idx + '">← ' + esc(t("back")) + "</button>";
    if (kind === "overall") {
      let a = 0, b = 0;
      const rows = Object.keys(CAT_CHECKS).map((k) => {
        const v = r.c ? r.c[k] : null;
        if (v !== null && v !== undefined) { a += v * c.cw[k]; b += c.cw[k]; }
        return "<tr><td>" + esc(t("m_" + CAT_LABEL[k])) + '</td><td class="num">' + fmt(v) + '</td><td class="num">' + Math.round(100 * c.cw[k]) + ' %</td><td class="num">' +
          (v === null || v === undefined ? "–" : (v * c.cw[k]).toFixed(1)) + "</td><td>" + chip(lightOf(v), " ", v === null || v === undefined ? null : ["r", level, id, idx, "cat", k].join("|")) + "</td></tr>";
      }).join("");
      html += head(r.h + " · " + t("m_tm"), r.o) + note(t("f_res_overall"), t("m_tm_d") + " " + G().lights.simple[lightOf(r.o)]) +
        (r.ko ? '<p class="note">K.-o.: ' + esc(r.ko) + " · " + esc(t("ko_note")) + "</p>" : "") +
        '<table><thead><tr><th></th><th class="num">' + esc(t("rating")) + '</th><th class="num">' + esc(t("weight")) + '</th><th class="num">' + esc(t("contribution")) +
        "</th><th></th></tr></thead><tbody>" + rows +
        (r.ko ? '<tr><td>' + esc(t("total_before_ko")) + '</td><td></td><td class="num">' + Math.round(100 * b) + ' %</td><td class="num">' + (b ? Math.round(a / b) : "–") +
            '</td><td></td></tr><tr><td><b>' + esc(t("ko_row")) + '</b><span class="src">' + esc(r.ko) + '</span></td><td></td><td></td><td class="num"><b>0</b></td><td>' + chip("red", " ") + "</td></tr>"
          : '<tr><td><b>' + esc(t("total")) + '</b></td><td></td><td class="num">' + Math.round(100 * b) + ' %</td><td class="num"><b>' + (b ? Math.round(a / b) : "–") + "</b></td><td></td></tr>") +
        "</tbody></table>";
    } else {
      let a = 0, b = 0;
      const rows = CAT_CHECKS[arg].map((cid) => {
        const x = (r.chk || []).find((y) => y[0] === cid) || [cid, "n/a", "", "", ""];
        const w = c.w[cid] ?? 1;
        const pt = PTS[x[1]];
        if (pt !== undefined) { a += w * pt; b += w; }
        return "<tr><td>" + esc(t(cid)) + '<span class="src">' + esc(chkVal(cid, x[2])) + "</span></td><td>" + stTag(x[1]) + '</td><td class="num">' + w +
          '</td><td class="num">' + (pt === undefined ? "–" : pt) + '</td><td class="num">' + (pt === undefined ? "–" : (w * pt).toFixed(1)) + "</td></tr>";
      }).join("");
      html += head(r.h + " · " + t("m_" + CAT_LABEL[arg]), r.c ? r.c[arg] : null) + note(t("f_res_cat"), plainCat(arg)) +
        '<table><thead><tr><th>' + esc(t("check_col")) + "</th><th></th><th class=\"num\">" + esc(t("weight")) + '</th><th class="num">' + esc(t("points")) +
        '</th><th class="num">' + esc(t("contribution")) + "</th></tr></thead><tbody>" + rows + '<tr><td><b>' + esc(t("total")) + '</b></td><td></td><td class="num">' + b +
        '</td><td></td><td class="num"><b>' + a.toFixed(1) + "</b></td></tr></tbody></table>" +
        '<p class="sub">' + a.toFixed(1) + " ÷ " + b + " × 100 = <b>" + (b ? Math.round(100 * a / b) : "–") + "</b></p>";
    }
    document.getElementById("panel").innerHTML = html;
  }

  function explainSector(dim, key, pname, col) {
    const d = dimData(dim)[key];
    const part = d && d[pname];
    if (!part || part.suppressed) return;
    const c = cfg();
    const isB = key.startsWith("@");
    const lvl = { "@Kantone": "canton", "@Gemeinden": "municipality", "@Bund": "federal" }[key];
    const title = dimLabel(dim, key) +
      " · " + t(pname === "krit" ? "m_krit" : pname === "other" ? "m_other" : "m_all");
    let html = '<button class="close" data-close>✕</button>';
    let value, fnote, getv;
    if (col === "o") { value = part.o; fnote = t("f_ent_overall").replace("{cw}", pname === "all" ? c.crit : 1); getv = (e) => e.tm && e.tm.o; }
    else if (col.startsWith("cat:")) { const k = col.slice(4); value = part.c ? part.c[k] : null; fnote = t("f_ent_cat").replace("{cw}", pname === "all" ? c.crit : 1); getv = (e) => (e.tm && e.tm.c ? e.tm.c[k] : null); }
    else { const k = col.slice(4); const x = (part.k || {})[k]; value = share(x); fnote = t("f_chk"); getv = (e) => share(e.tm && e.tm.k ? e.tm.k[k] : null);
      if (x) fnote += " " + t("status_pass") + " " + x.pass + " · " + t("status_partial") + " " + x.partial + " · " + t("status_fail") + " " + x.fail; }
    const colLabel = col === "o" ? t("m_tm") : col.startsWith("cat:") ? t("m_" + CAT_LABEL[col.slice(4)]) : t(col.slice(4));
    const plain = col === "o" ? t("m_tm_d") : col.startsWith("cat:") ? plainCat(col.slice(4)) : plainChk(col.slice(4));
    html += head(title + " · " + colLabel, value) + note(fnote, plain) +
      '<p class="src">n = ' + part.n + (part.d ? " · " + (part.d.green || 0) + " " + esc(t("light_green")) + " · " + (part.d.yellow || 0) + " " + esc(t("light_yellow")) +
      " · " + (part.d.red || 0) + " " + esc(t("light_red")) : "") + "</p>";
    if (!isB) {
      const hosts = groupHosts(dim, key, pname).map(([id, o, h]) => [id, o, h, hostValue(h, col)])
        .sort((a, b) => (a[3].v ?? 101) - (b[3].v ?? 101) || a[2][0].localeCompare(b[2][0]));
      const linkedName = (k) => { const [l, i] = k.split(":"); const x = (state.data.entities[l] || {})[i]; return x ? x.n : k; };
      const hrow = ([id, o, h, hv]) => '<tr class="click" data-orghost="' + esc(id + "|" + h[0]) + '"><td>' + esc(h[0]) +
        (h[5] ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (h[9] ? urTag() : "") + '<span class="src">' + esc(o.n) + (h[6] ? " · " + esc(t("measured_at").replace("{x}", linkedName(h[6]))) : "") +
        '</span></td><td class="num">' + (hv.st ? "" : fmt(hv.v)) + "</td><td>" + (hv.st ? stTag(ST_NAME[hv.st]) : chip(lightOf(hv.v), " ")) + "</td></tr>";
      const byOrg = {};
      hosts.forEach(([id, o, , hv]) => { const x = byOrg[id] || (byOrg[id] = { o, n: 0, sum: 0, cnt: 0 }); x.n++; if (hv.v !== null && hv.v !== undefined) { x.sum += hv.v; x.cnt++; } });
      const orgs = Object.entries(byOrg).map(([id, x]) => [id, x, x.cnt ? Math.round(x.sum / x.cnt) : null]).sort((a, b) => (a[2] ?? 101) - (b[2] ?? 101));
      html += "<h3>" + esc(t("hosts_here")) + " (" + hosts.length + ')</h3><p class="src">' + esc(t("hosts_sorted_col")) + "</p>" +
        (hosts.length ? "<table><tbody>" + hosts.map(hrow).join("") + "</tbody></table>" : "") +
        "<h3>" + esc(t("orgs_here")) + " (" + orgs.length + ')</h3><p class="src">' + esc(t("orgs_mean_col")) + "</p>" +
        (orgs.length ? "<table><tbody>" + orgs.map(([id, x, v]) => '<tr class="click" data-sel="organisation:' + esc(id) + '"><td>' + esc(x.o.n) +
          '<span class="src">' + x.n + " " + esc(t("n_hosts")) + (x.o.ort ? " · " + esc(x.o.ort) : "") + '</span></td><td class="num">' + fmt(v) + "</td><td>" +
          chip(lightOf(v), " ") + "</td></tr>").join("") + "</tbody></table>" : "") +
        (part.tief !== null && part.tief !== undefined ? '<p class="src">' + esc(t("conf_low")) + ": " + Math.round(100 * part.tief) + ' % · <a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></p>" : "");
      document.getElementById("panel").innerHTML = html;
      return;
    }
    const ents = Object.entries(state.data.entities[lvl] || {});
    const elvl = isB ? lvl : "organisation";
    const rows = ents.map(([id, e]) => [id, e, getv(e)]).filter(([, , v]) => v !== null && v !== undefined).sort((a, b) => a[2] - b[2])
      .map(([id, e, v]) => '<tr class="click" data-sel="' + elvl + ":" + id + '"><td>' + esc(e.n) + '</td><td class="num">' + v + "</td><td>" + chip(lightOf(v), " ") + "</td></tr>").join("");
    html += "<h3>" + esc(isB ? t("units") : t("sector_list")) + "</h3>" + (rows ? "<table><tbody>" + rows + "</tbody></table>" : "") +
      (!isB && d.orgs > ents.length ? '<p class="note">' + esc(t("agg_note").replace("{n}", d.orgs - ents.length)) + " " + esc(t("agg_only")) + "</p>" : "") +
      (!isB && part.tief !== null && part.tief !== undefined ? '<p class="src">' + esc(t("conf_low")) + ": " + Math.round(100 * part.tief) + ' % · <a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></p>" : "");
    document.getElementById("panel").innerHTML = html;
  }

  /* ---- sector matrix ------------------------------------------------------- */
  const CHECK_IDS = ["own.identity", "own.revocation", "own.dnssec", "own.caa", "own.ct", "own.sectxt", "sov.ca", "sov.dns", "sov.registrar", "sov.hosting", "sov.tld", "sec.tls13", "sec.pqc", "sec.hsts", "prv.ech"];
  const CHECK_SHORT = { "own.identity": "OV/EV", "own.revocation": "OCSP/CRL", "own.dnssec": "DNSSEC", "own.caa": "CAA", "own.ct": "SCT",
    "own.sectxt": "sec.txt", "sov.ca": "CA", "sov.dns": "DNS", "sov.registrar": "Registrar", "sov.hosting": "Host", "sov.tld": "TLD",
    "sec.tls13": "TLS 1.3", "sec.pqc": "PQC", "sec.hsts": "HSTS", "prv.ech": "ECH" };
  const CATS = [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]];
  function share(k) { return k && k.assessed ? Math.round(100 * (k.pass + 0.5 * k.partial) / k.assessed) : null; }
  function cell(v, title, explain) {
    if (v === null || v === undefined) return '<td class="cell sup">–</td>';
    const l = lightOf(v);
    const col = css(LIGHT_COLORS[l]);
    return '<td class="cell click" data-explain="' + esc(explain || "") + '" title="' + esc((title || "") + " · " + t("how")) +
      '" style="background:' + col + "22;box-shadow:inset 3px 0 " + col + '">' + v + "</td>";
  }
  function matrixRow(cls, label, part, key, pname, dim) {
    if (!part) return "";
    if (part.suppressed) return '<tr class="' + cls + '" data-sector="' + esc(key) + '"><td class="name">' + label + '</td><td class="sup" colspan="' +
      (5 + (simple() ? 0 : CHECK_IDS.length)) + '">' + esc(t("suppressed")) + " (n = " + part.n + ")</td></tr>";
    const tief = part.tief !== null && part.tief !== undefined && !key.startsWith("@") ? " · " + esc(t("conf_low")) + " " + Math.round(100 * part.tief) + " %" : "";
    const ex = (col) => ["s", dim, key, pname, col].join("|");
    return '<tr class="' + cls + '"><td class="name click" data-sector="' + esc(dim + "|" + key) + '">' + label + '<span class="src">n = ' + part.n + tief + "</span></td>" +
      cell(part.o, t("m_tm"), ex("o")) + CATS.map(([c, m]) => cell(part.c ? part.c[c] : null, t("m_" + m), ex("cat:" + c))).join("") +
      (simple() ? "" : CHECK_IDS.map((id) => cell(share((part.k || {})[id]), t(id), ex("chk:" + id))).join("")) + "</tr>";
  }
  function renderMatrix() {
    const dim = state.dim;
    const sec = dimData(dim);
    const names = Object.keys(sec).filter((k) => !k.startsWith("@")).sort((a, b) => dimLabel(dim, a).localeCompare(dimLabel(dim, b)));
    const bench = ["@Kantone", "@Gemeinden", "@Bund"].filter((k) => sec[k]);
    let rows = "", linked = 0;
    for (const k of names.concat(bench)) {
      const d = sec[k];
      const isB = k.startsWith("@");
      linked += isB ? 0 : (d.linked || 0);
      const label = esc(dimLabel(dim, k)) + (isB ? "" : '<span class="src">' + d.orgs + " " + esc(t("n_orgs")) + " · " + d.hosts + " " + esc(t("n_hosts")) + "</span>");
      rows += matrixRow("sec" + (isB ? " bench" : ""), label, d.all, k, "all", dim);
      rows += matrixRow("sub", esc(t("m_krit")), d.krit, k, "krit", dim) + matrixRow("sub", esc(t("m_other")), d.other, k, "other", dim);
    }
    const CS = { tm_own: "cs_own", tm_sov: "cs_sov", tm_sec: "cs_sec", tm_prv: "cs_prv" };
    const head = "<th></th><th>" + (simple() ? esc(t("m_tm")) : "TP") + "</th>" + CATS.map(([, m]) => '<th title="' + esc(t("m_" + m)) + '">' + esc(simple() ? t("m_" + m) : t(CS[m])) + "</th>").join("") +
      (simple() ? "" : CHECK_IDS.map((id) => '<th title="' + esc(t(id)) + " · " + esc(t("source_col")) + ": " + esc((SRC[id] || []).join(", ")) + '">' + CHECK_SHORT[id] + "</th>").join(""));
    const dims = ["sektor", "teilsektor", "service_typ", "kanton"].filter((x) => x === "sektor" || (state.data.dims && state.data.dims[x]));
    const sel = '<div class="seg" role="group" style="margin:6px 0 8px">' + dims.map((x) =>
      '<button data-dim="' + x + '" aria-pressed="' + (x === dim) + '">' + esc(t("dim_" + x)) + "</button>").join("") + "</div>";
    document.getElementById("matrix").innerHTML = "<h2>" + esc(t("matrix_title")) + '</h2><p class="sub">' + (simple() ? esc(t("sector_intro_simple")) + " " : "") + esc(t("matrix_note")) + " " + (aggHidden() ? esc(t("agg_only")) : "") +
      ' <a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a>" + (linked ? " · " + esc(t("linked_note").replace("{n}", linked)) : "") + "</p>" + sel +
      (names.length || bench.length ? "<table><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table>" : '<p class="muted">' + esc(t("no_data")) + "</p>");
  }
  function isTable() { return state.level === "sector" || state.level === "federal" || state.level === "hosts"; }

  /* ---- all hosts: one sortable, filterable table ------------------------- */
  const HL = { rows: null, loading: null, sort: { k: "o", dir: 1 }, q: "", type: "", crit: false, page: 0, size: 100 };
  function loadHosts() {
    if (HL.rows || HL.loading) return HL.loading || Promise.resolve(HL.rows);
    const url = DATA_URL.replace(/map\.json(\?.*)?$/, "hosts.json") + "?v=" + BUILD;
    HL.loading = fetch(url).then((r) => (r.ok ? r.json() : { rows: [] })).catch(() => ({ rows: [] })).then((j) => {
      const order = j.order || CHECK_IDS;
      HL.rows = (j.rows || []).map((x) => {
        const [lvl, ...rest] = x[1].split(":"); const id = rest.join(":");
        const e = (state.data.entities[lvl] || {})[id];
        const st = {}; order.forEach((cid, i) => { st[cid] = (x[7] || "")[i] || "-"; });
        return { h: x[0], key: x[1], lvl, id, owner: e ? e.n : x[1], o: x[2], c: { ownership: x[3], sovereignty: x[4], security: x[5], privacy: x[6] }, st, crit: !!x[8], ko: x[9] || "", ur: !!x[10] };
      });
      return HL.rows;
    });
    return HL.loading;
  }
  const ST_VAL = { p: 2, h: 1, f: 0, "-": -1 };
  function hostsFiltered() {
    const q = HL.q.trim().toLowerCase();
    let rows = HL.rows.filter((r) => (!HL.type || r.lvl === HL.type) && (!HL.crit || r.crit) &&
      (!q || r.h.includes(q) || r.owner.toLowerCase().includes(q)));
    const k = HL.sort.k, dir = HL.sort.dir;
    const get = k === "h" ? (r) => r.h : k === "owner" ? (r) => r.owner : k === "type" ? (r) => r.lvl :
      k === "o" ? (r) => r.o ?? -1 : k.startsWith("cat:") ? (r) => r.c[k.slice(4)] ?? -1 : (r) => ST_VAL[r.st[k.slice(4)]] ?? -1;
    rows = rows.slice().sort((a, b) => { const va = get(a), vb = get(b); return (va > vb ? 1 : va < vb ? -1 : a.h.localeCompare(b.h)) * dir; });
    return rows;
  }
  function stCell(st, title) {
    const l = { p: "green", h: "yellow", f: "red" }[st];
    if (!l) return '<td class="cell sup">–</td>';
    return '<td class="cell stc" title="' + esc(title + ": " + t("status_" + ST_NAME[st])) + '" style="background:' + css(LIGHT_COLORS[l]) + '22;border-left:3px solid ' +
      css(LIGHT_COLORS[l]) + '">' + { p: "✓", h: "½", f: "✗" }[st] + "</td>";
  }
  function renderHostsTable() {
    const box = document.getElementById("hoststable");
    if (!box) return;
    if (!HL.rows) { box.innerHTML = '<p class="muted">' + esc(t("loading")) + "</p>"; return; }
    const rows = hostsFiltered();
    const pages = Math.max(1, Math.ceil(rows.length / HL.size));
    HL.page = Math.min(HL.page, pages - 1);
    const from = HL.page * HL.size, part = rows.slice(from, from + HL.size);
    const th = (k, label, title) => '<th data-hsort="' + k + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(label) +
      (HL.sort.k === k ? (HL.sort.dir < 0 ? " ↓" : " ↑") : "") + "</th>";
    const head = th("h", t("t_host")) + th("owner", t("col_owner")) + th("type", t("col_type")) + th("o", simple() ? t("m_tm") : "TP") +
      CATS.map(([c, m]) => th("cat:" + c, simple() ? t("m_" + m) : t({ tm_own: "cs_own", tm_sov: "cs_sov", tm_sec: "cs_sec", tm_prv: "cs_prv" }[m]), t("m_" + m))).join("") +
      (simple() ? "" : CHECK_IDS.map((cid) => th("chk:" + cid, CHECK_SHORT[cid], t(cid))).join(""));
    const body = part.map((r) => '<tr class="click" data-hostrow="' + esc(r.key + "|" + r.h) + '"><td class="hn">' + esc(r.h) +
      (r.crit ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (r.ur ? urTag() : "") + "</td><td>" + esc(r.owner) + '</td><td class="src">' + esc(t(KIND_LABEL[r.lvl])) + "</td>" +
      (r.ko ? cell(r.o, t("m_tm"), null).replace(/>0<\/td>$/, '><span title="' + esc(t("ko_row") + ": " + r.ko) + '">0 <span class="kotag">K.-o.</span></span></td>') : cell(r.o, t("m_tm"), null)) +
      CATS.map(([c, m]) => cell(r.c[c], t("m_" + m), null)).join("") +
      (simple() ? "" : CHECK_IDS.map((cid) => stCell(r.st[cid], t(cid))).join("")) + "</tr>").join("");
    const pager = '<div class="pager"><span class="src">' + esc(t("rows_shown").replace("{a}", rows.length ? from + 1 : 0).replace("{b}", from + part.length).replace("{n}", rows.length)) + "</span> " +
      '<button class="linkbtn" data-hpage="-1"' + (HL.page ? "" : " disabled") + ">← " + esc(t("prev")) + "</button> " +
      '<button class="linkbtn" data-hpage="1"' + (HL.page < pages - 1 ? "" : " disabled") + ">" + esc(t("next")) + " →</button></div>";
    box.innerHTML = pager + '<div class="hostswrap"><table class="hosts"><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div>" + pager;
  }
  function renderHosts() {
    const types = ["", "canton", "municipality", "federal", "organisation"];
    document.getElementById("matrix").innerHTML = "<h2>" + esc(t("hosts_title")) + '</h2><p class="sub">' + esc(t("hosts_intro")) +
      ' <a href="https://github.com/Accelerate-GmbH/cert_landscape_CH/blob/main/output/latest/hostnames.csv">' + esc(t("hosts_csv")) + "</a></p>" +
      '<div class="hostfilters"><input id="hostq" type="search" autocomplete="off" placeholder="' + esc(t("hosts_filter")) + '" value="' + esc(HL.q) + '">' +
      '<select id="hosttype">' + types.map((x) => '<option value="' + x + '"' + (x === HL.type ? " selected" : "") + ">" + esc(x ? t(KIND_LABEL[x]) : t("type_all")) + "</option>").join("") + "</select>" +
      '<label><input type="checkbox" id="hostcrit"' + (HL.crit ? " checked" : "") + "> " + esc(t("only_crit")) + "</label></div>" +
      '<div id="hoststable"></div>';
    const q = document.getElementById("hostq");
    let tmo = null;
    q.addEventListener("input", () => { clearTimeout(tmo); tmo = setTimeout(() => { HL.q = q.value; HL.page = 0; renderHostsTable(); }, 150); });
    document.getElementById("hosttype").addEventListener("change", (ev) => { HL.type = ev.target.value; HL.page = 0; renderHostsTable(); });
    document.getElementById("hostcrit").addEventListener("change", (ev) => { HL.crit = ev.target.checked; HL.page = 0; renderHostsTable(); });
    renderHostsTable();
    loadHosts().then(renderHostsTable);
  }
  function overviewHosts() {
    loadHosts().then(() => {
      if (state.level !== "hosts" || state.selected) return;
      const d = { green: 0, yellow: 0, red: 0 };
      HL.rows.forEach((r) => { const l = lightOf(r.o); if (d[l] !== undefined) d[l]++; });
      const n = HL.rows.length;
      document.getElementById("panel").innerHTML = "<h2>" + esc(t("hosts_title")) + '</h2><p class="sub">' + esc(t("hosts_panel").replace("{n}", n.toLocaleString("de-CH"))) + "</p>" +
        ["green", "yellow", "red"].map((k) => '<div class="lrow"><span class="sw" style="background:' + css(LIGHT_COLORS[k]) + '"></span><span><b>' +
          esc(t("verdict_" + k)) + ":</b> " + d[k].toLocaleString("de-CH") + " (" + Math.round(100 * d[k] / (n || 1)) + " %)</span></div>").join("") +
        '<p><button class="linkbtn" data-help="lights">' + esc(t("what_lights")) + "</button></p>";
    });
  }

  /* ---- federal level: departments as a table ------------------------------ */
  function fedEntries() {
    return Object.entries(state.data.entities.federal || {}).sort((a, b) => (value(b[1], "tm") ?? -1) - (value(a[1], "tm") ?? -1));
  }
  function renderFederal() {
    const fed = fedEntries();
    const ex = (id, rest) => ["e", "federal", id].concat(rest).join("|");
    const head = "<th></th><th>" + (simple() ? esc(t("m_tm")) : "TP") + "</th>" + CATS.map(([, m]) => "<th>" + esc(simple() ? t("m_" + m) : t({ tm_own: "cs_own", tm_sov: "cs_sov", tm_sec: "cs_sec", tm_prv: "cs_prv" }[m])) + "</th>").join("") +
      (simple() ? "" : CHECK_IDS.map((id) => '<th title="' + esc(t(id)) + '">' + CHECK_SHORT[id] + "</th>").join(""));
    const rows = fed.map(([id, e]) => {
      const tm = e.tm || {};
      return '<tr class="sec"><td class="name click" data-sel="federal:' + esc(id) + '"><b>' + esc(e.c || id) + "</b> " + esc(e.n) + '<span class="src">' +
        (tm.n || 0) + " " + esc(t("n_hosts")) + " · " + esc((e.d || []).length + " " + t("t_domain")) + "</span></td>" +
        cell(tm.o ?? null, t("m_tm"), tm.o !== undefined && tm.o !== null ? ex(id, ["overall"]) : null) +
        CATS.map(([c, m]) => cell(tm.c ? tm.c[c] : null, t("m_" + m), tm.c && tm.c[c] !== null && tm.c[c] !== undefined ? ex(id, ["cat", c]) : null)).join("") +
        (simple() ? "" : CHECK_IDS.map((cid) => cell(share((tm.k || {})[cid]), t(cid), (tm.k || {})[cid] ? ex(id, ["chk", cid]) : null)).join("")) + "</tr>";
    }).join("");
    document.getElementById("matrix").innerHTML = "<h2>" + esc(t("fed_table_title")) + '</h2><p class="sub">' + esc(t("fed_intro")) + "</p>" +
      (fed.length ? "<table><thead><tr>" + head + "</tr></thead><tbody>" + rows + "</tbody></table>" :
        '<div class="why"><b>' + esc(t("whys_not_in_run")) + "</b><p>" + esc(t("fed_none")) + "</p></div>");
  }
  function overviewFederal() {
    const fed = fedEntries();
    let sw = 0, sv = 0;
    fed.forEach(([, e]) => { const v = value(e, "tm"); const w = (e.tm && e.tm.n) || 1; if (v !== null) { sw += w; sv += w * v; } });
    const total = sw ? Math.round(sv / sw) : null;
    document.getElementById("panel").innerHTML = "<h2>" + esc(t("fed_table_title")) + '</h2><p class="sub">' + esc(t("fed_intro")) + "</p>" +
      (fed.length ? verdictBlock(total, null, '<div class="sub">' + esc(t("fed_total")) + "</div>") : "") +
      '<p><button class="linkbtn" data-help="what">' + esc(t("to_help")) + " →</button></p>";
  }

  function aggHidden() {
    const d = dimData("sektor");
    return Object.entries(d).some(([k, x]) => !k.startsWith("@") && x.orgs > (x.public || 0));
  }
  /* Hosts of the critical-services list in one group of the sector table. */
  function groupHosts(dim, key, pname) {
    const inGroup = (o, h) => dim === "sektor" ? (h[2] || o.sec || "–") === key : dim === "teilsektor" ? ((h[2] || o.sec || "–") + " / " + (h[3] || o.sub || "–")) === key :
      dim === "service_typ" ? (h[4] || "–") === key : dim === "kanton" ? (o.kt || o.c || "–") === key : false;
    const out = [];
    Object.entries(state.data.entities.organisation || {}).forEach(([id, o]) => (o.hs || []).forEach((h) => {
      if (inGroup(o, h) && (pname === "all" || (pname === "krit") === !!h[5])) out.push([id, o, h]);
    }));
    return out;
  }
  const ST_NAME = { p: "pass", h: "partial", f: "fail", "-": "n/a" };
  function hostValue(h, col) {
    if (col === "o") return { v: h[1] };
    if (col.startsWith("cat:")) { const i = CATS.findIndex(([c]) => c === col.slice(4)); return { v: h[7] ? h[7][i] : null }; }
    const order = state.data.chk_order || CHECK_IDS;
    const st = (h[8] || "")[order.indexOf(col.slice(4))] || "-";
    return { st, v: { p: 100, h: 50, f: 0 }[st] ?? null };
  }
  function sectorPanel(spec) {
    const [dim, key] = spec.includes("|") ? spec.split("|") : ["sektor", spec];
    const d = dimData(dim)[key];
    if (!d) return;
    if (key.startsWith("@")) { select(null, null); return; }
    const hostRows = groupHosts(dim, key, "all");
    const orgIds = new Set(hostRows.map((x) => x[0]));
    hostRows.sort((a, b) => (a[2][1] ?? 101) - (b[2][1] ?? 101) || a[2][0].localeCompare(b[2][0]));
    const pubs = [...orgIds].map((id) => [id, state.data.entities.organisation[id]]).sort((a, b) => a[1].n.localeCompare(b[1].n));
    const linkedName = (k) => { const [l, i] = k.split(":"); const x = (state.data.entities[l] || {})[i]; return x ? x.n : k; };
    const hrows = hostRows.map(([id, o, h]) => '<tr class="click" data-orghost="' + esc(id + "|" + h[0]) + '"><td>' + esc(h[0]) +
      (h[5] ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (h[9] ? urTag() : "") + '<span class="src">' + esc(o.n) + (h[4] ? " · " + esc(t("st_" + h[4]) !== "st_" + h[4] ? t("st_" + h[4]) : h[4]) : "") +
      (h[6] ? " · " + esc(t("measured_at").replace("{x}", linkedName(h[6]))) : "") + '</span></td><td class="num">' + fmt(h[1]) + "</td><td>" +
      chip(lightOf(h[1]), " ") + "</td></tr>").join("");
    const rows = pubs.map(([id, o]) => '<tr class="click" data-sel="organisation:' + id + '"><td>' + esc(o.n) + (o.sub ? '<span class="src">' + esc(o.sub) + "</span>" : "") +
      '</td><td class="num">' + fmt(value(o, "tm")) + "</td><td>" + chip(lightOf(value(o, "tm")), " ") + "</td></tr>").join("");
    const hidden = d.orgs - pubs.length;
    const tief = d.all && d.all.tief !== null && d.all.tief !== undefined ? " · " + esc(t("conf_low")) + " " + Math.round(100 * d.all.tief) + " %" : "";
    document.getElementById("panel").innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(dimLabel(dim, key)) + '</h2><p class="sub">' +
      d.orgs + " " + esc(t("n_orgs")) + " · " + d.hosts + " " + esc(t("n_hosts")) + tief + "</p>" +
      (d.all && !d.all.suppressed ? '<div class="tmhead"><span class="v">' + fmt(d.all.o) + "</span>" + chip(lightOf(d.all.o), null, ["s", dim, key, "all", "o"].join("|")) + "</div>" +
        CATS.map(([c, m]) => '<div class="cat"><span>' + esc(t("m_" + m)) + '</span><span class="num">' + fmt(d.all.c ? d.all.c[c] : null) + "</span>" +
          chip(lightOf(d.all.c ? d.all.c[c] : null), null, d.all.c && d.all.c[c] !== null ? ["s", dim, key, "all", "cat:" + c].join("|") : null) + "</div>").join("") : '<p class="note">' + esc(t("suppressed")) + "</p>") +
      (d.linked ? '<p class="src">' + esc(t("linked_note").replace("{n}", d.linked)) + "</p>" : "") +
      '<p class="src"><a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></p>" +
      (hostRows.length ? "<h3>" + esc(t("hosts_here")) + " (" + hostRows.length + ')</h3><p class="src">' + esc(t("hosts_sorted")) + "</p><table><tbody>" + hrows + "</tbody></table>" : "") +
      (pubs.length ? "<h3>" + esc(t("orgs_here")) + " (" + pubs.length + ')</h3><table><tbody>' + rows + "</tbody></table>" : "") +
      (hidden > 0 ? '<p class="note">' + esc(t("agg_note").replace("{n}", hidden)) + "</p>" : "");
  }

  function legend() {
    const el = document.getElementById("legend");
    let rows = "";
    if (isTM(state.metric)) {
      const c = cfg();
      rows = [["green", c.g + "–100"], ["yellow", c.y + "–" + (c.g - 1)], ["red", "0–" + (c.y - 1)]].map(([k, r]) =>
        '<div class="row"><span class="sw" style="background:' + css(LIGHT_COLORS[k]) + '"></span>' +
        (simple() ? "<span><b>" + esc(t("verdict_" + k)) + "</b> · " + r + "</span>" : esc(t("light_" + k)) + " " + r) + "</div>").join("");
      rows += '<div class="row"><span class="sw" style="background:' + css("--nodata") + '"></span>' + esc(t("not_assessed")) + "</div>";
      rows += '<button class="linkbtn small" data-help="lights">' + esc(t("what_lights")) + "</button>";
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
      (ls && !simple() ? '<br><span class="src">' + esc(t("source_col")) + ": " + ls + "</span>" : "") + "</div>" + rows +
      (simple() && document.getElementById("showorgs").checked && Object.keys(state.data.entities.organisation || {}).length ? '<p class="src">' + esc(t(state.orgMode === "host" ? "orgs_simple_host" : "orgs_simple")) + "</p>" : "");
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

  /* ---- why there is no value ------------------------------------------------ */
  function featureName(level, id) {
    const obj = state.topo && (level === "canton" ? state.topo.objects.cantons : level === "municipality" ? state.topo.objects.municipalities : null);
    if (level === "municipality" && state.data.mnames && state.data.mnames[id]) return state.data.mnames[id];
    if (level === "canton" && CANTON_CODES[+id - 1]) return t("t_canton") + " " + CANTON_CODES[+id - 1];
    if (!obj) return id;
    const g = obj.geometries.find((x) => String(x.id) === String(id));
    return (g && g.properties && g.properties.name) || id;
  }
  function whyOf(level, e) {
    if (!e) return level === "canton" ? "not_in_run" : "missing";
    if (e.tm && e.tm.o !== undefined && e.tm.o !== null) return null;
    if (e.why) return e.why;
    if (!e.d || !e.d.length) return "no_domain";          // data from before reasons were exported
    if (!e.hf) return e.sd ? "shared" : "no_certs";
    if (!e.h) return "not_resolving";
    return "not_assessed";
  }
  function whyBox(level, e) {
    const w = whyOf(level, e);
    if (!w) return "";
    const doms = e && e.d && e.d.length ? '<p class="src">' + esc(t("t_domain")) + ": " + esc(e.d.join(", ")) + "</p>" : "";
    return '<div class="why"><b>' + esc(t("why_title")) + "</b><p><b>" + esc(t("whys_" + w)) + ".</b> " + esc(t("why_" + w)) + "</p>" + doms + "</div>";
  }

  function detail(level, id) {
    detailInner(level, id);
    const e = (state.data.entities[level] || {})[id];
    const box = e ? whyBox(level, e) : "";
    const h2 = document.querySelector("#panel h2");
    if (box && h2 && !document.querySelector("#panel .why")) h2.insertAdjacentHTML("afterend", box);
  }
  function detailInner(level, id) {
    const e = (state.data.entities[level] || {})[id];
    const panel = document.getElementById("panel");
    if (!e) { panel.innerHTML = '<button class="close" data-close>✕</button><h2>' + esc(featureName(level, id)) + "</h2>" + whyBox(level, null); return; }
    if (simple()) { panel.innerHTML = simpleDetail(e, level, id); return; }
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
      tmSection(e, level, id) + mailSection(e, level, id) + critSeat(e, level) + stackSection(e) +
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
    rdap: () => '<a href="https://about.rdap.org">RDAP</a>',
    web: () => esc(t("src_web")),
  };
  const SRC = {
    "own.identity": ["tls", "ct"], "own.revocation": ["ocsp"], "own.dnssec": ["dns"], "own.caa": ["dns"], "own.ct": ["sct"],
    "sov.ca": ["ccadb"], "sov.dns": ["dns", "cymru"], "sov.hosting": ["cymru"], "sov.tld": ["name"],
    "sec.tls13": ["tls"], "sec.pqc": ["tls"], "prv.ech": ["dns"], "own.sectxt": ["web"], "sov.registrar": ["rdap"], "sec.hsts": ["web"],
    s: ["ct", "ccadb"], cs: ["ct", "ccadb"], a: ["ct", "tls"], ca: ["ct", "tls"], caa: ["dns"],
    crit_seat: ["tls", "dns", "ccadb", "cymru"],
    tm_own: ["tls", "ocsp", "dns", "sct"], tm_sov: ["ccadb", "dns", "cymru"], tm_sec: ["tls"], tm_prv: ["dns"],
    st_tld: ["name"], st_dns: ["dns", "cymru"], st_dnssec: ["dns"], st_host: ["cymru"], st_ca: ["ct", "ccadb"], st_root: ["ccadb"],
  };
  const src = (k) => (SRC[k] || []).map((x) => SRCL[x]()).join(", ");
  const srcSpan = (k) => (SRC[k] ? '<span class="src">' + esc(t("source_col")) + ": " + src(k) + "</span>" : "");

  function chip(l, text, explain) {
    const col = l === "none" ? css("--nodata") : css(LIGHT_COLORS[l]);
    const inner = '<i style="background:' + col + '"></i>' + esc(text || t(l === "none" ? "not_assessed" : "light_" + l));
    return explain ? '<button class="chip clickable" title="' + esc(t("how")) + '" data-explain="' + esc(explain) + '">' + inner + " ⓘ</button>"
                   : '<span class="chip">' + inner + "</span>";
  }
  function tmSection(e, level, id) {
    const tm = e.tm || {};
    if (tm.o === undefined || tm.o === null) return "";
    const cats = [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]];
    const rows = cats.map(([c, m]) => {
      const v = tm.c ? tm.c[c] : null;
      return '<div class="cat"><span>' + esc(t("m_" + m)) + srcSpan(m) + '</span><span class="num">' + fmt(v) + "</span>" +
        chip(lightOf(v), null, v === null || v === undefined ? null : ["e", level, id, "cat", c].join("|")) + "</div>";
    }).join("");
    const checks = Object.entries(tm.k || {}).map(([cid, c]) => {
      const sh = Math.round(100 * (c.pass + 0.5 * c.partial) / c.assessed);
      return '<tr class="click" data-explain="' + ["e", level, id, "chk", cid].join("|") + '"><td>' + esc(t(cid)) + '</td><td class="num">' + sh +
        ' %</td><td>' + chip(lightOf(sh), " ") + '</td><td class="num">' + c.assessed + '</td><td class="srccell">' + src(cid) + "</td></tr>";
    }).join("");
    return "<h3>" + esc(t("posture")) + '</h3><div class="tmhead"><span class="v">' + fmt(tm.o) + "</span>" + chip(lightOf(tm.o), null, ["e", level, id, "overall"].join("|")) +
      (tm.el ? chip("green", t("eligible")) : "") + '</div><p class="sub">' + (tm.n || 0) + " " + esc(t("resources")) +
      (tm.ko ? " · " + tm.ko + " " + esc(t("knockouts")) : "") + "</p>" + rows +
      '<p class="src">' + esc(t("click_light")) + "</p>" +
      '<table style="margin-top:8px"><thead><tr><th>' + esc(t("check_col")) + '</th><th class="num">' + esc(t("pass_col")) +
      '</th><th></th><th class="num">n</th><th>' + esc(t("source_col")) + '</th></tr></thead><tbody>' + checks + "</tbody></table>";
  }
  /* ---- mail: own checks per domain, next to the web rating ------------------ */
  const MAIL_CHECKS = ["mail.mx", "mail.starttls", "mail.transport", "mail.tlsrpt", "mail.dmarc", "mail.spf"];
  function mailSection(e, level, id) {
    const m = e.ml;
    if (!m) return "";
    const head2 = "<h3>" + esc(t("mail_title")) + "</h3>";
    if (m.o === null || m.o === undefined) return head2 + '<p class="sub">' + esc(t("mail_none")) + "</p>";
    const rows = MAIL_CHECKS.map((cid) => {
      const x = (m.k || {})[cid]; const v = share(x);
      return '<div class="cat"><span>' + esc(t(cid)) + (simple() ? '<span class="src">' + esc(fill((G().checks[cid] || {}).s || "")) + "</span>" : "") +
        '</span><span class="num">' + (v === null ? "–" : v + " %") + "</span>" + chip(lightOf(v), " ") + "</div>";
    }).join("");
    return head2 + '<div class="tmhead"><span class="v">' + fmt(m.o) + "</span>" + chip(lightOf(m.o), t("verdict_" + lightOf(m.o))) + '</div><p class="src">' +
      esc(t("mail_domains").replace("{n}", m.n)) + " · " + esc(t("mail_share")) + "</p>" + rows +
      '<p><button class="linkbtn" data-mail="' + esc(level + ":" + id) + '">' + esc(t("mail_show")) + " →</button></p>";
  }
  function mailDetail(level, id) {
    const e = state.data.entities[level][id];
    fetch("data/resources/mail-" + level + "-" + id + ".json?v=" + BUILD).then((r) => (r.ok ? r.json() : [])).then((doms) => {
      const card = (d) => {
        const mx = d.mx.map(([h, pref, nets, dane, tls, valid]) => "<tr><td>" + esc(h) + '<span class="src">' + esc(nets.join(", ")) + '</span></td><td class="num">' + pref +
          "</td><td>" + (dane ? stTag("pass") : "") + "</td><td>" + esc(tls || "–") + (valid === false ? ' <span class="kotag">' + esc(t("mail_invalid")) + "</span>" : "") + "</td></tr>").join("");
        const ck = d.c.map(([cid, st, val, , ev]) => "<tr><td>" + esc(t(cid)) + "<br>" + stTag(st) + '</td><td class="ev">' + esc(String(val || "")) +
          (ev ? '<span class="src">' + esc(ev) + "</span>" : "") + "</td></tr>").join("");
        return '<div class="maildom"><div class="tmhead"><b>' + esc(d.d) + '</b><span class="v">' + fmt(d.o) + "</span>" + chip(lightOf(d.o), " ") + "</div>" +
          (d.mx.length ? "<table><thead><tr><th>" + esc(t("mail_mx")) + '</th><th class="num">Pref</th><th>DANE</th><th>STARTTLS</th></tr></thead><tbody>' + mx + "</tbody></table>" +
            "<table><tbody>" + ck + "</tbody></table>" : '<p class="sub">' + esc(t(d.null ? "mail_nullmx" : "mail_nomx")) + "</p>") + "</div>";
      };
      document.getElementById("panel").innerHTML = '<button class="close" data-sel="' + esc(level + ":" + id) + '">← ' + esc(t("back")) + "</button><h2>" +
        esc(e.n) + " · " + esc(t("mail_title")) + '</h2><p class="sub">' + esc(t("mail_intro")) + "</p>" +
        doms.filter((d) => d.o !== null).map(card).join("") +
        (doms.some((d) => d.o === null) ? '<p class="src">' + esc(t("mail_unrated")) + ": " + esc(doms.filter((d) => d.o === null).map((d) => d.d).join(", ")) + "</p>" : "");
    });
  }

  function critSeat(e, level) {
    if (level !== "canton" || !state.data.dims || !state.data.dims.kanton) return "";
    const d = state.data.dims.kanton[e.c];
    if (!d) return "";
    const v = d.krit && !d.krit.suppressed ? d.krit.o : null;
    return "<h3>" + esc(t("m_crit_seat")) + '</h3><div class="cat"><span>' + d.orgs + " " + esc(t("n_orgs")) + " · " + d.hosts + " " + esc(t("n_hosts")) +
      '<span class="src"><a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></span></span><span class=\"num\">" + fmt(v) + "</span>" +
      (v === null ? '<span class="src">' + esc(t("suppressed")) + "</span>" : chip(lightOf(v), null, ["s", "kanton", e.c, "krit", "o"].join("|"))) + "</div>";
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

  /* ---- simple view: plain summary of a unit ------------------------------ */
  function verdictBlock(v, explainSpec, extra) {
    const l = lightOf(v);
    return '<div class="verdict ' + l + '"><div class="big">' + fmt(v) + '<small>/100</small></div><div><div class="vt">' +
      esc(t("verdict_" + l)) + "</div>" + (extra || "") + "</div>" + (explainSpec ? chip(l, t("how"), explainSpec) : "") + "</div>";
  }
  function gapsList(k, level, id) {
    const rows = Object.entries(k || {}).map(([cid, x]) => [cid, share(x)]).filter(([, v]) => v !== null && v < cfg().g)
      .sort((a, b) => a[1] - b[1]).slice(0, 3);
    if (!rows.length) return '<p class="sub">' + esc(t("gaps_none")) + "</p>";
    return '<ul class="gaps">' + rows.map(([cid, v]) => '<li class="click" data-explain="' + ["e", level, id, "chk", cid].join("|") + '"><div class="gt">' +
      chip(lightOf(v), " ") + "<b>" + esc(t(cid)) + '</b></div><div class="gs">' + esc(t("gap_share").replace("{p}", v)) + "</div><p>" + esc(fill(plainChk(cid))) + "</p></li>").join("") + "</ul>";
  }
  function simpleDetail(e, level, id) {
    const tm = e.tm || {};
    const d = tm.d || {};
    const doms = e.d || [];
    let html = '<button class="close" data-close aria-label="' + esc(t("close")) + '">✕</button><h2>' + esc(e.n) + "</h2>";
    if (level === "organisation") html += '<p class="sub">' + esc(trSKI(e.sec || "–")) + (e.ort ? " · " + esc(e.ort) : "") + "</p>";
    else if (doms.length) html += '<p class="sub">' + esc(doms.slice(0, 3).join(", ")) + (doms.length > 3 ? " +" + (doms.length - 3) : "") + "</p>";
    if (e.sd) html += '<p class="note">' + esc(t("shared")) + "</p>";
    if (tm.o === undefined || tm.o === null) return html + verdictBlock(null) + whyBox(level, e);
    const extra = '<div class="sub">' + esc(t("services_checked").replace("{n}", tm.n || 0)) +
      (d.green !== undefined ? " · " + esc(t("dist_line").replace("{g}", d.green || 0).replace("{y}", d.yellow || 0).replace("{r}", d.red || 0)) : "") + "</div>";
    html += verdictBlock(tm.o, ["e", level, id, "overall"].join("|"), extra);
    html += '<p class="sub">' + esc(fill(G().lights.simple[lightOf(tm.o)])) + "</p>";
    if (tm.ko) html += '<p class="note">' + esc(t("ko_simple").replace("{n}", tm.ko)) + "</p>";
    html += "<h3>" + esc(t("sec_cats")) + "</h3>" + CATS.map(([c, m]) => {
      const v = tm.c ? tm.c[c] : null;
      return '<div class="cat"><span>' + esc(t("m_" + m)) + '<span class="src">' + esc(plainCat(c)) + '</span></span><span class="num">' + fmt(v) + "</span>" +
        chip(lightOf(v), null, v === null || v === undefined ? null : ["e", level, id, "cat", c].join("|")) + "</div>";
    }).join("");
    html += "<h3>" + esc(t("gaps")) + "</h3>" + gapsList(tm.k, level, id);
    html += mailSection(e, level, id);
    html += critSeat(e, level);
    const st = e.stack;
    if (st) {
      const li = (label, arr, f) => (arr && arr.length ? "<li><b>" + esc(label) + ":</b> " + arr.slice(0, 3).map(f).join(", ") + "</li>" : "");
      html += "<h3>" + esc(t("who_behind")) + '</h3><ul class="plainlist">' +
        li(t("w_cert"), st.ca, (x) => esc(x[0]) + " (" + esc(x[1]) + ")") + li(t("w_server"), st.host, (x) => esc(x[0])) +
        li(t("w_dns"), st.dns, (x) => esc(x[0]) + " (" + esc(x[1]) + ")") + li(t("w_tld"), st.tld, (x) => "." + esc(x)) + "</ul>";
    }
    if (tm.n && level !== "organisation") html += '<p><button class="linkbtn" data-res="' + level + ":" + id + '">' + esc(t("res_show")) + " (" + tm.n + ")</button></p>";
    html += '<p><button class="linkbtn" data-view="expert">' + esc(t("show_expert")) + " →</button></p>";
    return html;
  }

  /* ---- explanation panel ---------------------------------------------------- */
  /* One line per colour, first sentence in bold. */
  function lightLine(k) {
    const txt = fill(G().lights.simple[k]);
    const i = txt.search(/[.:]\s/);
    const head = i > 0 ? txt.slice(0, i + 1) : txt, rest = i > 0 ? txt.slice(i + 2) : "";
    return '<div class="lrow"><span class="sw" style="background:' + (k === "none" ? css("--nodata") : css(LIGHT_COLORS[k])) + '"></span><span><b>' +
      esc(head) + "</b> " + esc(rest) + "</span></div>";
  }
  const DOCS = "https://github.com/Accelerate-GmbH/cert_landscape_CH/blob/main/";
  function helpPanel(section) {
    const g = G(), c = cfg(), x = !simple();
    const para = (arr) => (arr || []).map((p) => "<p>" + esc(fill(p)) + "</p>").join("");
    const sec = (id, title, body) => '<section class="help" id="help-' + id + '"><h3>' + esc(title) + "</h3>" + body + "</section>";
    const lightRows = ["green", "yellow", "red", "none"].map(lightLine).join("");
    const cats = CATS.map(([k, m]) => "<tr><td><b>" + esc(t("m_" + m)) + "</b>" + (x ? '<span class="src">' + Math.round(100 * c.cw[k]) + " %</span>" : "") +
      "</td><td>" + esc(g.cats[k].s) + (x ? '<span class="src">' + esc(g.cats[k].x) + "</span>" : "") + "</td></tr>").join("");
    const checks = CATS.map(([k, m]) => '<tr class="grp"><td colspan="' + (x ? 3 : 2) + '">' + esc(t("m_" + m)) + "</td></tr>" +
      CAT_CHECKS[k].map((cid) => "<tr><td><b>" + esc(t(cid)) + "</b>" + (x ? '<span class="src">' + esc(cid) + "</span>" : "") + "</td><td>" +
        esc(fill(g.checks[cid].s)) + (x ? '<span class="xp">' + esc(fill(g.checks[cid].x)) + '</span><span class="src">' + esc(t("source_col")) + ": " + src(cid) + "</span>" : "") +
        "</td>" + (x ? '<td class="num">' + (c.w[cid] ?? 1) + "</td>" : "") + "</tr>").join("")).join("");
    const html = '<button class="close" data-close aria-label="' + esc(t("close")) + '">✕</button><h2>' + esc(t("help_title")) + "</h2>" +
      '<p class="sub">' + esc(t("view_hint")) + "</p>" +
      '<nav class="toc">' + [["what", "sec_what"], ["lights", "sec_lights"], ["cats", "sec_cats"], ["checks", "sec_checks"], ["mail", "sec_mail"], ["crit", "sec_crit"], ["data", "sec_data"], ["limits", "sec_limits"]]
        .map(([id, k]) => '<button class="linkbtn" data-help="' + id + '">' + esc(t(k)) + "</button>").join(" · ") + "</nav>" +
      sec("what", t("sec_what"), para(g.sections.what[x ? "x" : "s"])) +
      sec("lights", t("sec_lights"), lightRows + '<p class="sub">' + esc(g.lights.simple.note) + "</p>" + (x ? '<div class="xbox">' + para(g.lights.expert) + "</div>" : "") +
        '<p class="src">' + esc(t("click_light")) + "</p>") +
      sec("cats", t("sec_cats"), "<table><tbody>" + cats + "</tbody></table>") +
      sec("checks", t("sec_checks"), "<table><thead><tr><th>" + esc(t("check_col")) + "</th><th>" + esc(x ? t("how_measured") : t("why")) + "</th>" +
        (x ? '<th class="num">' + esc(t("weight")) + "</th>" : "") + "</tr></thead><tbody>" + checks + "</tbody></table>") +
      sec("mail", t("sec_mail"), para(g.sections.mail[x ? "x" : "s"]) + "<table><thead><tr><th>" + esc(t("check_col")) + "</th><th>" + esc(x ? t("how_measured") : t("why")) +
        "</th></tr></thead><tbody>" + MAIL_CHECKS.map((cid) => "<tr><td><b>" + esc(t(cid)) + "</b></td><td>" + esc(fill(g.checks[cid].s)) +
        (x ? '<span class="xp">' + esc(fill(g.checks[cid].x)) + "</span>" : "") + "</td></tr>").join("") + "</tbody></table>") +
      sec("crit", t("sec_crit"), para(g.sections.crit[x ? "x" : "s"]) + '<p class="src"><a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></p>") +
      sec("data", t("sec_data"), para(g.sections.data[x ? "x" : "s"]) + '<p class="src"><a href="https://github.com/Accelerate-GmbH/cert_landscape_CH/tree/main/output/latest">' +
        esc(t("data_link")) + "</a></p>") +
      sec("limits", t("sec_limits"), para(g.sections.limits[x ? "x" : "s"])) +
      '<p class="src"><a href="' + DOCS + 'docs/RATING.md">' + esc(t("help_more")) + "</a> · <a href=\"" + DOCS + 'METHOD.md">' + esc(t("method")) + "</a></p>";
    const panel = document.getElementById("panel");
    panel.innerHTML = html;
    state.help = section || "what";
    const target = document.getElementById("help-" + state.help);
    if (target && section && section !== "what") target.scrollIntoView({ block: "start" }); else panel.scrollTop = 0;
  }

  function overviewSectors() {
    document.getElementById("panel").innerHTML = "<h2>" + esc(t("matrix_title")) + '</h2><p class="sub">' + (simple() ? esc(t("sector_intro_simple")) + " " : "") + esc(t("matrix_note")) + "</p><p class=\"sub\">" +
      (aggHidden() ? esc(t("agg_only")) : "") + '</p><p class="src"><a href="' + LIST_DOC + '">' + esc(t("list_source")) + "</a></p>";
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
      case "own.sectxt": return [ext("https://" + (dom || h) + "/.well-known/security.txt", "security.txt")];
      case "sov.registrar": return [ext((dom || h).endsWith(".ch") ? "https://rdap.nic.ch/domain/" + enc(dom || h) : "https://client.rdap.org/?type=domain&object=" + enc(dom || h), "RDAP")];
      case "sec.hsts": return [ext("https://hstspreload.org/?domain=" + enc(h), "hstspreload.org"), labsLink(h)];
      default: return [];
    }
  }
  function loadResources(level, id) {
    const key = level + "-" + id;
    if (cache[key]) return Promise.resolve(cache[key]);
    return fetch("data/resources/" + key + ".json?v=" + BUILD).then((r) => (r.ok ? r.json() : [])).then((d) => (cache[key] = d));
  }
  function resourceList(level, id) {
    const e = state.data.entities[level][id];
    const panel = document.getElementById("panel");
    panel.innerHTML = '<p class="muted">' + esc(t("loading")) + "</p>";
    loadResources(level, id).then((list) => {
      const rows = list.map((r, i) => '<tr class="click" data-rdetail="' + level + ":" + id + ":" + i + '"><td>' + esc(r.h) +
        (r.crit ? ' <span class="chip">' + esc(t("crit_tag")) + "</span>" : "") + (r.ko ? ' <span class="chip">K.-o.</span>' : "") + (r.ur ? urTag() : "") +
        '</td><td class="num">' + fmt(r.o) + "</td><td>" + chip(lightOf(r.o), " ") + "</td></tr>").join("");
      panel.innerHTML = '<button class="close" data-sel="' + level + ":" + id + '">← ' + esc(t("back")) + "</button>" +
        "<h2>" + esc(e.n) + '</h2><p class="sub">' + esc(t("res_title")) + ": " + list.length + "</p>" +
        '<table><thead><tr><th>Hostname</th><th class="num">TP</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>";
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
        '<td class="ev">' + esc(chkVal(cid, val)) + (ev ? '<span class="src">' + esc(ev) + "</span>" : "") +
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
      (r.ur ? '<p class="note"><b>' + esc(t("ur_tag")) + ".</b> " + esc(t("ur_note")) + "</p>" : "") +
      '<div class="tmhead"><span class="v">' + fmt(r.o) + "</span>" + chip(lightOf(r.o), null, ["r", level, id, idx, "overall"].join("|")) + "</div>" +
      [["ownership", "tm_own"], ["sovereignty", "tm_sov"], ["security", "tm_sec"], ["privacy", "tm_prv"]].map(([k, m]) => {
        const v = r.c ? r.c[k] : null;
        return '<div class="cat"><span>' + esc(t("m_" + m)) + '</span><span class="num">' + fmt(v) + "</span>" +
          chip(lightOf(v), null, v === null || v === undefined ? null : ["r", level, id, idx, "cat", k].join("|")) + "</div>";
      }).join("") +
      "<h3>" + esc(t("checks")) + '</h3><table class="checks-t"><thead><tr><th>' + esc(t("check_col")) + "</th><th>" + esc(t("value_col")) +
      "</th><th>" + esc(t("verify_at")) + "</th></tr></thead><tbody>" + chk + "</tbody></table>" +
      "<h3>" + esc(t("cert")) + '</h3><p class="sub">' + esc(c.val) + " · " + esc(c.org) + " · " + esc(c.iss) + " · " + esc((c.exp || "").slice(0, 10)) +
      "<br>Root: " + esc(r.root.name) + " (" + esc(r.root.owner) + ", " + esc(r.root.cc) + ") · " + ctLink(c) + " · " + labsLink(r.h) + "</p>" +
      "<h3>" + esc(t("endpoints")) + "</h3><table><thead><tr><th>" + esc(t("ip_col")) + "</th><th>TLS</th><th>" + esc(t("cert")) +
      "</th><th>" + esc(t("net_col")) + "</th></tr></thead><tbody>" + eps + "</tbody></table>";
  }

  /* Units without a value, by reason (including areas missing from the run). */
  function whyCounts(lvl) {
    const ents = state.data.entities[lvl] || {};
    const cnt = {};
    Object.values(ents).forEach((e) => { const w = whyOf(lvl, e); if (w) cnt[w] = (cnt[w] || 0) + 1; });
    const obj = lvl === "canton" ? state.topo.objects.cantons : state.topo.objects.municipalities;
    obj.geometries.forEach((g) => { if (!ents[String(g.id)]) { const w = whyOf(lvl, null); cnt[w] = (cnt[w] || 0) + 1; } });
    const keys = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    if (!keys.length) return "";
    return '<p class="sub"><b>' + esc(t("without_value")) + ":</b></p><ul class=\"plainlist\">" + keys.map((k) => '<li title="' + esc(t("why_" + k)) + '">' + cnt[k] + " · " +
      esc(t("whys_" + k)) + "</li>").join("") + "</ul>";
  }

  function simpleOverview() {
    const lvl = state.level;
    const ents = Object.entries(state.data.entities[lvl] || {});
    const cnt = { green: 0, yellow: 0, red: 0, none: 0 };
    ents.forEach(([, e]) => { cnt[lightOf(value(e, "tm"))]++; });
    const bar = '<div class="bar">' + ["green", "yellow", "red", "none"].filter((k) => cnt[k]).map((k) =>
      '<span title="' + esc(t("verdict_" + k)) + " " + cnt[k] + '" style="width:' + (100 * cnt[k] / (ents.length || 1)) + "%;background:" +
      (k === "none" ? css("--nodata") : css(LIGHT_COLORS[k])) + '"></span>').join("") + '</div><div class="keyrow">' +
      ["green", "yellow", "red", "none"].filter((k) => cnt[k]).map((k) => '<span><i style="background:' + (k === "none" ? css("--nodata") : css(LIGHT_COLORS[k])) +
        '"></i>' + esc(t("verdict_" + k)) + " " + cnt[k] + "</span>").join("") + "</div>";
    const rank = lvl === "canton" ? ents.filter(([, e]) => value(e, "tm") !== null).sort((a, b) => value(b[1], "tm") - value(a[1], "tm"))
      .map(([id, e]) => '<tr class="click" data-sel="canton:' + id + '"><td>' + esc(e.n) + '</td><td class="num">' + value(e, "tm") + "</td><td>" +
        chip(lightOf(value(e, "tm")), t("verdict_" + lightOf(value(e, "tm")))) + "</td></tr>").join("") : "";
    document.getElementById("panel").innerHTML = "<h2>" + esc(t("overview")) + '</h2><p class="sub">' + esc(t("intro_simple")) + "</p>" +
      "<h3>" + esc(t("sec_lights")) + "</h3>" + ["green", "yellow", "red", "none"].map(lightLine).join("") +
      '<p class="sub">' + esc(G().lights.simple.note) + "</p>" +
      "<h3>" + esc(t("units_by_light").replace("{units}", t(lvl === "canton" ? "level_canton" : "level_municipality"))) + "</h3>" + bar + whyCounts(lvl) +
      (rank ? "<h3>" + esc(t("ranking")) + "</h3><table><tbody>" + rank + "</tbody></table>" : "") +
      '<p><button class="linkbtn" data-help="what">' + esc(t("to_help")) + " →</button></p>";
  }

  function overview() {
    if (state.level === "sector") { overviewSectors(); return; }
    if (state.level === "federal") { overviewFederal(); return; }
    if (state.level === "hosts") { overviewHosts(); return; }
    if (simple()) { simpleOverview(); return; }
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
      '<p class="sub">' + esc(t("total_hosts")) + ": <b>" + hosts + "</b></p>" + zoneBar(zsum) + whyCounts(lvlForStats) +
      (cantons.length ? "<h3>" + esc(t("ranking")) + "</h3><table><thead><tr>" + th("n", t("rank_name")) + th("tm", "TP", 1) + th("s", t("s_short"), 1) +
        th("a", t("a_short"), 1) + th("h", t("h_short"), 1) + "</tr></thead><tbody>" + rows + "</tbody></table>" : "");
  }

  function select(level, id) {
    state.help = null;
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
      applyI18n(); draw(); if (state.help) helpPanel(state.help); else refreshPanel(); if (state.data) fillSectors(); return; }
    const vw = ev.target.closest("[data-view]");
    if (vw) { state.view = vw.dataset.view; try { localStorage.setItem("view", state.view); } catch (e) { /* ignore */ }
      try { const u = new URL(location.href); u.searchParams.set("view", state.view); history.replaceState(null, "", u); } catch (e) { /* ignore */ }
      applyI18n(); draw(); if (state.help) helpPanel(state.help); else refreshPanel(); return; }
    const hs = ev.target.closest("[data-hsort]");
    if (hs) { const k = hs.dataset.hsort; HL.sort = { k, dir: HL.sort.k === k ? -HL.sort.dir : (k === "h" || k === "owner" || k === "type" ? 1 : 1) }; HL.page = 0; renderHostsTable(); return; }
    const hp2 = ev.target.closest("[data-hpage]");
    if (hp2) { HL.page += Number(hp2.dataset.hpage); renderHostsTable(); document.getElementById("hoststable").scrollIntoView({ block: "start" }); return; }
    const hr = ev.target.closest("[data-hostrow]");
    if (hr) { const [key, host] = hr.dataset.hostrow.split("|"); const [l, ...rest] = key.split(":"); openHost(l, rest.join(":"), host, true); return; }
    const ml = ev.target.closest("[data-mail]");
    if (ml) { const [l, ...rest] = ml.dataset.mail.split(":"); mailDetail(l, rest.join(":")); return; }
    const oh = ev.target.closest("[data-orghost]");
    if (oh) { const [oid, host] = oh.dataset.orghost.split("|"); openHost("organisation", oid, host, true); return; }
    const ft = ev.target.closest("[data-fedtoggle]");
    if (ft) { state.fedOpen = !state.fedOpen; drawFederal(); return; }
    const hp = ev.target.closest("[data-help]");
    if (hp) { helpPanel(hp.dataset.help); return; }
    const lvl = ev.target.closest("[data-level]");
    if (lvl) { state.level = lvl.dataset.level; state.selected = null; applyI18n(); draw(); refreshPanel(); fillSearch();
      try { const u = new URL(location.href); u.searchParams.set("level", state.level); u.searchParams.delete("sel"); history.replaceState(null, "", u); } catch (e) { /* ignore */ }
      return; }
    const exb = ev.target.closest("[data-explain]");
    if (exb && exb.dataset.explain) { explain(exb.dataset.explain); return; }
    if (ev.target.closest("[data-close]")) { select(null, null); return; }
    const res = ev.target.closest("[data-res]");
    if (res) { const [l, i] = res.dataset.res.split(":"); resourceList(l, i); return; }
    const rd = ev.target.closest("[data-rdetail]");
    if (rd) { const [l, i, k] = rd.dataset.rdetail.split(":"); resourceDetail(l, i, Number(k)); return; }
    const sel = ev.target.closest("[data-sel]");
    if (sel) { const [l, i] = sel.dataset.sel.split(":"); select(l, i); return; }
    const db = ev.target.closest("[data-dim]");
    if (db) { state.dim = db.dataset.dim; renderMatrix(); return; }
    const sr = ev.target.closest("[data-sector]");
    if (sr) { sectorPanel(sr.dataset.sector); return; }
    const srt = ev.target.closest("[data-sort]");
    if (srt) { const k = srt.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "n" ? 1 : -1) }; overview(); }
  });
  document.getElementById("metric").addEventListener("change", (ev) => { state.metric = ev.target.value; draw(); });
  document.getElementById("showorgs").addEventListener("change", () => { drawOrgs(); legend(); });
  document.getElementById("orgmode").addEventListener("change", (ev) => { state.orgMode = ev.target.value; drawOrgs(); legend(); });
  document.getElementById("sectorfilter").addEventListener("change", drawOrgs);
  map.on("zoomend", drawOrgs);
  function fillSectors() {
    const sel = document.getElementById("sectorfilter");
    const secs = new Set(Object.keys(state.data.sectors || {}).filter((k) => !k.startsWith("@")));
    Object.values(state.data.entities.organisation || {}).forEach((o) => o.sec && secs.add(o.sec));
    const cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(t("all_sectors")) + "</option>" + [...secs].sort().map((k) => '<option value="' + esc(k) + '">' + esc(trSKI(k)) + "</option>").join("");
    sel.value = cur;
    const hasOrgs = Object.keys(state.data.entities.organisation || {}).length > 0;
    document.getElementById("orgtoggle").hidden = !hasOrgs;
    sel.hidden = !hasOrgs && !secs.size;
  }
  const search = document.getElementById("search");
  const sugBox = document.getElementById("suggest");
  let sugItems = [], sugPos = -1;
  function fillSearch() { /* suggestions are built while typing */ }
  function renderSuggest() {
    if (!search.value.trim() || search.value.trim().length < 2) { sugBox.hidden = true; search.setAttribute("aria-expanded", "false"); return; }
    sugBox.innerHTML = sugItems.length ? sugItems.map((x, i) => '<li role="option" id="sug-' + i + '" data-sug="' + i + '"' + (i === sugPos ? ' aria-selected="true"' : "") +
      '><span class="sl">' + esc(x.label) + '</span><span class="ss">' + esc(x.sub) + "</span></li>").join("") :
      '<li class="none">' + esc(hostIndex ? t("no_match") : t("searching")) + "</li>";
    sugBox.hidden = false; search.setAttribute("aria-expanded", "true");
    if (sugPos >= 0) search.setAttribute("aria-activedescendant", "sug-" + sugPos); else search.removeAttribute("aria-activedescendant");
  }
  function updateSuggest() {
    sugItems = suggestions(search.value); sugPos = -1; renderSuggest();
    if (!hostIndex) loadHostIndex().then(() => { if (document.activeElement === search) { sugItems = suggestions(search.value); renderSuggest(); } });
  }
  /* Open the check results of one host; from the sector view the back button returns there. */
  function openHost(lvl, id, host, keepView, code) {
    if (!keepView) select(lvl, id);
    const unrated = () => {
      const h2 = document.querySelector("#panel h2");
      if (h2) h2.insertAdjacentHTML("afterend", '<div class="why"><b>' + esc(host) + "</b><p><b>" + esc(t("host_not_rated")) + ".</b> " +
        esc(t("hostwhy_" + (code || "nr"))) + "</p></div>");
    };
    if (code) { unrated(); return; }
    loadResources(lvl, id).then((list) => { const i = (list || []).findIndex((r) => r.h === host); if (i >= 0) resourceDetail(lvl, id, i); else unrated(); });
  }
  function goTo(x) {
    sugBox.hidden = true; search.value = x.label; search.blur();
    const { lvl, id } = x;
    if (lvl === "organisation") {
      const o = state.data.entities.organisation[id];
      if (isTable()) { state.level = "canton"; applyI18n(); draw(); }
      select("organisation", id);
      const c = (o.bfs && centers.municipality[o.bfs]) || centers.canton[String(CANTON_CODES.indexOf(o.kt) + 1)];
      if (c) map.setView(c, 11);
      if (x.kind === "host") openHost("organisation", id, x.label, true, x.code);
      return;
    }
    if (lvl === "federal") {
      if (state.level !== "federal") { state.level = "federal"; applyI18n(); draw(); }
    } else {
      if (state.level !== lvl) { state.level = lvl; applyI18n(); draw(); }
      state.layer.eachLayer((l) => { if (String(l.feature.id) === id) map.fitBounds(l.getBounds(), { maxZoom: 11 }); });
    }
    select(lvl, id);
    if (x.kind === "host") openHost(lvl, id, x.label, true, x.code);
  }
  search.addEventListener("input", updateSuggest);
  search.addEventListener("focus", () => { loadHostIndex(); if (search.value.trim().length >= 2) updateSuggest(); });
  search.addEventListener("keydown", (ev) => {
    if (sugBox.hidden && ev.key !== "Enter") return;
    if (ev.key === "ArrowDown") { sugPos = Math.min(sugPos + 1, sugItems.length - 1); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === "ArrowUp") { sugPos = Math.max(sugPos - 1, -1); renderSuggest(); ev.preventDefault(); }
    else if (ev.key === "Enter") { const x = sugItems[sugPos >= 0 ? sugPos : 0]; if (x) { goTo(x); ev.preventDefault(); } }
    else if (ev.key === "Escape") { sugBox.hidden = true; }
  });
  sugBox.addEventListener("mousedown", (ev) => { const li = ev.target.closest("[data-sug]"); if (li) { ev.preventDefault(); goTo(sugItems[+li.dataset.sug]); } });
  search.addEventListener("blur", () => setTimeout(() => { sugBox.hidden = true; }, 150));

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
      if (params.get("level") === "federal" || (sel && sel.startsWith("federal:"))) state.level = "federal";
      if (params.get("level") === "sector") state.level = "sector";
      if (params.get("level") === "hosts") state.level = "hosts";
      computeCenters(); fillSectors();
      applyI18n(); draw(); fillSearch();
      if (sel) { const [l, i] = sel.split(":"); select(l, i); } else overview();
    })
    .catch((err) => {
      document.getElementById("panel").innerHTML = '<p class="note">Map data could not be loaded: ' + esc(err.message) + "</p>";
    });
})();

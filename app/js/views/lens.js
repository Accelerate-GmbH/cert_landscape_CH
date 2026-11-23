// «Karte als Linse»: one series (overall, a category or a building block) on the
// map of Switzerland, per municipality or per canton, in the colours of the
// traffic light. Boundaries come from map-ch.json, built from swiss-maps when the
// site is built (tools/build_map.mjs); values from scores.json.
import * as data from "../data.js";
import { t, LAYERS, LEVELS as ALL_LEVELS } from "../text.js";
import { esc, fmt, light } from "../ui.js";
import { seriesName } from "./compare.js";

// the levels with a map: municipalities and cantons, named in the current language
const mapLevels = () => ALL_LEVELS.filter(([k]) => k === "municipality" || k === "canton");
let mapCache = null;
export const loadMap = () => (mapCache ||= fetch(`map-ch.json?v=${window.BUILD || ""}`).then((r) => {
  if (!r.ok) throw new Error(`map-ch.json: ${r.status}`);
  return r.json();
}));

export async function render(el, params) {
  const [sc, meta, ix] = await Promise.all([data.scores(), data.meta(), data.index()]);
  let map;
  try {
    map = await loadMap();
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("map_title"))}</h1><p>${esc(t("map_missing"))}</p></section>`;
    return;
  }
  const series = sc.series.includes(params.key) ? params.key : "overall";
  const level = mapLevels().some(([k]) => k === params.level) ? params.level : "municipality";
  const si = sc.series.indexOf(series), cfg = meta.cfg;
  const names = Object.fromEntries(ix.rows.map((r) => [r[0], r[1]]));
  const shapes = level === "canton" ? map.cantons : map.municipalities;
  const count = { green: 0, yellow: 0, red: 0, none: 0 };
  const paths = Object.entries(shapes).map(([id, d]) => {
    const key = `${level}:${id}`;
    const v = (sc.rows[key] || [])[si] ?? null;
    const l = sc.rows[key] ? light(v, cfg) : "none";
    count[l] += 1;
    const label = `${names[key] || id}: ${v === null ? t("no_value") : fmt(v)}`;
    return `<a href="#/org/${encodeURIComponent(key)}" aria-label="${esc(label)}"><path class="ar ${l}" d="${d}"><title>${esc(label)}</title></path></a>`;
  }).join("");
  const borders = level === "municipality" ? Object.values(map.cantons).map((d) => `<path class="cb" d="${d}"/>`).join("") : "";
  const lakes = map.lakes.map((d) => `<path class="lk" d="${d}"/>`).join("");
  const group = (s) => (s.startsWith("blk:") ? s.slice(4).split(".")[0] : "total");
  const opts = [...new Set(sc.series.map(group))].map((g) => `<optgroup label="${esc(g === "total" ? t("total_and_areas") : (LAYERS[g] || {}).name || g)}">${sc.series
    .filter((s) => group(s) === g).map((s) => `<option value="${esc(s)}"${s === series ? " selected" : ""}>${esc(seriesName(s))}</option>`).join("")}</optgroup>`).join("");
  el.innerHTML = `<section class="lead"><h1>${esc(t("map_title"))}: ${esc(seriesName(series))}</h1>
      <div class="tabs">${mapLevels().map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="#/karte/${encodeURIComponent(series)}?level=${k}">${esc(nm)}</a>`).join("")}</div>
      <div class="filters"><label>${esc(t("show"))} <select data-f="key">${opts}</select></label>
        <span class="legend"><span class="sw green"></span>${esc(t("lg_green", { g: cfg.green }))}: ${count.green}
        <span class="sw yellow"></span>${esc(t("lg_yellow", { y: cfg.yellow, g: cfg.green }))}: ${count.yellow}
        <span class="sw red"></span>${esc(t("lg_red", { y: cfg.yellow }))}: ${count.red}
        <span class="sw none"></span>${esc(t("no_value"))}: ${count.none}</span></div></section>
    <svg class="chmap" viewBox="${map.viewBox}" aria-label="${esc(t("map_aria", { s: seriesName(series) }))}">${paths}${borders}${lakes}</svg>
    <p class="muted small">${esc(t("map_note"))} ${esc(map.source)}.</p>`;
  el.querySelector("[data-f=key]").addEventListener("change", (ev) => {
    location.hash = `#/karte/${encodeURIComponent(ev.target.value)}?level=${level}`;
  });
}

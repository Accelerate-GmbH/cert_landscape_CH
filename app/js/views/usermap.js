// Map of the users of a service or provider (docs/PRODUCT.md, section 8.1):
// cantons and municipalities as areas, education and critical services as
// points per canton with their number (as the organisations on the current
// map), the Confederation and its offices as a list. The map shows use, not
// the users' value: colour means «use detected». Not detected is not the same
// as not used; only what shows in DNS, certificates, redirects or a register
// is detected.
import { t, LEVEL_MANY } from "../text.js";
import { esc } from "../ui.js";
import { loadMap } from "./lens.js";

const POINTS = ["organisation", "education"];

// centre of a canton: mean of the vertices of its outline
function centre(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  let x = 0, y = 0;
  for (let i = 0; i + 1 < n.length; i += 2) { x += n[i]; y += n[i + 1]; }
  const k = Math.max(1, Math.floor(n.length / 2));
  return [x / k, y / k];
}

// keys: entity keys that use the service; ix: index.json rows
export async function usersMap(keys, ix) {
  const set = new Set(keys);
  const row = Object.fromEntries(ix.rows.map((r) => [r[0], r]));
  const by = (lv) => [...set].filter((k) => k.startsWith(lv + ":") && row[k]).sort((a, b) => row[a][1].localeCompare(row[b][1]));
  const ctId = Object.fromEntries(ix.rows.filter((r) => r[0].startsWith("canton:")).map((r) => [r[2], r[0].split(":")[1]]));
  let map = null;
  try { map = await loadMap(); } catch { /* map file missing: lists only */ }
  const link = (k) => `<a href="#/org/${encodeURIComponent(k)}">${esc(row[k][1])}</a>`;
  const list = (lv) => { const ks = by(lv); return ks.length ? `<h4>${esc(LEVEL_MANY[lv])} · ${ks.length}</h4><ul class="ents">${ks.map((k) => `<li>${link(k)}</li>`).join("")}</ul>` : ""; };
  // points: organisations and education grouped by canton
  const groups = {};
  POINTS.forEach((lv) => by(lv).forEach((k) => { const c = row[k][2] || "–"; (groups[c] ||= []).push(k); }));
  const cantons = new Set(by("canton").map((k) => k.split(":")[1]));
  const munis = new Set(by("municipality").map((k) => k.split(":")[1]));
  let svg = "";
  if (map) {
    const ct = Object.entries(map.cantons).map(([id, d]) => `<a href="#/org/canton:${id}" aria-label="${esc((row["canton:" + id] || [])[1] || id)}"><path class="ar${cantons.has(id) ? " use-ct" : ""}" d="${d}"><title>${esc((row["canton:" + id] || [])[1] || id)}</title></path></a>`).join("");
    const mu = [...munis].filter((id) => map.municipalities[id]).map((id) => `<a href="#/org/municipality:${id}" aria-label="${esc(row["municipality:" + id][1])}"><path class="ar use-mu" d="${map.municipalities[id]}"><title>${esc(row["municipality:" + id][1])}</title></path></a>`).join("");
    const borders = Object.values(map.cantons).map((d) => `<path class="cb" d="${d}"/>`).join("");
    const lakes = map.lakes.map((d) => `<path class="lk" d="${d}"/>`).join("");
    const pts = Object.entries(groups).filter(([c]) => ctId[c] && map.cantons[ctId[c]]).map(([c, ks]) => {
      const [x, y] = centre(map.cantons[ctId[c]]), r = 7 + 3 * Math.sqrt(ks.length);
      return `<a href="#um-${esc(c)}" data-um="${esc(c)}" aria-label="${esc(t("um_point", { n: ks.length, c }))}"><g class="um-pt"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}"/>
        <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" text-anchor="middle">${ks.length}</text><title>${esc(t("um_point", { n: ks.length, c }))}</title></g></a>`;
    }).join("");
    svg = `<svg class="chmap umap" viewBox="${map.viewBox}" aria-label="${esc(t("um_aria"))}">${ct}${mu}${borders}${lakes}${pts}</svg>`;
  }
  const pointList = Object.keys(groups).sort().map((c) => `<details id="um-${esc(c)}"><summary><b>${esc(c)}</b> · ${groups[c].length}</summary>
    <ul class="ents">${groups[c].map((k) => `<li>${link(k)} <span class="muted small">${esc(LEVEL_MANY[k.split(":")[0]])}</span></li>`).join("")}</ul></details>`).join("");
  const counts = [["canton", cantons.size], ["municipality", munis.size], ...POINTS.map((lv) => [lv, by(lv).length])].filter(([, n]) => n);
  const html = `<div data-users-map>
    <p class="legend"><span><span class="sw um-ct"></span>${esc(t("um_canton"))}</span><span><span class="sw um-mu"></span>${esc(t("um_muni"))}</span>
      <span><span class="sw um-pt"></span>${esc(t("um_points"))}</span></p>
    ${svg}
    <p class="muted small">${esc(t("um_note"))}${counts.length ? " " + counts.map(([lv, n]) => `${esc(LEVEL_MANY[lv])} ${n}`).join(" · ") : ""}</p>
    ${list("federal")}${list("office")}
    ${pointList ? `<h4>${esc(t("um_points_list"))}</h4>${pointList}` : ""}</div>`;
  const bind = (el) => el.querySelectorAll("[data-um]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const d = el.querySelector(`#um-${CSS.escape(a.dataset.um)}`);
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }));
  return { html, bind };
}

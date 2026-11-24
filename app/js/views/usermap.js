// Map of the users of a service or provider (docs/PRODUCT.md, section 8.1):
// cantons and municipalities as areas, education and critical services as
// points with their number at their seat municipality from the UID register
// (places.json), at the centre of their canton where the seat is unknown (as
// the organisations on the current map), the Confederation and its offices as a list. The map shows use, not
// the users' value: colour means «use detected». Not detected is not the same
// as not used; only what shows in DNS, certificates, redirects or a register
// is detected.
import { t, LEVEL_MANY } from "../text.js";
import { esc } from "../ui.js";
import { loadMap } from "./lens.js";
import * as data from "../data.js";

const POINTS = ["organisation", "education"];

// centre of a canton: mean of the vertices of its outline
function centre(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  let x = 0, y = 0;
  for (let i = 0; i + 1 < n.length; i += 2) { x += n[i]; y += n[i + 1]; }
  const k = Math.max(1, Math.floor(n.length / 2));
  return [x / k, y / k];
}

// keys: entity keys that use the service; ix: index.json rows; extra: further
// points that are not measured entities (participants of a register with a seat:
// {name, href, bfs, canton}) and entries without a place ({name, href})
export async function usersMap(keys, ix, extra = {}) {
  const set = new Set(keys);
  const row = Object.fromEntries(ix.rows.map((r) => [r[0], r]));
  const xs = (extra.points || []).map((p, i) => ["x:" + i, p]);
  xs.forEach(([k, p]) => { set.add(k); row[k] = [k, p.name, p.canton, null, null, null, p.href]; });
  const by = (lv) => [...set].filter((k) => k.startsWith(lv + ":") && row[k]).sort((a, b) => row[a][1].localeCompare(row[b][1]));
  const ctId = Object.fromEntries(ix.rows.filter((r) => r[0].startsWith("canton:")).map((r) => [r[2], r[0].split(":")[1]]));
  let map = null;
  try { map = await loadMap(); } catch { /* map file missing: lists only */ }
  const seat = { ...(await data.places()), ...Object.fromEntries(xs.map(([k, p]) => [k, p.bfs])) };
  const many = (lv) => (lv === "x" ? t("um_registered") : LEVEL_MANY[lv]);
  const link = (k) => (k.startsWith("x:") ? (row[k][6] ? `<a href="${esc(row[k][6])}">${esc(row[k][1])}</a>` : esc(row[k][1]))
    : `<a href="#/org/${encodeURIComponent(k)}">${esc(row[k][1])}</a>`);
  const list = (lv) => { const ks = by(lv); return ks.length ? `<h4>${esc(LEVEL_MANY[lv])} · ${ks.length}</h4><ul class="ents">${ks.map((k) => `<li>${link(k)}</li>`).join("")}</ul>` : ""; };
  // points: organisations and education grouped by canton
  const groups = {};
  [...POINTS, "x"].forEach((lv) => by(lv).forEach((k) => { const c = row[k][2] || "–"; (groups[c] ||= []).push(k); }));
  const cantons = new Set(by("canton").map((k) => k.split(":")[1]));
  const lawCt = new Set((extra.law || []).filter((k) => k.startsWith("canton:")).map((k) => k.split(":")[1]));
  const munis = new Set(by("municipality").map((k) => k.split(":")[1]));
  let svg = "";
  if (map) {
    const ct = Object.entries(map.cantons).map(([id, d]) => `<a href="#/org/canton:${id}" aria-label="${esc((row["canton:" + id] || [])[1] || id)}"><path class="ar${cantons.has(id) ? " use-ct" : lawCt.has(id) ? " law-ct" : ""}" d="${d}"><title>${esc((row["canton:" + id] || [])[1] || id)}</title></path></a>`).join("");
    const mu = [...munis].filter((id) => map.municipalities[id]).map((id) => `<a href="#/org/municipality:${id}" aria-label="${esc(row["municipality:" + id][1])}"><path class="ar use-mu" d="${map.municipalities[id]}"><title>${esc(row["municipality:" + id][1])}</title></path></a>`).join("");
    const borders = Object.values(map.cantons).map((d) => `<path class="cb" d="${d}"/>`).join("");
    const lakes = map.lakes.map((d) => `<path class="lk" d="${d}"/>`).join("");
    // one point per seat municipality; per canton where the seat is unknown
    const at = {};
    Object.entries(groups).forEach(([c, ks]) => ks.forEach((k) => {
      const m = seat[k] && map.municipalities[seat[k]] ? seat[k] : null;
      const g = m ? "m" + m : "c" + c;
      (at[g] ||= { c, m, ks: [] }).ks.push(k);
    }));
    // points that would overlap are merged into one, at their weighted centre (as the current map does when zoomed out)
    const rad = (n) => 5 + 2.5 * Math.sqrt(n);
    const placed = [];
    Object.values(at).filter((g) => g.m || (ctId[g.c] && map.cantons[ctId[g.c]])).sort((a, b) => b.ks.length - a.ks.length).forEach((g) => {
      const [x, y] = centre(g.m ? map.municipalities[g.m] : map.cantons[ctId[g.c]]);
      const place = g.m ? (row["municipality:" + g.m] || [])[1] || g.c : g.c;
      const hit = placed.find((p) => Math.hypot(p.x - x, p.y - y) < rad(p.ks.length) + rad(g.ks.length) + 1);
      if (!hit) return placed.push({ x, y, c: g.c, ks: [...g.ks], places: [place] });
      const n = hit.ks.length, m = g.ks.length;
      hit.x = (hit.x * n + x * m) / (n + m); hit.y = (hit.y * n + y * m) / (n + m);
      hit.ks.push(...g.ks); hit.places.push(place);
    });
    const pts = placed.map((p) => {
      const r = rad(p.ks.length), x = p.x.toFixed(1), y = p.y.toFixed(1);
      const label = t("um_point", { n: p.ks.length, c: p.places.slice(0, 4).join(", ") + (p.places.length > 4 ? " …" : "") });
      return `<a href="#um-${esc(p.c)}" data-um="${esc(p.c)}" aria-label="${esc(label)}"><g class="um-pt"><circle cx="${x}" cy="${y}" r="${r.toFixed(1)}"/>
        ${p.ks.length > 1 ? `<text x="${x}" y="${y}" dy="0.35em" text-anchor="middle">${p.ks.length}</text>` : ""}<title>${esc(label)}</title></g></a>`;
    }).join("");
    svg = `<svg class="chmap umap" viewBox="${map.viewBox}" aria-label="${esc(t("um_aria"))}"><defs><pattern id="um-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="um-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="um-hatch-ln"/></pattern></defs>${ct}${mu}${borders}${lakes}${pts}</svg>`;
  }
  const pointList = Object.keys(groups).sort().map((c) => `<details id="um-${esc(c)}"><summary><b>${esc(c)}</b> · ${groups[c].length}</summary>
    <ul class="ents">${groups[c].map((k) => `<li>${link(k)} <span class="muted small">${esc(many(k.split(":")[0]))}</span></li>`).join("")}</ul></details>`).join("");
  const counts = [["canton", cantons.size], ["municipality", munis.size], ...[...POINTS, "x"].map((lv) => [lv, by(lv).length])].filter(([, n]) => n);
  const html = `<div data-users-map>
    <p class="legend"><span><span class="sw um-ct"></span>${esc(t("um_canton"))}</span><span><span class="sw um-mu"></span>${esc(t("um_muni"))}</span>
      ${lawCt.size ? `<span><span class="sw um-law"></span>${esc(t("um_law"))}</span>` : ""}
      <span><span class="sw um-pt"></span>${esc(t(xs.length ? "um_points_reg" : "um_points"))}</span></p>
    ${set.size || lawCt.size ? svg : `<p class="empty-map"><span class="badge wait">${esc(t("um_none"))}</span> ${esc(t("um_none_d"))}</p>`}
    <p class="muted small">${esc(t("um_note"))}${counts.length ? " " + counts.map(([lv, n]) => `${esc(many(lv))} ${n}`).join(" · ") : ""}</p>
    ${list("federal")}${list("office")}
    ${pointList ? `<h4>${esc(t(xs.length ? "um_points_list_reg" : "um_points_list"))}</h4>${pointList}` : ""}
    ${(extra.unplaced || []).length ? `<h4>${esc(t("um_unplaced"))} · ${extra.unplaced.length}</h4><ul class="ents">${extra.unplaced.map((u) =>
      `<li>${u.href ? `<a href="${esc(u.href)}">${esc(u.name)}</a>` : esc(u.name)}</li>`).join("")}</ul>` : ""}</div>`;
  const bind = (el) => el.querySelectorAll("[data-um]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    const d = el.querySelector(`#um-${CSS.escape(a.dataset.um)}`);
    if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); }
  }));
  return { html, bind };
}

// swiyu: the registered parties of one environment as map entries; measured entities with a use already
// in userKeys are left out, others stand at their seat from the UID register or, without UID, in a list
export function swiyuExtra(reg, env, userKeys, ix, uids) {
  const out = { points: [], unplaced: [] };
  if (!reg || reg.kind !== "swiyu") return out;
  const byUid = new Set(ix.rows.filter((r) => userKeys.includes(r[0])).map((r) => r[4]).filter(Boolean));
  const seen = new Set();
  reg.providers.filter((p) => p.env === env).forEach((p) => {
    const id = p.uid || p.name;
    if (seen.has(id) || (p.uid && byUid.has(p.uid))) return;
    seen.add(id);
    const href = p.uid && uids.has(p.uid.replace(/\D/g, "")) ? `#/uid/${encodeURIComponent(p.uid)}` : p.src;
    const name = `${p.name} · ${(p.roles || []).map((r) => t("role_" + r)).join(", ")}${(p.issues || []).length ? ` (${p.issues.join(", ")})` : ""}`;
    if (p.seat) out.points.push({ name, href, bfs: p.seat.bfs, canton: p.seat.canton });
    else out.unplaced.push({ name, href });
  });
  return out;
}

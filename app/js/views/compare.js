// «Vergleich»: the own organisation per function against the best 5 % of its
// level (the best canton or department where the group is small), side by side
// with any other entity, and a ranking by any series, filtered by canton or sector.
import * as data from "../data.js";
import { LEVELS, LEVEL_ONE, LEVEL_MANY, CATS, BLOCKS, LAYERS, t, checkName } from "../text.js";
import { esc, fmt, light, dot, bar, store, HOME_KEY } from "../ui.js";

const PAGE = 50;
const share = (k) => {
  if (!k) return null;
  const n = k.assessed ?? (k.pass || 0) + (k.partial || 0) + (k.fail || 0);
  return n ? (100 * ((k.pass || 0) + 0.5 * (k.partial || 0))) / n : null;
};
// groups of series: the overall value and its categories, then the building blocks by layer
const group = (s) => (s.startsWith("blk:") ? s.slice(4).split(".")[0] : "total");
const groupName = (g) => (g === "total" ? t("total_and_areas") : (LAYERS[g] || {}).name || g);
export const seriesName = (s) =>
  s === "overall" ? t("overall") : s === "mail" ? t("mail") : s.startsWith("cat:") ? CATS[s.slice(4)] || s : BLOCKS[s.slice(4)] || s;
const bestLabel = (b) => (!b ? "" : b.mode === "top" ? t("best_top", { p: Math.round(b.share * 100) }) : t("best_one"));
const bestVal = (b) => (!b ? null : b.mode === "top" ? b.mean : b.value);

function hash(key, p) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return `#/vergleich${key ? "/" + encodeURIComponent(key) : ""}${q.toString() ? "?" + q : ""}`;
}

export async function render(el, params) {
  const key = params.key || store.get(HOME_KEY) || "";
  const [meta, bm, sc, ix] = await Promise.all([data.meta(), data.benchmarks(), data.scores(), data.index()]);
  const cfg = meta.cfg;
  const names = Object.fromEntries(ix.rows.map((r) => [r[0], r[1]]));
  const [d, d2] = await Promise.all([key ? data.entity(key).catch(() => null) : null, params.mit ? data.entity(params.mit).catch(() => null) : null]);
  const level = params.level && LEVELS.some(([k]) => k === params.level) ? params.level : d ? d.kind : "municipality";
  const B = bm[level] || {};
  const S = sc.series;
  const own = d && sc.rows[d.key], other = d2 && sc.rows[d2.key];
  const link = (k) => `<a href="#/org/${encodeURIComponent(k)}">${esc(names[k] || k)}</a>`;
  const keep = { level: params.level, kt: params.kt, sek: params.sek, sort: params.sort };

  // 1. per function: own value, the other entity, the benchmark, the gap and who reaches it
  let table = "";
  if (d && d.kind === level) {
    let last = "";
    const rows = S.map((s, i) => {
      const g = group(s), head = g !== last ? `<tr class="grp"><th colspan="${d2 ? 6 : 5}">${esc(groupName(g))}</th></tr>` : "";
      last = g;
      const b = B[s], v = own ? own[i] : null, v2 = other ? other[i] : null, bv = bestVal(b);
      const gap = v !== null && bv !== null && bv !== undefined ? v - bv : null;
      const ex = b ? (b.examples || []).filter((k) => k !== d.key).slice(0, 3)
        .map((k) => `${link(k)} <a class="small" href="${hash(d.key, { ...keep, mit: k })}" title="${esc(t("compare_with", { n: names[k] || k }))}">⇄</a>`).join(", ") : "";
      return `${head}<tr${s === "overall" ? ' class="total"' : ""}><th>${esc(seriesName(s))}</th>
        <td>${v === null ? '<span class="muted">–</span>' : `${dot(light(v, cfg))} ${fmt(v)}`}</td>
        ${d2 ? `<td>${v2 === null ? '<span class="muted">–</span>' : `${dot(light(v2, cfg))} ${fmt(v2)}`}</td>` : ""}
        <td>${b ? `${fmt(bv)} <span class="muted small bl">${esc(bestLabel(b))}</span>` : '<span class="muted">–</span>'}</td>
        <td class="gap ${gap === null ? "" : gap >= 0 ? "pos" : "neg"}">${gap === null ? "" : (gap >= 0 ? "+" : "−") + fmt(Math.abs(gap))}</td>
        <td class="ex">${v !== null ? bar(v, bv, bestLabel(b)) : ""}${ex ? `<div class="small">${ex}</div>` : ""}</td></tr>`;
    }).join("");
    table = `<section><h2>${esc(t("per_function", { n: d.name }))}</h2>
      <p class="sub">${esc(B.overall && B.overall.mode === "top" ? t("explain_top", { p: Math.round(B.overall.share * 100), lv: LEVEL_MANY[level] }) : t("explain_best", { lv: LEVEL_MANY[level] }))}</p>
      <div class="scroll"><table class="cmp"><thead><tr><th>${esc(t("function"))}</th><th>${esc(d.name)}</th>${d2 ? `<th>${esc(d2.name)} <a class="small" href="${hash(d.key, keep)}" title="${esc(t("remove"))}">✕</a></th>` : ""}
        <th>${esc(t("benchmark"))}</th><th>${esc(t("gap"))}</th><th>${esc(t("who_reaches"))}</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  } else if (d) {
    table = `<p class="sub">${esc(t("other_level", { n: d.name, lv: LEVEL_ONE[d.kind] }))}</p>`;
  } else {
    table = `<section class="lead"><p>${esc(t("no_home"))}</p></section>`;
  }

  // 2. what the other entity does differently: checks where it is clearly better
  let diff = "";
  if (d && d2) {
    const all = (x) => ({ ...((x.posture || {}).checks || {}), ...((x.mail || {}).checks || {}) });
    const a = all(d), b = all(d2);
    const better = Object.keys(b).map((id) => [id, share(a[id]), share(b[id])])
      .filter(([, x, y]) => x !== null && y !== null && y - x >= 20).sort((p, q) => (q[2] - q[1]) - (p[2] - p[1])).slice(0, 8);
    diff = `<section><h2>${esc(t("does_differently", { n: d2.name }))}</h2>${better.length
      ? `<ul class="diff">${better.map(([id, x, y]) => `<li><b>${esc(checkName(id))}</b> <span class="muted">${fmt(x)} → ${fmt(y)}</span></li>`).join("")}</ul>`
      : `<p>${esc(t("no_difference"))}</p>`}</section>`;
  }

  // 3. ranking of the level by a series, filtered by canton or sector
  const si = Math.max(0, S.indexOf(params.sort || "overall"));
  let rows = ix.rows.filter((r) => r[0].startsWith(level + ":"));
  const cantons = [...new Set(rows.map((r) => r[2]).filter(Boolean))].sort();
  const sectors = [...new Set(rows.map((r) => r[5]).filter(Boolean))].sort();
  if (params.kt) rows = rows.filter((r) => r[2] === params.kt);
  if (params.sek) rows = rows.filter((r) => r[5] === params.sek);
  const val = (k) => ((sc.rows[k] || [])[si] ?? null);
  rows = rows.map((r) => [r[0], val(r[0])]).sort((p, q) => (q[1] ?? -1) - (p[1] ?? -1) || (names[p[0]] || "").localeCompare(names[q[0]] || ""));
  const rated = rows.filter((r) => r[1] !== null).length;
  const n = params.n === "all" ? rows.length : PAGE;
  const line = ([k, v], i) => `<tr${d && k === d.key ? ' class="me"' : ""}><td class="rk">${v === null ? "" : i + 1}</td><td>${link(k)}</td>
    <td>${v === null ? '<span class="muted">–</span>' : `${dot(light(v, cfg))} ${fmt(v)}`}</td>
    <td>${d && k !== d.key && d.kind === level ? `<a class="small" href="${hash(d.key, { ...keep, mit: k })}" title="${esc(t("compare_with", { n: names[k] || k }))}">⇄</a>` : ""}</td></tr>`;
  const mine = d ? rows.findIndex((r) => r[0] === d.key) : -1;
  const sel = (name, opts, cur, all) => `<select data-f="${name}"><option value="">${esc(all)}</option>${opts.map((o) => `<option${o === cur ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
  const ranking = `<section id="rank"><h2>${esc(t("ranking"))}</h2>
    <div class="tabs">${LEVELS.map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="${hash(key, { level: k })}">${esc(nm)}</a>`).join("")}</div>
    <div class="filters">
      <label>${esc(t("sort_by"))} <select data-f="sort">${[...new Set(S.map(group))].map((g) => `<optgroup label="${esc(groupName(g))}">${S.filter((s) => group(s) === g)
        .map((s) => `<option value="${s}"${S[si] === s ? " selected" : ""}>${esc(seriesName(s))}</option>`).join("")}</optgroup>`).join("")}</select></label>
      ${cantons.length > 1 ? `<label>${esc(t("canton"))} ${sel("kt", cantons, params.kt, t("all"))}</label>` : ""}
      ${sectors.length > 1 ? `<label>${esc(t("sector"))} ${sel("sek", sectors, params.sek, t("all"))}</label>` : ""}
      <span class="muted small">${esc(t("rated_of", { r: rated, n: rows.length }))}${mine >= 0 && rows[mine][1] !== null ? " · " + esc(t("own_rank", { r: mine + 1 })) : ""}</span>
    </div>
    <table class="rank"><thead><tr><th>${esc(t("rank"))}</th><th>${esc(LEVEL_ONE[level])}</th><th>${esc(seriesName(S[si]))}</th><th></th></tr></thead>
      <tbody>${rows.slice(0, n).map(line).join("")}${mine >= n ? `<tr class="gapline"><td colspan="4">…</td></tr>${line(rows[mine], mine)}` : ""}</tbody></table>
    ${rows.length > n ? `<p><a href="${hash(key, { ...keep, level, n: "all", mit: params.mit })}">${esc(t("show_all", { n: rows.length }))}</a></p>` : ""}
  </section>`;

  el.innerHTML = `<section class="lead"><h1>${esc(t("compare_title"))}</h1></section>` + table + diff + ranking;
  el.querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", () => {
    const p = { level, kt: params.kt, sek: params.sek, sort: params.sort, mit: params.mit, [s.dataset.f]: s.value };
    if (s.dataset.f !== "sort") p.n = undefined;
    location.hash = hash(key, p);
  }));
  // from a building block on the start page: straight to the ranking
  if (params.to === "rank") el.querySelector("#rank")?.scrollIntoView();
}

// The page of a service or provider (#/dienst/<id>, #/anbieter/<id>): one page
// type, because the operator of a service is often also a provider (AGOV).
// Sections: the service (description, blocks, environment, sources), its
// posture (value of its own hosts and what they rest on; «not measured» for a
// provider whose own hosts are not measured), and its use (who uses it, with
// evidence; for a provider, the customers per function with their own value).
// Posture and use stay apart (docs/PRODUCT.md, section 5.1): the posture of the
// service is part of its users' supply chain and not in their value.
import * as data from "../data.js";
import { LEVELS, LEVEL_MANY, BLOCKS, t, tx } from "../text.js";
import { esc, fmt, light, dot, cc } from "../ui.js";
import { FUNCS, fnInfo, fnDetail, hash, levelOf, pct, fname } from "./deps.js";
import { envBadge, posture, use, sourceLine } from "./infra.js";

// the implementations of a service across blocks: id equal, or recognised through the provider key
function services(inf, id) {
  const out = new Map();
  for (const [blk, b] of Object.entries(inf.blocks || {})) {
    for (const i of b.implementations || []) {
      if (i.id !== id && !(i.providers || []).includes(id)) continue;
      const s = out.get(i.id) || { ...i, blocks: [] };
      s.blocks.push(blk);
      out.set(i.id, s);
    }
  }
  return [...out.values()];
}

function customers(p, params, dir, meta, names, cfg, route) {
  const used = LEVELS.filter(([k]) => p.counts[k]);
  const level = levelOf(params, used.length ? used[0][0] : "municipality");
  const fns = FUNCS.filter((f) => (p.entities || {})[f]);
  const counts = `<table class="cnt"><thead><tr><th></th>${fns.map((f) => `<th>${esc(fname(f))}</th>`).join("")}</tr></thead>
    <tbody>${used.map(([k, nm]) => `<tr><th>${esc(nm)}</th>${fns.map((f) => {
      const c = (p.counts[k] || {})[f] || 0, tot = (meta.counts || {})[k] || 0;
      return `<td>${c ? `${c} <span class="muted small">${pct(c, tot)} %</span>` : "–"}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
  const val = (k) => { const v = (names[k] || [])[2]; return v === null || v === undefined ? `<span class="muted small">–</span>` : `${dot(light(v, cfg))} <span class="small">${fmt(v)}</span>`; };
  const lists = fns.map((f) => {
    let ks = p.entities[f].filter((k) => k.startsWith(level + ":"));
    if (params.kt) ks = ks.filter((k) => (names[k] || [])[1] === params.kt);
    if (!ks.length) return "";
    ks.sort((a, b) => ((names[a] || [a])[0]).localeCompare((names[b] || [b])[0]));
    return `<details${ks.length <= 30 ? " open" : ""}><summary><b>${esc(fname(f))}</b> · ${ks.length} ${esc(LEVEL_MANY[level])}
      <span class="muted small">· ${esc(fnInfo(f, dir.functions))}</span></summary>${fnDetail(f, dir.functions)}
      <ul class="ents val">${ks.map((k) => `<li>${val(k)} <a href="#/org/${encodeURIComponent(k)}">${esc((names[k] || [k])[0])}</a>${(names[k] || [])[1] && level === "municipality" ? ` <span class="muted small">${esc(names[k][1])}</span>` : ""}</li>`).join("")}</ul></details>`;
  }).join("");
  const cantons = !["municipality", "organisation", "education"].includes(level) ? [] : [...new Set(Object.values(p.entities || {}).flat().filter((k) => k.startsWith(level + ":")).map((k) => (names[k] || [])[1]).filter(Boolean))].sort();
  return { level, html: `<section data-provider-customers><h2>${esc(t("who_depends"))}</h2><p class="muted small">${esc(t("cust_value_note"))}</p>${counts}
    <div class="tabs">${used.map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="${hash(route, { level: k })}">${esc(nm)}</a>`).join("")}</div>
    ${cantons.length > 1 ? `<div class="filters"><label>${esc(t("canton"))} <select data-f="kt"><option value="">${esc(t("all"))}</option>${cantons.map((c) => `<option${c === params.kt ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>` : ""}
    ${lists || `<p class="muted">–</p>`}<p class="muted small">${esc(t("deps_note"))}</p></section>` };
}

export async function render(el, params, kind) {
  const id = params.id || "";
  const [inf, meta, dir, ix, p] = await Promise.all([data.infrastructure(), data.meta(), data.providers(), data.index(),
    data.provider(id).catch(() => null)]);
  const svcs = services(inf, id);
  if (!p && !svcs.length) {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(id)}</p></section>`;
    return;
  }
  const cfg = meta.cfg;
  const names = Object.fromEntries(ix.rows.map((r) => [r[0], [r[1], r[2], r[3]]]));
  const route = `${kind === "dienst" ? "dienst" : "anbieter"}/${encodeURIComponent(id)}`;
  const main = svcs.find((s) => s.id === id) || svcs[0];
  const title = main && (main.id === id || !p) ? main.name : p.name;
  const blockLinks = (s) => s.blocks.map((b) => `<a href="#/baustein/${encodeURIComponent(b)}">${esc(BLOCKS[b] || b)}</a>`).join(" · ");
  // the service: what it is, where it belongs, which environment
  const desc = svcs.map((s) => `<div class="imp">${svcs.length > 1 ? `<h3 class="imp-name">${esc(s.name)}</h3>` : ""}${envBadge(s)}
      <p>${esc(tx(s, "operator") || "")}${s.role ? " · " + esc(tx(s, "role")) : ""}</p>
      <p class="small"><span class="muted">${esc(t("svc_blocks"))}:</span> ${blockLinks(s)}</p>${sourceLine(s)}</div>`).join("");
  // posture: the service's own hosts; a provider without a measured service is not measured
  const post = svcs.length
    ? svcs.map((s) => `<div class="imp">${svcs.length > 1 ? `<h3 class="imp-name">${esc(s.name)}</h3>` : ""}${posture(s, cfg)}</div>`).join("")
    : `<p><span class="badge wait">${esc(t("not_measured"))}</span> ${esc(t("prov_not_measured"))}</p>`;
  const cust = p ? customers(p, params, dir, meta, names, cfg, route) : null;
  const op = p && p.operator ? `<p class="sub">${esc(t("op_company"))}: <a href="${esc(p.operator.src)}" rel="noopener">${esc(p.operator.name)}</a> ${cc(p.operator.country)}
      · ${p.operator.parent ? `${esc(t("op_parent"))}: <a href="${esc(p.operator.parent.src)}" rel="noopener">${esc(p.operator.parent.name)}</a> ${cc(p.operator.parent.country)}`
        : esc(t("op_no_parent", { r: p.operator.parent_reason || "–" }))}</p>
      <p class="muted small">${esc(t("op_note", { d: (p.operator.fetched || "").split("-").reverse().map(Number).join(".") }))}</p>` : "";
  const back = main ? `<a href="#/baustein/${encodeURIComponent(main.blocks[0])}">← ${esc(BLOCKS[main.blocks[0]] || main.blocks[0])}</a>`
    : `<a href="${hash("abhaengigkeiten", { level: cust ? cust.level : "municipality" })}">← ${esc(t("deps_title"))}</a>`;
  el.innerHTML = `<section class="lead org"><div class="kind">${esc(svcs.length ? t("svc_kind") : t("kind_" + p.kind) || p.kind)}</div>
      <h1>${esc(title)} ${p ? cc(p.country) : ""}</h1>${op}<p>${back}</p></section>
    ${svcs.length ? `<section data-service><h2>${esc(t("svc_about"))}</h2>${desc}</section>` : ""}
    <section data-provider-posture><h2>${esc(svcs.length ? t("svc_posture") : t("prov_posture"))}</h2><p class="muted small">${esc(svcs.length ? t("svc_posture_d") : t("prov_posture_d"))}</p>${post}</section>
    ${svcs.some((s) => (s.users_list || []).length || Object.keys(s.users || {}).length) || !p
      ? `<section data-service-use><h2>${esc(t("svc_use"))}</h2><p class="muted small">${esc(t("svc_use_d"))}</p>${svcs.map((s) => `<div class="imp">${svcs.length > 1 ? `<h3 class="imp-name">${esc(s.name)}</h3>` : ""}${use(s)}</div>`).join("")}</section>` : ""}
    ${cust ? cust.html : ""}`;
  const sel = el.querySelector("[data-f=kt]");
  if (sel) sel.addEventListener("change", () => { location.hash = hash(route, { level: cust.level, kt: sel.value }); });
}

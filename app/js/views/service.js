// The page of a service or provider (#/dienst/<id>, #/anbieter/<id>): one page
// type, because the operator of a service is often also a provider (AGOV).
// Sections: the service (description, blocks, environment, sources), its
// posture (value of its own hosts and what they rest on; «not measured» for a
// provider whose own hosts are not measured), and its use (who uses it, with
// evidence; for a provider, the customers per function with their own value).
// Posture and use stay apart (docs/PRODUCT.md, section 5.1): the posture of the
// service is part of its users' supply chain and not in their value.
import * as data from "../data.js";
import { LEVELS, LEVEL_MANY, BLOCKS, LAYERS, t, tx } from "../text.js";
import { esc, fmt, light, dot, cc } from "../ui.js";
import { FUNCS, fnInfo, fnDetail, hash, levelOf, pct, fname } from "./deps.js";
import { envBadge, posture, use, sourceLine, linkSwiyu, swiyuRegister, useUids, bindRegTabs, bindRegTables, blockService, legal, register } from "./infra.js";
import { usersMap, swiyuExtra } from "./usermap.js";
import { usageView } from "./usage.js";
import * as evid from "./evidence.js";

// the implementations of a service across blocks: id equal, or recognised through the provider key
function services(inf, id) {
  const out = new Map();
  for (const [blk, b] of Object.entries(inf.blocks || {})) {
    for (const i of b.implementations || []) {
      if (i.id !== id && !i.id.startsWith(id + "-") && !(i.providers || []).includes(id)) continue;
      const s = out.get(i.id) || { ...i, blocks: [] };
      s.blocks.push(blk);
      out.set(i.id, s);
    }
  }
  return [...out.values()];
}

function customers(p, params, dir, meta, names, cfg, route, um) {
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
  return { level, html: `<section data-provider-customers><h2>${esc(t("who_depends"))}</h2>${um ? `<div class="tabs">${["", ...fns].map((f) => `<a class="tab${f === (params.fn || "") ? " on" : ""}" href="${hash(route, { level, fn: f })}">${esc(f ? fname(f) : t("um_all"))}</a>`).join("")}</div>${um.html}` : ""}
    <p class="muted small">${esc(t("cust_value_note"))}</p>${counts}
    <div class="tabs">${used.map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="${hash(route, { level: k, fn: params.fn })}">${esc(nm)}</a>`).join("")}</div>
    ${cantons.length > 1 ? `<div class="filters"><label>${esc(t("canton"))} <select data-f="kt"><option value="">${esc(t("all"))}</option>${cantons.map((c) => `<option${c === params.kt ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>` : ""}
    ${lists || `<p class="muted">–</p>`}<p class="muted small">${esc(t("deps_note"))}</p></section>` };
}

export async function render(el, params, kind) {
  const id = params.id || "";
  const [inf, meta, dir, ix, p, uids] = await Promise.all([data.infrastructure(), data.meta(), data.providers(), data.index(),
    data.provider(id).catch(() => null), data.uids()]);
  useUids(uids);
  // another environment of a service (swiyu-sandbox) is shown on the page of the service
  const parent = Object.values(inf.blocks || {}).flatMap((b) => b.implementations || []).find((i) => id.startsWith(i.id + "-"));
  if (parent) {
    const me = Object.values(inf.blocks || {}).flatMap((b) => b.implementations || []).find((i) => i.id === id);
    location.replace(`#/dienst/${encodeURIComponent(parent.id)}${me && me.environment ? "?env=" + me.environment : ""}`);
    return;
  }
  const gov = await data.governance().catch(() => ({ laws: [] }));
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
  // a block is named with its layer; a block whose page is this one is not linked
  const blockName = (b) => `${(LAYERS[b.split(".")[0]] || {}).name || ""}: ${BLOCKS[b] || b}`;
  const own = (b) => blockService((inf.blocks || {})[b] || {}) === id;
  const blockLinks = (s) => s.blocks.map((b) => own(b) ? esc(blockName(b)) : `<a href="#/baustein/${encodeURIComponent(b)}">${esc(blockName(b))}</a>`).join(" · ");
  // environments of one service (swiyu and its sandbox): one selector for the whole page
  const byEnv = svcs.length > 1 && svcs.every((x) => x.environment);
  const envFirst = byEnv ? (svcs.some((x) => x.environment === params.env) ? params.env : (svcs.find((x) => x.id === id) || svcs[0]).environment) : null;
  const wrap = (x) => (byEnv ? `data-regenv="${esc(x.environment)}"${x.environment === envFirst ? "" : " hidden"}` : "");
  const envTabs = byEnv ? `<div class="tabs">${svcs.map((x) => `<a class="tab${x.environment === envFirst ? " on" : ""}" href="#" data-regtab="${esc(x.environment)}">${esc(t("env_" + x.environment))}</a>`).join("")}</div>` : "";
  const head3 = (x) => (svcs.length > 1 && !byEnv ? `<h3 class="imp-name">${esc(x.name)}</h3>` : "");
  // the service: what it is, where it belongs, which environment
  const desc = svcs.map((s) => `<div class="imp" ${wrap(s)}>${head3(s)}${envBadge(s)}
      <p>${esc(tx(s, "operator") || "")}${s.role ? " · " + linkSwiyu(tx(s, "role"), s.id) : ""}</p>
      <p class="small"><span class="muted">${esc(t("svc_blocks"))}:</span> ${blockLinks(s)}</p>${sourceLine(s)}</div>`).join("");
  // posture: the service's own hosts; a provider without a measured service is not measured
  const post = svcs.length
    ? svcs.map((s) => `<div class="imp" ${wrap(s)}>${head3(s)}${posture(s, cfg, true)}</div>`).join("")
    : `<p><span class="badge wait">${esc(t("not_measured"))}</span> ${esc(t("prov_not_measured"))}</p>`;
  // map of the users: for a service those with evidence of use, for a provider its customers (per function)
  // swiyu: every registered participant of the service's environment; those that are measured entities appear as such,
  // others at their seat from the UID register, without UID in a list below the map
  const userKeys = svcs.flatMap((s) => (s.users_list || []).filter((u) => u.role !== "hint" && u.role !== "law").map((u) => u.key));
  const lawKeys = svcs.flatMap((s) => (s.users_list || []).filter((u) => u.role === "law").map((u) => u.key));
  const extra = { points: [], unplaced: [], law: lawKeys };
  const swyReg = svcs.flatMap((s) => s.blocks.map((b) => [s, (inf.blocks[b] || {}).register])).find(([, r]) => r && r.kind === "swiyu");
  if (swyReg && swyReg[0].environment) Object.assign(extra, swiyuExtra(swyReg[1], swyReg[0].environment, userKeys, ix, uids));
  let svcMap = svcs.length ? await usersMap(userKeys, ix, extra) : null;
  // swiyu: one map per environment behind the same selector as the register tables
  if (swyReg && swyReg[0].environment) {
    const envs = Object.keys(swyReg[1].envs || {});
    const maps = [];
    for (const env of envs) {
      const imp = (inf.blocks["trust.swiyu"] || { implementations: [] }).implementations.find((i) => i.environment === env) || { users_list: [] };
      const keys = (imp.users_list || []).filter((u) => u.role !== "hint" && u.role !== "law").map((u) => u.key);
      // the register table follows the map and lists every participant: map without lists
      maps.push([env, await usersMap(keys, ix, { ...swiyuExtra(swyReg[1], env, keys, ix, uids), lists: false })]);
    }
    const first = envFirst || (envs.includes(params.env) ? params.env : swyReg[0].environment);
    svcMap = {
      // one selector, directly above the map: it switches map, register table, description and posture
      html: `${envTabs || `<div class="tabs">${envs.map((e) => `<a class="tab${e === first ? " on" : ""}" href="#" data-regtab="${esc(e)}">${esc(t("env_" + e))}</a>`).join("")}</div>`}
        ${maps.map(([e, m]) => `<div data-regenv="${esc(e)}"${e === first ? "" : " hidden"}>${m.html}</div>`).join("")}`,
      bind: (root) => maps.forEach(([e, m]) => m.bind(root.querySelector(`[data-regenv="${e}"]`))),
    };
  }
  // sedex, I14Y: use from their public sources (summary, map, treemap with detail)
  const usage = svcs.length === 1 && svcs[0].usage ? await usageView(svcs[0].usage, ix) : null;
  const provMap = p && !svcs.length ? await usersMap(params.fn && (p.entities || {})[params.fn] ? p.entities[params.fn] : Object.values(p.entities || {}).flat(), ix) : null;
  // swiyu: the participants of the Trust Registry in the environment of this service
  const swy = svcs.flatMap((s) => s.blocks.map((b) => [s, (inf.blocks[b] || {}).register])).find(([, r]) => r && r.kind === "swiyu");
  const reg = swy && swy[0].environment ? swiyuRegister(swy[1], null, { tabs: envFirst || swy[0].environment, full: true, noTabs: true }) : "";
  const cust = p ? customers(p, params, dir, meta, names, cfg, route, provMap) : null;
  const op = p && p.operator ? `<p class="sub">${esc(t("op_company"))}: <a href="${esc(p.operator.src)}" rel="noopener">${esc(p.operator.name)}</a> ${cc(p.operator.country)}
      · ${p.operator.parent ? `${esc(t("op_parent"))}: <a href="${esc(p.operator.parent.src)}" rel="noopener">${esc(p.operator.parent.name)}</a> ${cc(p.operator.parent.country)}`
        : esc(t("op_no_parent", { r: p.operator.parent_reason || "–" }))}</p>
      <p class="muted small">${esc(t("op_note", { d: (p.operator.fetched || "").split("-").reverse().map(Number).join(".") }))}</p>` : "";
  const backBlk = main && main.blocks.find((b) => !own(b));
  const back = main ? (backBlk ? `<a href="#/baustein/${encodeURIComponent(backBlk)}">← ${esc(BLOCKS[backBlk] || backBlk)}</a>` : `<a href="#/">← ${esc(t("overview"))}</a>`)
    : `<a href="${hash("abhaengigkeiten", { level: cust ? cust.level : "municipality" })}">← ${esc(t("deps_title"))}</a>`;
  el.innerHTML = `<section class="lead org"><div class="kind">${esc(svcs.length ? t("svc_kind") : t("kind_" + p.kind) || p.kind)}</div>
      <h1>${esc(title)} ${p ? cc(p.country) : ""}</h1>${op}<p>${back}</p>${swyReg ? "" : envTabs}</section>
    ${svcs.length ? `<section data-service><h2>${esc(t("svc_about"))}</h2>${desc}</section>` : ""}
    <section data-provider-posture>${svcs.length ? "" : `<h2>${esc(t("prov_posture"))}</h2><p class="muted small">${esc(t("prov_posture_d"))}</p>`}${post}</section>
    ${svcs.length ? `<section data-service-use><h2>${esc(t("svc_use"))}</h2><p class="muted small">${esc(t("svc_use_d"))}</p>${usage ? usage.html : svcMap.html}
      ${usage ? "" : swyReg ? reg : svcs.map((s) => `<div class="imp" ${wrap(s)}>${head3(s)}${use(s)}</div>`).join("")}</section>` : ""}
    ${svcs.map((s) => register(s.register)).join("")}${cust ? cust.html : ""}${swyReg ? "" : reg}${[...new Set(svcs.flatMap((x) => x.blocks))].filter(own).map((b) => legal(gov, b)).join("")}`;
  [usage || svcMap, provMap].forEach((m) => m && m.bind(el));
  bindRegTabs(el);
  bindRegTables(el);
  evid.wire(el, null);
  const sel = el.querySelector("[data-f=kt]");
  if (sel) sel.addEventListener("change", () => { location.hash = hash(route, { level: cust.level, kt: sel.value, fn: params.fn }); });
}

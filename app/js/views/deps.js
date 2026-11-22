// «Abhängigkeiten»: thought from the provider. Who carries how many cantons,
// municipalities, departments or critical services, per function (mail, sending,
// SaaS, login, cloud and hosting, CA, DNS), how replaceable the function is, and
// per provider the list of the entities that depend on it.
import * as data from "../data.js";
import { LEVELS, LEVEL_ONE, LEVEL_MANY, t } from "../text.js";
import { esc, cc } from "../ui.js";

export const FUNCS = ["mail", "send", "saas", "idp", "cloud", "ca", "dns"];
const PAGE = 50;
const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);
const fname = (f) => t("fn_" + f);

function hash(path, p) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return `#/${path}${q.toString() ? "?" + q : ""}`;
}
const levelOf = (params, fallback = "municipality") => (LEVELS.some(([k]) => k === params.level) ? params.level : fallback);

function fnInfo(f, funcs) {
  const x = funcs[f] || {};
  return x.model ? `${t("model_" + x.model)} · ${t("swap_" + x.swap)}` : "";
}

export async function renderList(el, params) {
  const [dir, meta] = await Promise.all([data.providers(), data.meta()]);
  const level = levelOf(params), f = FUNCS.includes(params.f) ? params.f : "", byGroup = params.konzern === "1";
  const total = (meta.counts || {})[level] || 0;
  const count = (r) => {
    const c = r.counts[level] || {};
    return f ? c[f] || 0 : Object.values(c).reduce((a, b) => Math.max(a, b), 0);
  };
  // by group: providers of the same controlling company together (the largest count per function, not a sum,
  // because one entity can use several products of the same group)
  let rows = dir.rows.map((r) => ({ ...r, n: count(r) })).filter((r) => r.n > 0);
  if (byGroup) {
    const g = new Map();
    for (const r of rows) {
      const k = r.parent || r.name;
      const cur = g.get(k) || { id: r.parent ? "" : r.id, name: k, country: r.parent ? r.parent_country : r.country, members: [], n: 0 };
      cur.members.push(r);
      cur.n = Math.max(cur.n, r.n);
      g.set(k, cur);
    }
    rows = [...g.values()];
  }
  rows.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const n = params.n === "all" ? rows.length : PAGE;
  const keep = { level, f, konzern: byGroup ? "1" : "" };
  const top = rows[0];
  const lead = top ? t("cluster_lead", { name: top.name, p: pct(top.n, total), lv: LEVEL_MANY[level], f: f ? fname(f) : t("any_function") }) : "";

  const line = (r, i) => {
    const link = r.id ? `<a href="${hash("anbieter/" + encodeURIComponent(r.id), { level })}">${esc(r.name)}</a>` : esc(r.name);
    const fns = byGroup ? r.members.map((m) => (m.id ? `<a href="${hash("anbieter/" + encodeURIComponent(m.id), { level })}">${esc(m.name)}</a>` : esc(m.name))).join(", ")
      : FUNCS.filter((x) => (r.counts[level] || {})[x]).map((x) => `<span class="fn${x === f ? " on" : ""}">${esc(fname(x))} ${(r.counts[level] || {})[x]}</span>`).join(" ");
    return `<tr><td class="rk">${i + 1}</td><td>${link} ${cc(r.country)}${!byGroup && r.parent ? `<div class="small muted">${esc(r.parent)}</div>` : ""}</td>
      <td class="num"><b>${r.n}</b> <span class="muted small">${pct(r.n, total)} %</span><div class="share"><span style="width:${pct(r.n, total)}%"></span></div></td>
      <td class="fns">${fns}</td></tr>`;
  };
  el.innerHTML = `<section class="lead"><h1>${esc(t("deps_title"))}</h1><p>${esc(t("deps_intro"))}</p>
    <div class="tabs">${LEVELS.map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="${hash("abhaengigkeiten", { ...keep, level: k })}">${esc(nm)}</a>`).join("")}</div>
    <div class="filters">
      <label>${esc(t("function"))} <select data-f="f"><option value="">${esc(t("any_function"))}</option>${FUNCS.map((x) => `<option value="${x}"${x === f ? " selected" : ""}>${esc(fname(x))}</option>`).join("")}</select></label>
      <label><input type="checkbox" data-f="konzern"${byGroup ? " checked" : ""}> ${esc(t("by_group"))}</label>
      ${f ? `<span class="muted small">${esc(fnInfo(f, dir.functions))}</span>` : ""}
    </div>
    ${lead ? `<p class="sub">${esc(lead)}</p>` : ""}</section>
    <div class="scroll"><table class="prov"><thead><tr><th>${esc(t("rank"))}</th><th>${esc(byGroup ? t("group") : t("provider"))}</th>
      <th>${esc(t("depend", { lv: LEVEL_MANY[level] }))}</th><th>${esc(byGroup ? t("products") : t("functions"))}</th></tr></thead>
      <tbody>${rows.slice(0, n).map(line).join("")}</tbody></table></div>
    ${rows.length > n ? `<p><a href="${hash("abhaengigkeiten", { ...keep, n: "all" })}">${esc(t("show_all", { n: rows.length }))}</a></p>` : ""}
    <p class="muted small">${esc(t("deps_note"))}</p>`;
  el.querySelectorAll("[data-f]").forEach((s) => s.addEventListener("change", () => {
    const v = s.type === "checkbox" ? (s.checked ? "1" : "") : s.value;
    location.hash = hash("abhaengigkeiten", { ...keep, [s.dataset.f]: v });
  }));
}

export async function renderProvider(el, params) {
  let p;
  try {
    p = await data.provider(params.id);
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(params.id)}</p></section>`;
    return;
  }
  const [dir, meta, ix] = await Promise.all([data.providers(), data.meta(), data.index()]);
  const names = Object.fromEntries(ix.rows.map((r) => [r[0], [r[1], r[2]]]));
  const used = LEVELS.filter(([k]) => p.counts[k]);
  const level = levelOf(params, used.length ? used[0][0] : "municipality");
  const counts = `<table class="cnt"><thead><tr><th></th>${FUNCS.filter((f) => (p.entities || {})[f]).map((f) => `<th>${esc(fname(f))}</th>`).join("")}</tr></thead>
    <tbody>${used.map(([k, nm]) => `<tr><th>${esc(nm)}</th>${FUNCS.filter((f) => (p.entities || {})[f]).map((f) => {
      const c = (p.counts[k] || {})[f] || 0, tot = (meta.counts || {})[k] || 0;
      return `<td>${c ? `${c} <span class="muted small">${pct(c, tot)} %</span>` : "–"}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table>`;
  const lists = FUNCS.filter((f) => (p.entities || {})[f]).map((f) => {
    let ks = p.entities[f].filter((k) => k.startsWith(level + ":"));
    if (params.kt) ks = ks.filter((k) => (names[k] || [])[1] === params.kt);
    if (!ks.length) return "";
    ks.sort((a, b) => ((names[a] || [a])[0]).localeCompare((names[b] || [b])[0]));
    return `<details${ks.length <= 30 ? " open" : ""}><summary><b>${esc(fname(f))}</b> · ${ks.length} ${esc(LEVEL_MANY[level])}
      <span class="muted small">· ${esc(fnInfo(f, dir.functions))}</span></summary>
      <ul class="ents">${ks.map((k) => `<li><a href="#/org/${encodeURIComponent(k)}">${esc((names[k] || [k])[0])}</a>${(names[k] || [])[1] && level === "municipality" ? ` <span class="muted small">${esc(names[k][1])}</span>` : ""}</li>`).join("")}</ul></details>`;
  }).join("");
  const cantons = !["municipality", "organisation"].includes(level) ? [] : [...new Set(Object.values(p.entities || {}).flat().filter((k) => k.startsWith(level + ":")).map((k) => (names[k] || [])[1]).filter(Boolean))].sort();
  el.innerHTML = `<section class="lead org"><div class="kind">${esc(t("kind_" + p.kind) || p.kind)}</div>
    <h1>${esc(p.name)} ${cc(p.country)}</h1>
    ${p.parent ? `<p class="sub">${esc(t("part_of", { p: p.parent }))} ${cc(p.parent_country)}</p>` : ""}
    <p><a href="${hash("abhaengigkeiten", { level })}">← ${esc(t("deps_title"))}</a></p></section>
    <section><h2>${esc(t("who_depends"))}</h2>${counts}</section>
    <section><div class="tabs">${used.map(([k, nm]) => `<a class="tab${k === level ? " on" : ""}" href="${hash("anbieter/" + encodeURIComponent(p.id), { level: k })}">${esc(nm)}</a>`).join("")}</div>
      ${cantons.length > 1 ? `<div class="filters"><label>${esc(t("canton"))} <select data-f="kt"><option value="">${esc(t("all"))}</option>${cantons.map((c) => `<option${c === params.kt ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></div>` : ""}
      ${lists || `<p class="muted">–</p>`}</section>
    <p class="muted small">${esc(t("deps_note"))}</p>`;
  const sel = el.querySelector("[data-f=kt]");
  if (sel) sel.addEventListener("change", () => { location.hash = hash("anbieter/" + encodeURIComponent(p.id), { level, kt: sel.value }); });
}

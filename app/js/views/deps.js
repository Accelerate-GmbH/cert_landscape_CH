// «Abhängigkeiten»: thought from the provider. Who carries how many cantons,
// municipalities, departments or critical services, per function (mail, sending,
// SaaS, login, cloud and hosting, CA, DNS), how replaceable the function is, and
// the page of each provider is service.js (#/anbieter/<id>).
import * as data from "../data.js";
import { LEVELS, LEVEL_ONE, LEVEL_MANY, t } from "../text.js";
import { esc, cc } from "../ui.js";

export const FUNCS = ["mail", "send", "saas", "idp", "cloud", "ca", "dns"];
const PAGE = 50;
export const pct = (n, of) => (of ? Math.round((100 * n) / of) : 0);
export const fname = (f) => t("fn_" + f);

export function hash(path, p) {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return `#/${path}${q.toString() ? "?" + q : ""}`;
}
export const levelOf = (params, fallback = "municipality") => (LEVELS.some(([k]) => k === params.level) ? params.level : fallback);

// protocol or platform always; replaceability (swap, data, export, costs) once approved
export function fnInfo(f, funcs) {
  const x = funcs[f] || {};
  return [x.model && t("model_" + x.model), x.swap && t("swap_" + x.swap)].filter(Boolean).join(" · ");
}
export function fnDetail(f, funcs) {
  const x = funcs[f] || {};
  if (!x.data && !x.export && !x.costs) return "";
  const src = (x.sources || []).map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`).join(" · ");
  return `<dl class="repl">${[["data", x.data], ["export", x.export], ["costs", x.costs]].filter(([, v]) => v)
    .map(([k, v]) => `<dt>${esc(t("repl_" + k))}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    <p class="muted small">${x.assessment ? esc(t("assessment")) + " " : ""}${esc(t("checked_on", { d: (x.checked || "").split("-").reverse().map(Number).join(".") }))}${src ? " · " + esc(t("sources")) + ": " + src : ""}</p>`;
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
    ${f ? fnDetail(f, dir.functions) : ""}
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

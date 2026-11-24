// A building block of the digital public infrastructure (#/baustein/<layer.block>):
// its services with value and use in short, each linking to its own page
// (#/dienst/<id>, service.js); for identity also the foreign login providers used
// instead; registers and legal bases. Reads infrastructure.json; every
// implementation carries its sources.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, GROUPS, LEVELS, LANG, CATS, t, tx, checkName } from "../text.js";
import { esc, fmt, light, dot, cc, uidName, uidRef } from "../ui.js";

let UIDS = new Set();
import { provisionRows, statusWord, lawText } from "./gov.js";
import { usersMap, swiyuExtra } from "./usermap.js";

const REST = ["sov.ca", "sov.dns", "sov.hosting", "sov.registrar"];
const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const src = (list) => (list || []).map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`).join(" · ");
const STATUS = { pass: "green", partial: "yellow", fail: "red" };

// who uses a service, with role and the evidence of the use (docs/DATA_CONTRACT.md, users_list)
const DNSQ = { spf: "TXT", txt: "TXT", mx: "MX", dkim: "CNAME", cname: "CNAME" };
function usersList(list) {
  if (!(list || []).length) return "";
  const evl = (e) => { const u = e.src || (DNSQ[e.kind] ? `https://dns.google/query?name=${encodeURIComponent(e.where)}&type=${DNSQ[e.kind]}` : (e.kind === "path" || e.kind === "redirect" || e.kind === "csp") ? `https://${e.where}` : "");
    if (e.kind === "law") return `<li><span class="muted">${esc(t("ev_kind_law"))}</span> <a href="${esc(e.src)}" rel="noopener">${esc(e.title || e.where)}</a>, ${esc(e.where)}: «${esc(e.what)}»</li>`;
    return `<li><span class="muted">${esc(t("ev_kind_" + e.kind) || e.kind)}</span> <span class="mono">${esc(e.where)}</span>${e.what ? ` → <span class="mono">${esc(e.what)}</span>` : ""}${u ? ` · <a href="${esc(u)}" rel="noopener noreferrer">${esc(t("ev_check"))}</a>` : ""}</li>`; };
  return `<table class="deps"><tbody>${list.map((x) => `<tr><th><a href="#/org/${encodeURIComponent(x.key)}">${esc(x.name)}</a><div class="muted small">${esc(t("role_" + x.role) || x.role)}${x.scope ? " · " + esc(x.scope) : ""}</div></th>
    <td><ul class="bd-ev">${x.evidence.map(evl).join("")}</ul></td></tr>`).join("")}</tbody></table>`;
}

function users(u) {
  const parts = LEVELS.filter(([k]) => u && u[k]).map(([k, nm]) => `${esc(nm)} ${u[k]}`);
  return parts.length ? parts.join(" · ") : `<span class="muted">${esc(t("users_none"))}</span>`;
}

// a description with "swiyu" (the wallet and trust infrastructure, not a host name) linked to the swiyu service page
export const linkSwiyu = (text, selfId) => (/^swiyu/.test(selfId || "") ? esc(text)
  : esc(text).replace(/\bswiyu\b(?![.\-])/g, '<a href="#/dienst/swiyu">swiyu</a>'));

// environment of a service: production or sandbox, with what each means
export const envBadge = (i) => (i.environment ? `<p class="small"><span class="badge ${i.environment === "production" ? "ok" : "wait"}">${esc(t("env_" + i.environment))}</span>
      ${esc(t("env_" + i.environment + "_d"))}${i.environment_assessment ? " " + esc(t("env_assessment")) : ""}</p>` : "");

// the posture of a service: value of its own hosts and what they rest on (part of its users' supply chain)
// full: the posture in detail, as the supply chain of the service's users (categories, checks, hosts with evidence)
export function posture(i, cfg, full = false) {
  const rest = REST.map((c) => {
    const rows = (i.rests_on || {})[c] || [];
    return rows.length ? `<tr><th>${esc(t("rest_" + c))}</th><td>${rows.map((r) => `${dot(STATUS[r.status] || "none")} ${esc(r.value || t("not_checked"))} <span class="muted small">${r.hosts} ${esc(t("hosts"))}</span>`).join("<br>")}</td></tr>` : "";
  }).join("");
  const head = `<p>${i.hosts ? `${dot(light(i.overall, cfg))} <b>${fmt(i.overall)}</b> ${esc(t("mean_of_hosts", { n: i.hosts }))}` : `<span class="muted">${esc(t("no_hosts"))}</span>`}</p>`;
  const body = `<p class="muted small">${i.host_roles && i.classified ? esc(t("host_roles", { s: i.host_roles.service, i: i.host_roles.info, t: i.host_roles.test, d: date(i.classified) })
          + (i.host_roles.other ? " " + t("host_other", { o: i.host_roles.other }) : ""))
        : i.hosts ? esc(t("unclassified")) : ""}</p>
      ${rest ? `<h3>${esc(t("rests_on"))}</h3><table class="deps"><tbody>${rest}</tbody></table>` : ""}
      ${full && i.hosts ? postureDetail(i, cfg) : i.examples && i.examples.length ? `<p class="muted small">${esc(t("measured_hosts"))}: ${i.examples.map(esc).join(", ")}${i.hosts > i.examples.length ? " …" : ""}</p>` : ""}`;
  // on the service page the overall value first, the detail folded
  return full && i.hosts ? `${head}<details class="pdetail"><summary>${esc(t("svc_detail"))}</summary>${body}</details>` : head + body;
}

function postureDetail(i, cfg) {
  const share = (k) => { const n = k.pass + k.partial + k.fail; return n ? Math.round(100 * (k.pass + 0.5 * k.partial) / n) : null; };
  const cats = Object.entries(i.categories || {}).map(([c, v]) => `<tr><th>${esc(CATS[c] || c)}</th><td>${v === null ? `<span class="muted">${esc(t("not_checked"))}</span>` : `${dot(light(v, cfg))} <b>${fmt(v)}</b>`}</td></tr>`).join("");
  const order = Object.keys(cfg.checks || {});
  const checks = Object.entries(i.checks || {}).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([c, k]) => {
    const v = share(k);
    return `<tr><th>${esc(checkName(c))}</th><td>${dot(light(v, cfg))} ${fmt(v)}</td><td class="muted small">${esc(t("svc_chk_counts", { p: k.pass, h: k.partial, f: k.fail }))}</td></tr>`;
  }).join("");
  const hosts = (i.service_hosts || []).slice().sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101)).map((h) =>
    `<tr><td>${esc(h.host)}${h.ko ? ` <span class="tag red">${esc(t("tag_ko"))}</span>` : ""}</td><td>${dot(light(h.overall, cfg))} ${fmt(h.overall)}</td>
      <td>${h.key ? `<button class="link" data-ev="${esc(h.host)}" data-evkey="${esc(h.key)}" aria-expanded="false">${esc(t("ev_open"))}</button>` : ""}</td></tr>`).join("");
  return `<h3>${esc(t("svc_cats"))}</h3><table class="deps"><tbody>${cats}</tbody></table>
    <h3>${esc(t("svc_checks"))}</h3><table class="deps"><tbody>${checks}</tbody></table>
    <h3>${esc(t("svc_hosts"))}</h3><table class="hosts"><tbody>${hosts}</tbody></table>`;
}

// who uses a service: counts per level and the list with role and evidence
export const use = (i) => `<p>${users(i.users)}</p>${usersList(i.users_list)}`;
export const sourceLine = (i) => `<p class="muted small">${esc(t("checked_on", { d: date(i.checked) }))} · ${esc(t("sources"))}: ${src(i.sources)}</p>`;

// a register of a block: providers recognised under ZertES (Swiss Trusted List),
// recognised delivery platforms (BJ) or qualified vLEI issuers (GLEIF)
function register(r) {
  if (r && r.kind === "swiyu") return swiyuRegister(r);
  if (!r || !(r.providers || []).length) return "";
  const svc = (s) => `${esc(t("kind_" + s.kind) || s.kind)}${(s.for || []).length ? " (" + s.for.map((f) => esc(t("for_" + f))).join(", ") + ")" : ""}`;
  const rows = r.providers.map((p) => {
    const kinds = {};
    p.services.forEach((s) => { const k = svc(s); kinds[k] = (kinds[k] || 0) + 1; });
    return `<tr><th>${uidName(p.uid, p.name, UIDS)}${p.trade_names && p.trade_names.length ? `<div class="muted small">${esc(p.trade_names.join(", "))}</div>` : ""}
      ${p.uid ? `<div class="muted small">${esc(t("reg_uid"))} ${uidRef(p.uid, UIDS)}</div>` : ""}
      ${p.lei ? `<div class="muted small">LEI <a href="${esc(p.src)}" rel="noopener">${esc(p.lei)}</a>${p.country ? " · " + esc(p.country) : ""}</div>` : ""}</th>
      <td>${r.kind === "vlei" ? esc(t("reg_qualified", { d: date(p.services[0].since) })) : Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join("<br>")}${p.withdrawn ? `<div class="muted small">${esc(t("reg_withdrawn", { n: p.withdrawn }))}</div>` : ""}</td></tr>`;
  }).join("");
  const k = r.kind || "zertes";
  return `<section><h2>${esc(t("reg_title_" + k))}</h2><p>${esc(t("reg_intro_" + k))}${k === "vlei" && !r.providers.some((p) => p.country === "CH") ? " " + esc(t("reg_vlei_no_ch")) : ""}</p>
    <table class="deps"><thead><tr><th></th><td>${esc(t("reg_services"))}</td></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">${esc(r.sequence ? t("reg_list", { s: r.sequence, d: date(r.issued), n: date(r.next_update) })
      : r.issued ? t("reg_recognised", { d: date(r.issued), c: date(r.checked) }) : t("reg_fetched", { c: date(r.checked) }))} · ${esc(t("sources"))}:
      <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.title)}</a> · <a href="${esc(r.rules)}" rel="noopener">${esc(t("reg_rules"))}</a>${r.api ? ` · <a href="${esc(r.api)}" rel="noopener">API</a>` : ""}</p></section>`;
}

// participants and verifiers of the swiyu Trust Registry, per environment, as tables
export const useUids = (set) => { UIDS = set; };
// opts.tabs: the environment shown first, the others behind a selector; opts.full: no folded tables
export function swiyuRegister(r, only, opts = {}) {
  const didEnd = (d) => (d || "").split(":").pop().slice(0, 8);
  const pname = (x) => (x.name || {})[LANG] || (x.name || {}).de || (x.name || {}).en || x.scope;
  const envs = Object.entries(r.envs || {}).filter(([env]) => !only || env === only).map(([env, e]) => {
    // one row per registered party (DID), with its verification purposes; verifiers without an identity entry too
    const vby = Object.fromEntries((e.verifiers || []).map((v) => [v.did, v]));
    const ps = r.providers.filter((p) => p.env === env);
    const seen = new Set(ps.map((p) => p.did));
    const rows = [...ps.map((p) => ({ p, v: vby[p.did] })), ...(e.verifiers || []).filter((v) => !seen.has(v.did)).map((v) => ({ p: null, v }))];
    const cell = (k, html, cls = "") => `<td data-k="${esc(String(k ?? ""))}"${cls ? ` class="${cls}"` : ""}>${html}</td>`;
    const body = rows.map(({ p, v }) => {
      const name = p ? p.name : v.name || t("reg_swiyu_unnamed");
      const roles = p ? (p.roles || []).map((x) => t("role_" + x)).join(", ") : t("role_verifier");
      // several scopes can carry the same purpose name: each name once
      const purposes = v ? [...new Set(v.purposes.map(pname))].join(", ") : "";
      return `<tr>${cell(name.toLowerCase(), p ? uidName(p.uid, p.name, UIDS) : `<span class="muted">${esc(name)}</span>`)}
        ${cell(roles, `${esc(roles)}${p && (p.issues || []).length ? `<div class="muted small">${esc(p.issues.join(", "))}</div>` : ""}`)}
        ${cell(p && p.uid, p && p.uid ? uidRef(p.uid, UIDS) : "–")}
        ${cell(p && p.state_actor ? 1 : 0, p && p.state_actor ? esc(t("yes")) : "")}
        ${cell(p ? p.services[0].since : "", p ? esc(date(p.services[0].since)) : "–")}
        ${cell(p ? p.did : v.did, `<span title="${esc(p ? p.did : v.did)}">…${esc(didEnd(p ? p.did : v.did))}</span>`, "mono small")}
        ${cell(p ? 1 : 0, p ? `<a href="${esc(p.src)}" rel="noopener">${esc(t("reg_swiyu_statement"))}</a>` : "–")}
        ${cell(purposes.toLowerCase(), esc(purposes))}
        ${cell(v ? v.statements : 0, v ? `<a href="${esc(v.src)}" rel="noopener">${esc(t("reg_swiyu_n", { n: v.statements }))}</a>` : "")}</tr>`;
    }).join("");
    const cols = [t("col_name"), t("col_role"), t("reg_uid"), t("reg_swiyu_state"), t("col_since"), "DID", t("col_source"), t("col_purposes"), t("col_purpose_src")];
    const head = `<thead><tr>${cols.map((c, n) => `<th><button class="link sort" data-sort="${n}">${esc(c)}</button></th>`).join("")}</tr></thead>`;
    return `<div data-regenv="${esc(env)}"${opts.tabs && env !== opts.tabs ? " hidden" : ""}>${opts.tabs ? "" : `<h3>${esc(t("env_" + env))}</h3>`}
      <p>${esc(t("reg_swiyu_counts", { n: e.participants, u: e.unnamed }))} · ${esc(t("reg_swiyu_vcount", { n: (e.verifiers || []).length }))} · <a href="${esc(e.api)}" rel="noopener">API</a></p>
      <p><input type="search" class="regq" data-regq placeholder="${esc(t("reg_search"))}" aria-label="${esc(t("reg_search"))}"> <span class="muted small" data-regn>${rows.length}</span></p>
      <div class="tblwrap"><table class="cnt reg" data-regtable>${head}<tbody>${body}</tbody></table></div></div>`;
  }).join("");
  const tabs = opts.tabs ? `<div class="tabs">${Object.keys(r.envs || {}).map((env) => `<a class="tab${env === opts.tabs ? " on" : ""}" href="#" data-regtab="${esc(env)}">${esc(t("env_" + env))}</a>`).join("")}</div>` : "";
  return `<section><h2>${esc(t("reg_title_swiyu"))}</h2><p>${esc(t("reg_intro_swiyu"))}</p>${tabs}${envs}
    <p class="muted small">${esc(t("reg_fetched", { c: date(r.checked) }))} · ${esc(t("sources"))}: <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.title)}</a></p></section>`;
}

// sorting by a column (click again: reverse) and searching in the register tables
export function bindRegTables(el) {
  el.querySelectorAll("[data-regtable]").forEach((tb) => {
    const body = tb.tBodies[0];
    tb.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      const n = +b.dataset.sort, dir = b.dataset.dir === "asc" ? -1 : 1;
      tb.querySelectorAll("[data-sort]").forEach((x) => { delete x.dataset.dir; x.removeAttribute("aria-sort"); });
      b.dataset.dir = dir === 1 ? "asc" : "desc";
      b.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
      const key = (tr) => tr.children[n].dataset.k;
      const num = [...body.rows].every((tr) => key(tr) === "" || !isNaN(+key(tr)));
      [...body.rows].sort((a, c) => dir * (num ? (+key(a) || 0) - (+key(c) || 0) : key(a).localeCompare(key(c))))
        .forEach((tr) => body.appendChild(tr));
    }));
    const box = tb.closest("[data-regenv]") || el;
    const q = box.querySelector("[data-regq]"), cnt = box.querySelector("[data-regn]");
    if (q) q.addEventListener("input", () => {
      const s = q.value.trim().toLowerCase();
      let n = 0;
      [...body.rows].forEach((tr) => { const hit = !s || tr.textContent.toLowerCase().includes(s) || tr.children[5].dataset.k.toLowerCase().includes(s); tr.hidden = !hit; n += hit; });
      if (cnt) cnt.textContent = n;
    });
  });
}

// the selector between the environments of the register
export function bindRegTabs(el) {
  el.querySelectorAll("[data-regtab]").forEach((a) => a.addEventListener("click", (ev) => {
    ev.preventDefault();
    el.querySelectorAll("[data-regtab]").forEach((x) => x.classList.toggle("on", x.dataset.regtab === a.dataset.regtab));
    el.querySelectorAll("[data-regenv]").forEach((d) => { d.hidden = d.dataset.regenv !== a.dataset.regtab; });
  }));
}

// a block whose services are one service and its other environments (swiyu with its sandbox), with
// no alternatives and no register of its own: its page is the page of that service (#/dienst/<id>)
export function blockService(b) {
  const ids = [...new Set((b.implementations || []).map((i) => i.id))].sort((x, y) => x.length - y.length);
  if (!ids.length || (b.alternatives || []).length || (b.register && b.register.kind !== "swiyu")) return null;
  return ids.every((i) => i === ids[0] || i.startsWith(ids[0] + "-")) ? ids[0] : null;
}

// the legal bases concerning this block (governance.json)
export function legal(gov, key) {
  const laws = (gov.laws || []).filter((l) => l.blocks.includes(key) && l.level !== "canton");
  const kt = [...new Set((gov.laws || []).filter((l) => l.blocks.includes(key) && l.level === "canton").map((l) => l.canton))].sort();
  if (!laws.length && !kt.length) return "";
  return `<section><h2>${esc(t("gov_for_block"))}</h2>${laws.map((l) =>
    `<h3><a href="#/governance/${encodeURIComponent(l.id)}">${esc(lawText(l, "abbr"))}</a> <span class="badge ${l.status === "in_force" ? "ok" : "wait"}">${esc(statusWord(l))}</span></h3>
     <table class="deps gov"><tbody>${provisionRows(l, key)}</tbody></table>`).join("")}
    ${kt.length ? `<p><a href="#/governance?blk=${encodeURIComponent(key)}">${esc(t("gov_cantonal_box", { c: kt.join(", ") }))} ›</a></p>` : ""}</section>`;
}

export async function render(el, params) {
  const key = params.key || "";
  const [inf, meta, gov, uids] = await Promise.all([data.infrastructure(), data.meta(), data.governance().catch(() => ({ laws: [] })), data.uids()]);
  UIDS = uids;
  const [lid] = key.split(".");
  const layer = (meta.model.layer || []).find((L) => L.id === lid);
  if (!layer || !BLOCKS[key]) {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(key)}</p></section>`;
    return;
  }
  const b = (inf.blocks || {})[key] || { implementations: [], alternatives: [] };
  const single = blockService(b);
  if (single) { location.replace(`#/dienst/${encodeURIComponent(single)}`); return; }
  const cfg = meta.cfg;
  // the block lists its services; posture, use and map are on the page of each service
  const one = (i) => `<section class="imp" data-svc="${esc(i.id)}"><h3 class="imp-name"><a href="#/dienst/${encodeURIComponent(i.id)}">${esc(i.name)}</a></h3>${envBadge(i)}
      <p class="sub">${esc(tx(i, "operator") || "")}${i.role ? " · " + linkSwiyu(tx(i, "role"), i.id) : ""}</p>
      <p><span class="muted">${esc(t("svc_posture"))}:</span> ${i.hosts ? `${dot(light(i.overall, cfg))} <b>${fmt(i.overall)}</b> ${esc(t("mean_of_hosts", { n: i.hosts }))}` : `<span class="muted">${esc(t("no_hosts"))}</span>`}</p>
      <p><span class="muted">${esc(t("svc_use"))}:</span> ${users(i.users)}</p>
      <p><a href="#/dienst/${encodeURIComponent(i.id)}">${esc(t("svc_page"))} ›</a></p></section>`;
  // the identity block in its aspects: identity, authentication, authority, agency are distinct functions
  const aspects = key === "dpi.identity"
    ? Object.entries(inf.aspects || {}).map(([a, label]) => [a, ((inf.aspects_i18n || {})[LANG] || {})[a] || label]) : [];
  const imps = aspects.length
    ? aspects.map(([a, label]) => {
        const list = b.implementations.filter((i) => i.aspect === a);
        return `<section class="aspect"><h2 class="asp">${esc(label)}</h2><p class="sub">${esc(t("aspect_" + a))}</p>
          ${list.length ? list.map(one).join("") : `<p class="muted">${esc(t("no_implementation"))}</p>`}</section>`;
      }).join("") + `<p class="muted small">${esc(t("aspects_note"))} ${esc(t("sources"))}: ${src(inf.aspect_sources)}</p>`
    : b.implementations.map(one).join("");
  const alt = (b.alternatives || []).length ? `<section><h2>${esc(t("instead"))}</h2><table class="deps"><tbody>${b.alternatives.map((a) =>
    `<tr><th><a href="#/anbieter/${encodeURIComponent(a.id)}">${esc(a.name)}</a> ${cc(a.country)}</th><td>${users(a.users)}</td></tr>`).join("")}</tbody></table></section>` : "";
  // swiyu: all registered parties of one environment on the map (issuers and verifiers)
  let swyMap = null, swyEnv = "";
  if (b.register && b.register.kind === "swiyu") {
    const ix = await data.index();
    const envs = Object.keys(b.register.envs || {});
    swyEnv = envs.includes(params.env) ? params.env : envs.includes("production") ? "production" : envs[0];
    const imp = b.implementations.find((i) => i.environment === swyEnv) || { users_list: [] };
    const keys = (imp.users_list || []).filter((u) => u.role !== "hint" && u.role !== "law").map((u) => u.key);
    swyMap = await usersMap(keys, ix, swiyuExtra(b.register, swyEnv, keys, ix, UIDS));
    swyMap.envs = envs;
  }
  const swyHtml = swyMap ? `<section><h2>${esc(t("um_overview_swiyu"))}</h2>
      <div class="tabs">${swyMap.envs.map((e) => `<a class="tab${e === swyEnv ? " on" : ""}" href="#/baustein/${encodeURIComponent(key)}?env=${e}">${esc(t("env_" + e))}</a>`).join("")}</div>
      ${swyMap.html}</section>` : "";
  const grp = layer.group && GROUPS[layer.group];
  el.innerHTML = `<section class="lead org"><div class="kind">${esc(grp ? grp.name : "")} · ${esc(LAYERS[lid].name)}</div>
      <h1>${esc(BLOCKS[key])}</h1><p>${esc(LAYERS[lid].hint)}</p>
      ${{ "dpi.identity": "def_identity", "dpi.authentication": "def_authentication" }[key] ? `<p><b>${esc(t({ "dpi.identity": "def_identity", "dpi.authentication": "def_authentication" }[key]))}</b></p>` : ""}
      ${BLOCK_WHAT[key] ? `<p class="sub">${esc(t("measured_as"))}: ${esc(BLOCK_WHAT[key])}</p>` : ""}
      ${inf.source ? `<p class="muted small">${esc(t("dpi_term"))}: <a href="${esc(inf.source.url)}" rel="noopener">${esc(tx(inf.source, "title"))}</a></p>` : ""}
      <p><a href="#/">← ${esc(t("overview"))}</a>${BLOCK_WHAT[key] && layer.blocks.find((x) => `${lid}.${x.id}` === key && !x.none) ? ` · <a href="#/karte/${encodeURIComponent("blk:" + key)}">${esc(t("on_map"))}</a>` : ""}</p></section>
    ${imps || (b.register ? "" : `<p class="muted">${esc(t("no_implementation"))}</p>`)}${swyHtml}${register(b.register)}${alt}${legal(gov, key)}`;
  if (swyMap) swyMap.bind(el);
}

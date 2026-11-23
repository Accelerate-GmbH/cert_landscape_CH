// A building block of the digital public infrastructure (#/baustein/<layer.block>):
// its services with value and use in short, each linking to its own page
// (#/dienst/<id>, service.js); for identity also the foreign login providers used
// instead; registers and legal bases. Reads infrastructure.json; every
// implementation carries its sources.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, GROUPS, LEVELS, LANG, t, tx } from "../text.js";
import { esc, fmt, light, dot, cc, uidName, uidRef } from "../ui.js";

let UIDS = new Set();
import { provisionRows, statusWord, lawText } from "./gov.js";

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
export function posture(i, cfg) {
  const rest = REST.map((c) => {
    const rows = (i.rests_on || {})[c] || [];
    return rows.length ? `<tr><th>${esc(t("rest_" + c))}</th><td>${rows.map((r) => `${dot(STATUS[r.status] || "none")} ${esc(r.value || t("not_checked"))} <span class="muted small">${r.hosts} ${esc(t("hosts"))}</span>`).join("<br>")}</td></tr>` : "";
  }).join("");
  return `<p>${i.hosts ? `${dot(light(i.overall, cfg))} <b>${fmt(i.overall)}</b> ${esc(t("mean_of_hosts", { n: i.hosts }))}` : `<span class="muted">${esc(t("no_hosts"))}</span>`}</p>
      <p class="muted small">${i.host_roles && i.classified ? esc(t("host_roles", { s: i.host_roles.service, i: i.host_roles.info, t: i.host_roles.test, d: date(i.classified) })
          + (i.host_roles.other ? " " + t("host_other", { o: i.host_roles.other }) : ""))
        : i.hosts ? esc(t("unclassified")) : ""}</p>
      ${rest ? `<h3>${esc(t("rests_on"))}</h3><table class="deps"><tbody>${rest}</tbody></table>` : ""}
      ${i.examples && i.examples.length ? `<p class="muted small">${esc(t("measured_hosts"))}: ${i.examples.map(esc).join(", ")}${i.hosts > i.examples.length ? " …" : ""}</p>` : ""}`;
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
export function swiyuRegister(r, only) {
  const didEnd = (d) => (d || "").split(":").pop().slice(0, 8);
  const envs = Object.entries(r.envs || {}).filter(([env]) => !only || env === only).map(([env, e]) => {
    const ps = r.providers.filter((p) => p.env === env);
    const rows = ps.map((p) => `<tr><th>${uidName(p.uid, p.name, UIDS)}</th><td>${p.uid ? uidRef(p.uid, UIDS) : "–"}</td>
      <td>${p.state_actor ? esc(t("yes")) : ""}</td><td>${esc(date(p.services[0].since))}</td>
      <td class="mono small" title="${esc(p.did)}">…${esc(didEnd(p.did))}</td><td><a href="${esc(p.src)}" rel="noopener">${esc(t("reg_swiyu_statement"))}</a></td></tr>`).join("");
    const head = `<thead><tr><th>${esc(t("col_name"))}</th><th>${esc(t("reg_uid"))}</th><th>${esc(t("reg_swiyu_state"))}</th><th>${esc(t("col_since"))}</th><th>DID</th><th>${esc(t("col_source"))}</th></tr></thead>`;
    const table = rows ? `<div class="tblwrap"><table class="cnt reg">${head}<tbody>${rows}</tbody></table></div>` : "";
    const vs = (e.verifiers || []).map((v) => `<tr><th>${v.name ? esc(v.name) : `<span class="muted">${esc(t("reg_swiyu_unnamed"))}</span>`}</th>
      <td>${v.purposes.map((x) => esc((x.name || {})[LANG] || (x.name || {}).de || (x.name || {}).en || x.scope)).join(", ")}</td>
      <td>${v.statements}</td><td><a href="${esc(v.src)}" rel="noopener">${esc(t("reg_swiyu_statement"))}</a></td></tr>`).join("");
    const vhead = `<thead><tr><th>${esc(t("col_name"))}</th><th>${esc(t("col_purposes"))}</th><th>${esc(t("col_statements"))}</th><th>${esc(t("col_source"))}</th></tr></thead>`;
    return `<h3>${esc(t("env_" + env))}</h3><p>${esc(t("reg_swiyu_counts", { n: e.participants, u: e.unnamed }))} · <a href="${esc(e.api)}" rel="noopener">API</a></p>
      ${ps.length > 30 ? `<details><summary>${esc(t("reg_swiyu_show", { n: ps.length }))}</summary>${table}</details>` : table}
      ${vs ? `<h4>${esc(t("reg_swiyu_verifiers"))}</h4><div class="tblwrap"><table class="cnt reg">${vhead}<tbody>${vs}</tbody></table></div>` : ""}`;
  }).join("");
  return `<section><h2>${esc(t("reg_title_swiyu"))}</h2><p>${esc(t("reg_intro_swiyu"))}</p>${envs}
    <p class="muted small">${esc(t("reg_fetched", { c: date(r.checked) }))} · ${esc(t("sources"))}: <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.title)}</a></p></section>`;
}

// the legal bases concerning this block (governance.json)
function legal(gov, key) {
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
  const grp = layer.group && GROUPS[layer.group];
  el.innerHTML = `<section class="lead org"><div class="kind">${esc(grp ? grp.name : "")} · ${esc(LAYERS[lid].name)}</div>
      <h1>${esc(BLOCKS[key])}</h1><p>${esc(LAYERS[lid].hint)}</p>
      ${{ "dpi.identity": "def_identity", "dpi.authentication": "def_authentication" }[key] ? `<p><b>${esc(t({ "dpi.identity": "def_identity", "dpi.authentication": "def_authentication" }[key]))}</b></p>` : ""}
      ${BLOCK_WHAT[key] ? `<p class="sub">${esc(t("measured_as"))}: ${esc(BLOCK_WHAT[key])}</p>` : ""}
      ${inf.source ? `<p class="muted small">${esc(t("dpi_term"))}: <a href="${esc(inf.source.url)}" rel="noopener">${esc(tx(inf.source, "title"))}</a></p>` : ""}
      <p><a href="#/">← ${esc(t("overview"))}</a>${BLOCK_WHAT[key] && layer.blocks.find((x) => `${lid}.${x.id}` === key && !x.none) ? ` · <a href="#/karte/${encodeURIComponent("blk:" + key)}">${esc(t("on_map"))}</a>` : ""}</p></section>
    ${imps || (b.register ? "" : `<p class="muted">${esc(t("no_implementation"))}</p>`)}${register(b.register)}${alt}${legal(gov, key)}`;
}

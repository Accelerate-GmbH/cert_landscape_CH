// A building block of the digital public infrastructure (#/baustein/<layer.block>):
// its implementations with what their hosts rest on (CA, DNS, hosting, registrar)
// and who is seen to use them; for identity also the foreign login providers used
// instead. Reads infrastructure.json; every implementation carries its sources.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, GROUPS, LEVELS, LANG, t, tx } from "../text.js";
import { esc, fmt, light, dot, cc } from "../ui.js";
import { provisionRows, statusWord, lawText } from "./gov.js";

const REST = ["sov.ca", "sov.dns", "sov.hosting", "sov.registrar"];
const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const src = (list) => (list || []).map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`).join(" · ");
const STATUS = { pass: "green", partial: "yellow", fail: "red" };

function users(u) {
  const parts = LEVELS.filter(([k]) => u && u[k]).map(([k, nm]) => `${esc(nm)} ${u[k]}`);
  return parts.length ? parts.join(" · ") : `<span class="muted">${esc(t("users_none"))}</span>`;
}

// providers recognised under ZertES (Swiss Trusted List), for seals and time stamps
function register(r) {
  if (!r || !(r.providers || []).length) return "";
  const svc = (s) => `${esc(t("kind_" + s.kind) || s.kind)}${(s.for || []).length ? " (" + s.for.map((f) => esc(t("for_" + f))).join(", ") + ")" : ""}`;
  const rows = r.providers.map((p) => {
    const kinds = {};
    p.services.forEach((s) => { const k = svc(s); kinds[k] = (kinds[k] || 0) + 1; });
    return `<tr><th>${esc(p.name)}${p.trade_names && p.trade_names.length ? `<div class="muted small">${esc(p.trade_names.join(", "))}</div>` : ""}
      ${p.uid ? `<div class="muted small">${esc(t("reg_uid"))} ${esc(p.uid)}</div>` : ""}</th>
      <td>${Object.entries(kinds).map(([k, n]) => `${k}: ${n}`).join("<br>")}${p.withdrawn ? `<div class="muted small">${esc(t("reg_withdrawn", { n: p.withdrawn }))}</div>` : ""}</td></tr>`;
  }).join("");
  return `<section><h2>${esc(t("reg_title"))}</h2><p>${esc(t("reg_intro"))}</p>
    <table class="deps"><thead><tr><th></th><td>${esc(t("reg_services"))}</td></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted small">${esc(t("reg_list", { s: r.sequence, d: date(r.issued), n: date(r.next_update) }))} · ${esc(t("sources"))}:
      <a href="${esc(r.source.url)}" rel="noopener">${esc(r.source.title)}</a> · <a href="${esc(r.rules)}" rel="noopener">${esc(t("reg_rules"))}</a></p></section>`;
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
  const [inf, meta, gov] = await Promise.all([data.infrastructure(), data.meta(), data.governance().catch(() => ({ laws: [] }))]);
  const [lid] = key.split(".");
  const layer = (meta.model.layer || []).find((L) => L.id === lid);
  if (!layer || !BLOCKS[key]) {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(key)}</p></section>`;
    return;
  }
  const b = (inf.blocks || {})[key] || { implementations: [], alternatives: [] };
  const cfg = meta.cfg;
  const one = (i) => {
    const rest = REST.map((c) => {
      const rows = (i.rests_on || {})[c] || [];
      return rows.length ? `<tr><th>${esc(t("rest_" + c))}</th><td>${rows.map((r) => `${dot(STATUS[r.status] || "none")} ${esc(r.value || t("not_checked"))} <span class="muted small">${r.hosts} ${esc(t("hosts"))}</span>`).join("<br>")}</td></tr>` : "";
    }).join("");
    return `<section class="imp"><h3 class="imp-name">${esc(i.name)}</h3>
      <p class="sub">${esc(tx(i, "operator") || "")}${i.role ? " · " + esc(tx(i, "role")) : ""}</p>
      <p>${i.hosts ? `${dot(light(i.overall, cfg))} <b>${fmt(i.overall)}</b> ${esc(t("mean_of_hosts", { n: i.hosts }))}` : `<span class="muted">${esc(t("no_hosts"))}</span>`}</p>
      <p class="muted small">${i.host_roles ? esc(t("host_roles", { s: i.host_roles.service, i: i.host_roles.info, t: i.host_roles.test, d: date(i.classified) })
          + (i.host_roles.other ? " " + t("host_other", { o: i.host_roles.other }) : ""))
        : i.hosts ? esc(t("unclassified")) : ""}</p>
      ${rest ? `<h3>${esc(t("rests_on"))}</h3><table class="deps"><tbody>${rest}</tbody></table>` : ""}
      ${i.examples && i.examples.length ? `<p class="muted small">${esc(t("measured_hosts"))}: ${i.examples.map(esc).join(", ")}${i.hosts > i.examples.length ? " …" : ""}</p>` : ""}
      <h3>${esc(t("used_by"))}</h3><p>${users(i.users)}</p>
      <p class="muted small">${esc(t("checked_on", { d: date(i.checked) }))} · ${esc(t("sources"))}: ${src(i.sources)}</p></section>`;
  };
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
      ${BLOCK_WHAT[key] ? `<p class="sub">${esc(t("measured_as"))}: ${esc(BLOCK_WHAT[key])}</p>` : ""}
      ${inf.source ? `<p class="muted small">${esc(t("dpi_term"))}: <a href="${esc(inf.source.url)}" rel="noopener">${esc(tx(inf.source, "title"))}</a></p>` : ""}
      <p><a href="#/">← ${esc(t("overview"))}</a>${BLOCK_WHAT[key] && layer.blocks.find((x) => `${lid}.${x.id}` === key && !x.none) ? ` · <a href="#/karte/${encodeURIComponent("blk:" + key)}">${esc(t("on_map"))}</a>` : ""}</p></section>
    ${imps || (b.register ? "" : `<p class="muted">${esc(t("no_implementation"))}</p>`)}${register(b.register)}${alt}${legal(gov, key)}`;
}

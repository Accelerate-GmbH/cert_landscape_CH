// «Meine Organisation»: the entity's own layers against the best of its level,
// the weakest checks as next steps, dependencies and the weakest services.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, LEVEL_ONE, LEVEL_MANY, LEVEL_DAT, APPS, CATS, WHY, checkName, checkText, t, tx } from "../text.js";
import { esc, fmt, light, dot, bar, cc, uidLink, store, HOME_KEY, LIGHT_WORD } from "../ui.js";
import * as trend from "./trend.js";
import * as evid from "./evidence.js";

const ORDER = ["apps", "dpi", "ext", "trust", "cloud", "net"];
const share = (k) => {
  if (!k) return null;
  const n = k.assessed ?? (k.pass || 0) + (k.partial || 0) + (k.fail || 0);
  return n ? (100 * ((k.pass || 0) + 0.5 * (k.partial || 0))) / n : null;
};

export async function render(el, params, role) {
  const key = params.key || store.get(HOME_KEY);
  if (!key) {
    el.innerHTML = `<section class="lead"><h1>${esc(t("my_org"))}</h1><p>${esc(t("my_org_intro"))}</p></section>`;
    return;
  }
  let d;
  try {
    d = await data.entity(key);
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(key)}</p></section>`;
    return;
  }
  const [meta, bm, hist, dir, idx] = await Promise.all([data.meta(), data.benchmarks(), data.history(d.key).catch(() => null), data.providers().catch(() => null),
    d.parent ? data.index().catch(() => null) : null]);
  // an office: its department, and the source of its name (Annex 1 RVOV)
  const parentName = d.parent ? ((idx && idx.rows.find((r) => r[0] === d.parent)) || [])[1] || d.parent.split(":")[1] : "";
  const ofLine = d.parent ? ` · ${esc(t("office_of"))} <a href="#/org/${encodeURIComponent(d.parent)}">${esc(parentName)}</a>`
    + (d.office ? ` · <a href="${esc(d.office.src)}" rel="noopener" title="${esc(t("office_src"))}">${esc(tx(d.office, "abbr"))}</a>` : "") : "";
  const provId = new Map((dir ? dir.rows : []).map((r) => [r.name, r.id]));
  const cfg = meta.cfg, B = bm[d.kind] || {};
  const p = d.posture || {};
  const home = store.get(HOME_KEY) === d.key;
  // the best 5 % by their mean (a threshold is often 0 or 100 because many share it); the single best where the group is small
  const bestLabel = (b) => (!b ? "" : b.mode === "top" ? t("best_top", { p: Math.round(b.share * 100) }) : t("best_one"));
  const bestVal = (b) => (!b ? null : b.mode === "top" ? b.mean : b.value);
  const bo = B.overall;

  const head = `<section class="lead org">
    <div class="kind">${esc(LEVEL_ONE[d.kind] || d.kind)}${ofLine}${d.canton ? " · " + esc(d.canton) : ""}${d.sector ? " · " + esc(d.kind === "education" ? [t("edu_" + d.sector), d.subsector ? t("edu_" + d.subsector) : ""].filter(Boolean).join(", ") : d.sector) : ""}</div>
    <h1>${esc(d.office ? tx(d.office, "name") : d.name)}</h1>
    <p class="sub">${d.uid ? uidLink(d.uid) + (d.uid_name ? " · " + esc(d.uid_name) : "") + " · " : ""}${esc((d.domains || []).slice(0, 4).join(", "))}</p>
    ${d.identity ? `<p class="sub">${esc(t("lei"))} <a href="${esc(d.identity.src)}" rel="noopener">${esc(d.identity.lei)}</a>
      · ${esc(d.identity.registration_status === "ISSUED" ? t("lei_valid", { d: (d.identity.next_renewal || "").split("-").reverse().map(Number).join(".") }) : t("lei_lapsed"))}</p>` : ""}
    ${(d.swiyu || []).length ? `<p class="sub">${esc(t("org_swiyu"))}: ${d.swiyu.map((x) => `<a href="${esc(x.src)}" rel="noopener">${esc(t("env_" + x.env))}</a>`).join(", ")} · <a href="#/baustein/trust.swiyu">swiyu</a></p>` : ""}
    <div class="actions"><button class="home${home ? " on" : ""}" data-home="${esc(d.key)}">${esc(home ? t("home_set") : t("home_make"))}</button>
    <a class="tocmp" href="#/vergleich/${encodeURIComponent(d.key)}">${esc(t("to_compare"))}</a>
    <a class="tocmp" href="#/org/${encodeURIComponent(d.key)}/bericht">${esc(t("rep_link"))}</a>
    ${d.canton ? `<a class="tocmp" href="#/governance?canton=${encodeURIComponent(d.canton)}">${esc(t("gov_for_org"))}</a>` : ""}</div>
  </section>`;

  const verdict = p.overall === null || p.overall === undefined
    ? `<section class="verdict none"><p>${esc(t("no_rating", { r: d.no_data || t("no_rating_default") }))}</p></section>`
    : `<section class="verdict ${light(p.overall, cfg)}">
      <div class="big">${fmt(p.overall)}<small>/100</small></div>
      <div><div class="vt">${esc(LIGHT_WORD[light(p.overall, cfg)])}</div>
        <div class="sub">${esc(t("services_checked", { n: p.resources || 0 }))}${p.knockouts ? ` · ${esc(t("with_ko", { n: p.knockouts }))}` : ""}</div>
        ${bo ? `<div class="sub">${esc(bo.mode === "top" ? t("top_reach", { p: Math.round(bo.share * 100), lv: LEVEL_MANY[d.kind], v: fmt(bo.value) }) : t("best_value", { lv: LEVEL_DAT[d.kind], v: fmt(bo.value) }))}</div>` : ""}
      </div></section>`;

  // drill-down: a building block leads to the hosts that fail its checks, to the
  // mail values per domain, or to the dependencies it is measured from
  const drillAttr = (b) => (b.checks && b.checks.length ? `data-fail="${esc(b.checks.join(","))}" role="button" tabindex="0"`
    : b.mail ? `data-jump="mailsrc" role="button" tabindex="0"` : b.deps ? `data-jump="depsec" role="button" tabindex="0"` : "");
  // the layer model with the entity's own values and the benchmark
  const layers = ORDER.map((lid) => {
    const L = meta.model.layer.find((x) => x.id === lid);
    const blocks = L.blocks.map((b) => {
      const k = `${lid}.${b.id}`, v = (d.layers[lid] || {})[b.id] || {};
      if (v.m === "none") return `<div class="block unmeasured"><div class="bn">${esc(BLOCKS[k])}</div><div class="bv muted">${esc(t("not_measured"))}</div></div>`;
      if (v.m === "count") {
        const apps = Object.entries(d.dependencies.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
        return `<div class="block none drill" ${drillAttr(b)}><div class="bn">${esc(BLOCKS[k])}</div><div class="bs">${apps.map(([a, n]) => `${esc(APPS[a] || a)} ${n}`).join(" · ") || "–"}</div></div>`;
      }
      const bb = B["blk:" + k];
      const l = light(v.v, cfg);
      return `<div class="block ${l}${drillAttr(b) ? " drill" : ""}" ${drillAttr(b)} title="${esc(BLOCK_WHAT[k] || "")}"><div class="bn">${esc(BLOCKS[k])}</div>
        <div class="bv">${v.v === null || v.v === undefined ? "" : `${dot(l)} <b>${fmt(v.v)}</b>`}${bb ? `<span class="bb"> · ${bestLabel(bb)} ${fmt(bestVal(bb))}</span>` : ""}</div>
        ${v.v !== null && v.v !== undefined ? bar(v.v, bestVal(bb), bestLabel(bb)) : `<div class="bs muted">${esc(t("no_data_yet"))}</div>`}</div>`;
    }).join("");
    return `<div class="layer ${lid}${L.group ? " " + L.group : ""}"><div class="ln"><b>${esc(LAYERS[lid].name)}</b></div>
      <div class="blocks" style="--n:${L.blocks.length}">${blocks}</div></div>`;
  }).join("");

  // where the values come from (entity "src"): evidence per host and the rating rules
  const src = d.src || {};
  // next steps: the weakest checks, with the reason for the chosen role and why it matters
  const checks = Object.entries(p.checks || {}).map(([id, k]) => [id, share(k), k]).filter(([, v]) => v !== null);
  const mailChecks = Object.entries((d.mail || {}).checks || {}).map(([id, k]) => [id, share(k), k]).filter(([, v]) => v !== null);
  const cat = (id) => (id.startsWith("mail.") ? "mail" : { own: "ownership", sov: "sovereignty", sec: "security", prv: "privacy" }[id.split(".")[0]]);
  const weakest = [...checks, ...mailChecks].filter(([, v]) => v < (cfg.green || 80)).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const steps = weakest.length
    ? `<ol class="steps">${weakest.map(([id, v]) => {
        const bb = B["chk:" + id];
        return `<li><div class="st">${dot(light(v, cfg))} <b>${esc(checkName(id))}</b> <span class="muted">${fmt(v)} %${bb ? ` · ${bestLabel(bb)}: ${fmt(bestVal(bb))} %` : ""}</span></div>
          <p>${esc(checkText(id, role))}</p><p class="why">${esc(WHY[cat(id)] || "")}</p>
          <p class="small">${id.startsWith("mail.") ? `<a href="#mailsrc" data-jump="mailsrc">${esc(t("src_mail_values"))}</a>` : `<button class="link" data-fail="${esc(id)}">${esc(t("src_hosts"))}</button>`}
            ${src[id.startsWith("mail.") ? "mail" : "checks"] ? ` · <a href="${esc(src[id.startsWith("mail.") ? "mail" : "checks"])}" rel="noopener">${esc(t("src_rule"))}</a>` : ""}</p></li>`;
      }).join("")}</ol>`
    : `<p>${esc(t("none_below", { g: cfg.green || 80 }))}</p>`;

  const PREFIX = { ownership: "own.", sovereignty: "sov.", security: "sec.", privacy: "prv." };
  const catChecks = (c) => Object.keys(p.checks || {}).filter((id) => id.startsWith(PREFIX[c] || "-")).join(",");
  const cats = Object.entries(p.categories || {}).map(([c, v]) => `<div class="cat">${dot(light(v, cfg))} <button class="link" data-fail="${esc(catChecks(c))}">${esc(CATS[c] || c)}</button> <b>${fmt(v)}</b>
    ${B["cat:" + c] ? `<span class="muted"> · ${bestLabel(B["cat:" + c])} ${fmt(bestVal(B["cat:" + c]))}</span>` : ""}</div>`).join("");

  const calc = src.scores ? `<p class="muted small">${esc(t("src_calc_note", { n: (d.hosts || []).length }))} <a href="${esc(src.scores)}" rel="noopener">${esc(t("src_calc"))}</a>${src.aggregation ? ` · <a href="${esc(src.aggregation)}" rel="noopener">${esc(t("src_agg"))}</a>` : ""}</p>` : "";
  const dep = d.dependencies || {};
  // what each provider was recognised by (docs/DATA_CONTRACT.md, «Dependencies»)
  const PROOF = { mx: "MX", spf: "SPF", txt: t("proof_txt"), dkim: t("proof_dkim"), cname: "CNAME", redirect: t("proof_redirect"), path: t("proof_path") };
  const proof = (part, name) => {
    const v = (dep.via || []).find((x) => x.part === part && x.name === name);
    return v ? v.ev.map(([k, where, what]) => `${PROOF[k] || k}: ${where} → ${what}`).join("; ") : "";
  };
  const depRow = (label, arr, withN, part) => (arr && arr.length ? `<tr><th>${esc(label)}</th><td>${arr.slice(0, 6).map((x) => {
    const pr = part ? proof(part, x[0]) : "";
    const v = part && (dep.via || []).find((y) => y.part === part && y.name === x[0]);
    const id = v ? v.provider : provId.get(x[0]);
    const nm = id ? `<a href="#/anbieter/${encodeURIComponent(id)}">${esc(x[0])}</a>` : esc(x[0]);
    return `<span${pr ? ` class="proof" title="${esc(pr)}"` : ""}>${nm}</span> ${cc(x[1])}${withN && x[2] ? ` <span class="muted">${x[2]}</span>` : ""}`;
  }).join("<br>")}</td></tr>` : "");
  const deps = `<table class="deps"><tbody>${depRow(t("dep_mail"), dep.mail, false, "mail")}${depRow(t("dep_send"), dep.send, false, "send")}${depRow(t("dep_saas"), dep.saas, false, "saas")}
    ${depRow(t("dep_idp"), dep.idp, false, "idp")}${depRow(t("dep_cloud"), dep.cloud, true, "cloud")}</tbody></table>
    <p class="muted small">${esc(t("deps_org_note"))}</p>`;

  // services × functions (entity "services"): per service the provider of each basic function
  const FN = ["resolve", "registrar", "secure", "operate", "identity"];
  const LIGHT = { pass: "green", partial: "yellow", fail: "red" };
  const short = (c) => {
    const v = c.value || "";
    if (c.check === "mail.dmarc") return (v.match(/p=(\w+)/) || [])[0] || v.slice(0, 24);
    return v.length > 48 ? v.slice(0, 46) + "…" : v;
  };
  const cell = (c) => {
    if (!c) return `<td class="muted">–</td>`;
    const n = c.count.pass + c.count.partial + c.count.fail;
    const go = c.check.startsWith("mail.") ? `data-jump="mailsrc"` : `data-fail="${esc(c.check)}"`;
    return `<td title="${esc(checkName(c.check))}${c.value ? ": " + esc(c.value) : ""}">${c.status ? `<button class="link" ${go}>${dot(LIGHT[c.status])} ${esc(short(c))}</button>` : '<span class="muted">–</span>'}
      ${n > 1 ? `<div class="muted small">${esc(t("mx_count", { p: c.count.pass, n }))}</div>` : ""}</td>`;
  };
  const svc = d.services || [];
  const matrix = svc.length ? `<div class="scroll"><table class="matrix"><thead><tr><th></th>${FN.map((f) => `<th>${esc(t("fn_" + f))}</th>`).join("")}<th>${esc(t("fn_proof"))}</th></tr></thead>
    <tbody>${svc.map((x) => `<tr><th>${esc(APPS[x.service] || x.service)}<div class="muted small">${esc(x.host)}${x.hosts > 1 ? ` (+${x.hosts - 1})` : ""}</div></th>
      ${FN.map((f) => cell(x.cells[f])).join("")}<td class="muted small">${esc(t("mx_na"))}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted">${esc(t("mx_none"))}</p>`;

  // mail values per domain, each with the DNS query it was read from
  const MLIGHT = { pass: "green", partial: "yellow", fail: "red" };
  const mailRows = ((d.mail || {}).detail || []).flatMap((x) => x.checks.map((c, i) =>
    `<tr>${i === 0 ? `<td rowspan="${x.checks.length}">${esc(x.domain)}</td>` : ""}<td>${c.status in MLIGHT ? dot(MLIGHT[c.status]) : '<span class="muted">–</span>'} ${esc(checkName(c.check))}</td>
      <td class="small mono">${esc((c.value || "").length > 90 ? c.value.slice(0, 88) + "…" : c.value || "")}</td>
      <td>${c.src ? `<a href="${esc(c.src)}" rel="noopener noreferrer">${esc(t("ev_check"))}</a>` : ""}</td></tr>`)).join("");
  const mailTbl = mailRows ? `<section id="mailsrc"><h2>${esc(t("src_mail_title"))}</h2><p class="sub">${esc(t("src_mail_sub"))}</p>
    <div class="scroll"><table class="evt"><thead><tr><th>${esc(t("parts_domain"))}</th><th>${esc(t("check"))}</th><th>${esc(t("value"))}</th><th></th></tr></thead><tbody>${mailRows}</tbody></table></div></section>` : "";

  // a department by the domains of its offices (entity "parts", federal level)
  const partsTbl = (d.parts || []).length ? `<section><h2>${esc(t("parts_title"))}</h2><p class="sub">${esc(t("parts_sub"))} ${esc(t("parts_names"))}</p>
    <div class="scroll"><table class="hosts"><thead><tr><th>${esc(t("parts_domain"))}</th><th>${esc(t("parts_hosts"))}</th><th>${esc(t("parts_mean"))}</th><th>${esc(t("parts_ko"))}</th></tr></thead>
    <tbody>${d.parts.map((x) => `<tr><td>${x.office ? `${x.key ? `<a href="#/org/${encodeURIComponent(x.key)}">${esc(tx(x.office, "name"))}</a>` : esc(tx(x.office, "name"))} <a class="muted small" href="${esc(x.office.src)}" rel="noopener">${esc(tx(x.office, "abbr"))}</a><div class="muted small">${esc(x.domain)}</div>` : esc(x.domain)}</td><td class="num">${x.hosts}</td>
      <td>${x.overall === null ? '<span class="muted">–</span>' : `${dot(light(x.overall, cfg))} ${fmt(x.overall)}`}</td><td class="num">${x.knockouts || ""}</td></tr>`).join("")}</tbody></table></div></section>` : "";

  // hosts: the ten weakest, or those matching the search; each opens its evidence
  const rated = (d.hosts || []).filter((h) => h.overall !== null && h.overall !== undefined).sort((a, b) => a.overall - b.overall);
  const hostRows = (list) => list.map((h) =>
    `<tr><td>${esc(h.host)}${h.critical ? ` <span class="tag">${esc(t("tag_critical"))}</span>` : ""}${h.knockout ? ` <span class="tag red">${esc(t("tag_ko"))}</span>` : ""}${h.unreachable ? ` <span class="tag">${esc(t("tag_unreachable"))}</span>` : ""}</td>
     <td>${dot(light(h.overall, cfg))} ${fmt(h.overall)}</td>
     <td><button class="link" data-ev="${esc(h.host)}" aria-expanded="false">${esc(t("ev_open"))}</button></td></tr>`).join("");
  const hostList = rated.length ? `${rated.length > 10 ? `<p><input id="hostq" type="search" placeholder="${esc(t("ev_search", { n: rated.length }))}" aria-label="${esc(t("ev_search", { n: rated.length }))}"></p>` : ""}
    <table class="hosts"><thead><tr><th>${esc(t("service"))}</th><th>${esc(t("value"))}</th><th></th></tr></thead><tbody id="hostrows">${hostRows(rated.slice(0, 10))}</tbody></table>` : "<p>–</p>";

  el.innerHTML = head + verdict + trend.render(hist, cfg) +
    `<section><h2>${esc(t("blocks_h"))}</h2><p class="sub">${esc(t("blocks_sub"))}</p><div class="model compact">${layers}</div></section>
     <section><h2>${esc(t("mx_title"))}</h2><p class="sub">${esc(t("mx_sub"))}</p>${matrix}</section>
     <div class="two"><section><h2>${esc(t("next_steps"))}</h2>${steps}</section>
     <section><h2>${esc(t("areas"))}</h2>${cats || "<p>–</p>"}${calc}<h2 id="depsec">${esc(t("deps_title"))}</h2>${deps}</section></div>
     ${mailTbl}${partsTbl}
     <section id="hostsec"><h2>${esc(t("weakest"))}</h2><p id="hostnote" class="small" hidden></p>${hostList}</section>`;

  evid.wire(el, d.key);
  const hq = el.querySelector("#hostq");
  if (hq) hq.addEventListener("input", () => {
    const v = hq.value.trim().toLowerCase();
    const tb = el.querySelector("#hostrows");
    tb.innerHTML = hostRows(v ? rated.filter((h) => h.host.includes(v)).slice(0, 50) : rated.slice(0, 10));
    evid.wire(tb, d.key);
  });
  // a next step opens the hosts that do not (fully) meet its check, from the evidence file
  el.querySelectorAll("[data-fail]").forEach((b) => b.addEventListener("click", async () => {
    const ids = b.dataset.fail.split(",").filter(Boolean), note = el.querySelector("#hostnote"), tb = el.querySelector("#hostrows");
    if (!tb) return;
    let ev = {};
    try { ev = (await data.evidence(d.key)).hosts || {}; } catch { /* no evidence file */ }
    const bad = rated.filter((h) => ((ev[h.host] || {}).chk || []).some((c) => ids.includes(c[0]) && (c[1] === "fail" || c[1] === "partial")));
    tb.innerHTML = hostRows(bad.slice(0, 100));
    evid.wire(tb, d.key);
    note.hidden = false;
    note.innerHTML = `${esc(t("src_filtered", { c: ids.map(checkName).join(", "), n: bad.length }))}${bad.length > 100 ? " " + esc(t("src_first", { n: 100 })) : ""} · <button class="link" id="hostreset">${esc(t("src_reset"))}</button>`;
    note.querySelector("#hostreset").addEventListener("click", () => { tb.innerHTML = hostRows(rated.slice(0, 10)); evid.wire(tb, d.key); note.hidden = true; });
    el.querySelector("#hostsec").scrollIntoView();
  }));
  el.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); el.querySelector("#" + a.dataset.jump)?.scrollIntoView(); }));
  el.querySelectorAll('div[role="button"]').forEach((x) => x.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); x.click(); } }));
  el.querySelector("[data-home]").addEventListener("click", (ev) => {
    const k = ev.currentTarget.dataset.home;
    store.set(HOME_KEY, store.get(HOME_KEY) === k ? null : k);
    render(el, params, role);
  });
}

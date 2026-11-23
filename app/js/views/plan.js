// Change plan of one entity (#/org/<key>/plan, Phase 3). Not linked until the good
// practice is approved (docs/PRODUCT.md). Measures from `plan` in the entity file;
// the value of any selection is computed here with the rules of the rating
// (meta.cfg: check and category weights, points, critical resources counting
// more, knock-outs) from the checks per host in the evidence file, the same way
// as src/tlsmap/plan.py.
import * as data from "../data.js";
import { LEVEL_DAT, checkName, t } from "../text.js";
import { esc, fmt, light, dot } from "../ui.js";

const KO = "knockout";
const CAT = { own: "ownership", sov: "sovereignty", sec: "security", prv: "privacy" };

// Python's round(): halves to the even neighbour, so values match the pipeline
const round = (x) => {
  const f = Math.floor(x);
  return Math.abs(x - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(x);
};

function score(st, cfg) {
  const pts = cfg.points, w = cfg.checks || {}, cw = cfg.category_weights;
  const cats = {};
  for (const c of ["ownership", "sovereignty", "security", "privacy"]) {
    const rows = Object.entries(st).filter(([k, s]) => CAT[k.split(".")[0]] === c && s in pts);
    const tw = rows.reduce((a, [k]) => a + (w[k] ?? 1), 0);
    cats[c] = tw ? round((100 * rows.reduce((a, [k, s]) => a + (w[k] ?? 1) * pts[s], 0)) / tw) : null;
  }
  const done = Object.keys(cats).filter((c) => cats[c] !== null);
  const tw = done.reduce((a, c) => a + cw[c], 0);
  return tw ? round(done.reduce((a, c) => a + cw[c] * cats[c], 0) / tw) : null;
}

function value(rs, cfg, fixed) {
  const cw = cfg.critical_resource_weight ?? 3;
  let num = 0, den = 0;
  for (const r of rs) {
    const st = {};
    for (const [k, s] of Object.entries(r.st)) st[k] = fixed.has(k) && (s === "fail" || s === "partial") ? "pass" : s;
    const o = r.ko && !fixed.has(KO) ? 0 : score(st, cfg);
    if (o === null) continue;
    const a = r.crit ? cw : 1;
    num += a * o;
    den += a;
  }
  return den ? round(num / den) : null;
}

export async function render(el, params) {
  let d;
  try {
    d = await data.entity(params.key);
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(params.key || "")}</p></section>`;
    return;
  }
  const [meta, ev] = await Promise.all([data.meta(), data.evidence(d.key).catch(() => ({ hosts: {} }))]);
  const cfg = meta.cfg, p = d.plan;
  const head = `<section class="lead org">
    <div class="kind">${esc(t("plan_title"))}</div>
    <h1><a href="#/org/${encodeURIComponent(d.key)}">${esc(d.name)}</a></h1>
    <p class="sub">${esc(t("plan_draft"))}</p></section>`;
  if (!p || !p.items.length) {
    el.innerHTML = head + `<section><p>${esc(t(p ? "plan_none" : "plan_nodata"))}</p></section>`;
    return;
  }
  const rs = (d.hosts || []).filter((h) => h.overall !== null && h.overall !== undefined && (ev.hosts[h.host] || {}).chk?.length)
    .map((h) => ({ crit: h.critical, ko: !!h.knockout, st: Object.fromEntries(ev.hosts[h.host].chk.map((c) => [c[0], c[1]])) }));
  const name = (c) => (c === KO ? t("plan_ko") : checkName(c));
  const rows = p.items.map((it, i) => `<tr>
      <td><input type="checkbox" id="pm${i}" data-check="${esc(it.check)}"${it.proposed ? " checked" : ""}></td>
      <td><label for="pm${i}">${esc(name(it.check))}</label>
        <details><summary class="muted small">${esc(t("plan_hosts", { n: it.hosts }))}</summary>
        <div class="mono small">${it.sample.map(esc).join("<br>")}${it.hosts > it.sample.length ? "<br>…" : ""}</div></details></td>
      <td class="num">+${fmt(it.gain)}</td><td>${it.effort ? esc(t("effort_" + it.effort)) : '<span class="muted">–</span>'}</td></tr>`).join("");
  el.innerHTML = head + `<section>
    <p id="plansum"></p>
    <div class="scroll"><table class="hosts"><thead><tr><th></th><th>${esc(t("plan_measure"))}</th>
      <th>${esc(t("plan_gain"))}</th><th>${esc(t("plan_effort"))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="muted small">${esc(t("plan_note", { l: LEVEL_DAT[d.kind] || d.kind }))}</p></section>`;
  const sum = el.querySelector("#plansum");
  const update = () => {
    const fixed = new Set([...el.querySelectorAll("input[data-check]:checked")].map((x) => x.dataset.check));
    const v = value(rs, cfg, fixed);
    const gap = p.target === null || v === null ? null : Math.max(0, p.target - v);
    sum.innerHTML = `${esc(t("plan_base"))} ${dot(light(p.base, cfg))} <b>${fmt(p.base)}</b> → ${esc(t("plan_new"))} ${dot(light(v, cfg))} <b>${fmt(v)}</b>`
      + (p.target === null ? "" : ` · ${esc(t("plan_target"))} ${fmt(p.target)} · ${gap ? esc(t("plan_gap", { n: fmt(gap) })) : esc(t("plan_reached"))}`);
  };
  el.querySelectorAll("input[data-check]").forEach((x) => x.addEventListener("change", update));
  update();
}

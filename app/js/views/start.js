// Switzerland at a glance: the layer model, one block per building block,
// filled with the share over all entities of the chosen level.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, LEVELS, LEVEL_MANY, GROUPS, CONTROL, t } from "../text.js";
import { esc, fmt, light, dot, store, HOME_KEY } from "../ui.js";
import { statusWord, lawText } from "./gov.js";

const ORDER = ["apps", "dpi", "ext", "trust", "cloud", "net"];

export async function render(el, params) {
  const [ov, meta, inf, gov] = await Promise.all([data.overview(), data.meta(), data.infrastructure().catch(() => ({ blocks: {} })),
    data.governance().catch(() => ({ laws: [] }))]);
  const level = params.level && ov[params.level] ? params.level : "municipality";
  const o = ov[level], cfg = meta.cfg;
  const model = Object.fromEntries(meta.model.layer.map((L) => [L.id, L]));
  const home = store.get(HOME_KEY);

  const tabs = LEVELS.map(([k, n]) => `<a class="tab${k === level ? " on" : ""}" href="#/?level=${k}">${esc(n)}</a>`).join("");
  const head = `<section class="lead">
    <h1>${esc(t("start_h1"))}</h1>
    <p>${esc(t("start_intro", { lv: LEVEL_MANY[level] }))}</p>
    <div class="tabs" role="tablist">${tabs}</div>
    ${home ? `<p class="sub"><a href="#/org/${encodeURIComponent(home)}">${esc(t("to_my_org"))}</a></p>` : ""}
  </section>`;

  const rows = ORDER.map((lid) => {
    const L = model[lid];
    const blocks = L.blocks.map((b) => {
      const key = `${lid}.${b.id}`, c = o.cells[key] || {};
      const nImpl = (((inf.blocks || {})[key] || {}).implementations || []).length;
      const reg = ((inf.blocks || {})[key] || {}).register || {};
      const nReg = (reg.providers || []).length;
      const none = c.m === "none", count = c.m === "count";
      // a block without a value per organisation: the posture of its service (production, mean over its hosts) and its use
      const imps = (((inf.blocks || {})[key] || {}).implementations || []).filter((i) => i.environment !== "sandbox");
      const nh = imps.reduce((a, i) => a + (i.hosts || 0), 0);
      const svcPost = nh ? imps.reduce((a, i) => a + (i.overall || 0) * (i.hosts || 0), 0) / nh : null;
      const swyReg = ((inf.blocks || {})["trust.swiyu"] || {}).register;
      const svcUse = imps.some((i) => i.id.startsWith("swiyu")) && swyReg
        ? new Set(swyReg.providers.filter((p) => p.env === "production").map((p) => p.uid || p.name)).size
        : new Set(imps.flatMap((i) => (i.users_list || []).filter((u) => u.role !== "hint" && u.role !== "law").map((u) => u.key))).size;
      // services with use from their own public sources (sedex participants, I14Y publishers)
      const useOwn = imps.filter((i) => i.usage).map((i) => t("ov_use_" + i.usage.kind, { n: { sedex: i.usage.summary.participants, i14y: i.usage.summary.publishers, vlei: i.usage.summary.le }[i.usage.kind] }));
      const svcLine = none && imps.length ? `<div class="bv">${svcPost === null ? `<span class="muted">${esc(t("no_hosts"))}</span>` : `${dot(light(svcPost, cfg))} <b>${fmt(svcPost)}</b> <span class="muted small">${esc(t("ov_posture"))}</span>`}</div>
        <div class="bs">${esc(useOwn.length ? useOwn.join(" · ") : t(imps.some((i) => i.id.startsWith("swiyu")) ? "ov_use_swiyu" : "ov_use", { n: svcUse }))}</div>` : "";
      const l = none || count ? "none" : light(c.v, cfg);
      const empty = !none && !count && (c.v === null || c.v === undefined);
      const val = none ? (nImpl || nReg ? t("use_unmeasured") : t("not_measured")) : count ? t("types_per_org") : empty ? t("no_data_yet") : fmt(c.v);
      // blocks of the digital public infrastructure open their own page
      // details: the map exists only for cantons and municipalities; departments and
      // critical services have no area, so they open the ranking of their level sorted by the block
      const detail = level === "canton" || level === "municipality"
        ? `#/karte/${encodeURIComponent("blk:" + key)}?level=${level}`
        : `#/vergleich?level=${level}&sort=${encodeURIComponent("blk:" + key)}&to=rank`;
      const href = L.group === "dpi" ? `#/baustein/${key}` : !none && !count && !empty ? detail : "";
      const tag = href ? "a" : "div";
      return `<${tag} class="block ${l}${none ? " unmeasured" : ""}" data-key="${esc(key)}" ${href ? `href="${href}"` : 'tabindex="0"'} title="${esc(BLOCK_WHAT[key] || "")}">
        <div class="bn">${esc(BLOCKS[key] || key)}</div>
        ${svcLine || `<div class="bv">${none || count || empty ? `<span class="muted">${esc(val)}</span>` : `${dot(l)} <b>${val}</b>`}</div>`}
        ${!none && !count && c.entities ? `<div class="bs">${c.entities} ${esc(c.entities === 1 ? t("unit_one") : t("unit_many"))}</div>` : ""}
        ${nImpl ? `<div class="bs">${esc(nImpl === 1 ? t("impl_one") : t("impl_count", { n: nImpl }))} ›</div>` : ""}
        ${nReg ? `<div class="bs">${esc(t("reg_count_" + (reg.kind || "zertes"), { n: nReg }))} ›</div>` : ""}
      </${tag}>`;
    }).join("");
    return `<div class="layer ${lid}${L.group ? " " + L.group : ""}">
      <div class="ln">${L.group && GROUPS[L.group] ? `<span class="grp" title="${esc(GROUPS[L.group].hint)}">${esc(GROUPS[L.group].name)}</span>` : ""}<b>${esc(LAYERS[lid].name)}</b><span>${esc(LAYERS[lid].hint)}</span></div>
      <div class="blocks" style="--n:${L.blocks.length}">${blocks}</div>
    </div>`;
  }).join("");

  el.innerHTML = head + `<div class="modelwrap"><section class="model" aria-label="${esc(t("layer_model"))}">${rows}</section>
    <aside class="ctrl" aria-label="${esc(CONTROL.name + ": " + CONTROL.hint)}">
      <div class="ch" title="${esc(CONTROL.hint)}">${esc(CONTROL.name)}</div>
      <div class="cg">${esc(t("gov_name"))}</div>
      <p class="muted small">${esc(t("gov_box_hint"))}</p>
      <ul>${gov.laws.filter((l) => l.level !== "canton").map((l) => `<li><a href="#/governance/${encodeURIComponent(l.id)}" data-blocks="${esc(l.blocks.join(" "))}" title="${esc(lawText(l, "name"))}">
        <b>${esc(lawText(l, "abbr"))}</b> <span class="badge ${l.status === "in_force" ? "ok" : "wait"}">${esc(statusWord(l))}</span></a></li>`).join("")}</ul>
      ${(() => { const c = [...new Set(gov.laws.filter((l) => l.level === "canton").map((l) => l.canton))].sort();
        return c.length ? `<p class="small">${esc(t("gov_cantonal_n", { n: c.length }))}</p>` : ""; })()}
      <a class="small" href="#/governance">${esc(t("gov_all"))} ›</a></aside></div>
    <section class="note"><p>${esc(t("start_note", { d: (meta.data_generated || "").slice(0, 10).split("-").reverse().map(Number).join(".") }))}</p></section>`;
  // a law in the governance box marks the building blocks it concerns
  const modelEl = el.querySelector(".model");
  const mark = (blocks) => {
    modelEl.classList.toggle("gov-on", !!blocks);
    modelEl.querySelectorAll(".block").forEach((b) => b.classList.toggle("hit", !!blocks && blocks.includes(b.dataset.key)));
  };
  el.querySelectorAll(".ctrl [data-blocks]").forEach((a) => {
    const blocks = a.dataset.blocks.split(" ");
    a.addEventListener("mouseenter", () => mark(blocks));
    a.addEventListener("focus", () => mark(blocks));
    a.addEventListener("mouseleave", () => mark(null));
    a.addEventListener("blur", () => mark(null));
  });
}

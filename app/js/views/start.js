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
  const lights = o.lights || {};
  const head = `<section class="lead">
    <h1>${esc(t("start_h1"))}</h1>
    <p>${esc(t("start_intro", { lv: LEVEL_MANY[level] }))}</p>
    <div class="tabs" role="tablist">${tabs}</div>
    <p class="sub">${esc(t("start_counts", { e: o.entities, r: o.rated, o: fmt(o.overall) }))} ·
      ${dot("green")} ${lights.green || 0} ${dot("yellow")} ${lights.yellow || 0} ${dot("red")} ${lights.red || 0}
      ${home ? ` · <a href="#/org/${encodeURIComponent(home)}">${esc(t("to_my_org"))}</a>` : ""}</p>
  </section>`;

  const rows = ORDER.map((lid) => {
    const L = model[lid];
    const blocks = L.blocks.map((b) => {
      const key = `${lid}.${b.id}`, c = o.cells[key] || {};
      const nImpl = (((inf.blocks || {})[key] || {}).implementations || []).length;
      const nReg = ((((inf.blocks || {})[key] || {}).register || {}).providers || []).length;
      const none = c.m === "none", count = c.m === "count";
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
        <div class="bv">${none || count || empty ? `<span class="muted">${esc(val)}</span>` : `${dot(l)} <b>${val}</b>`}</div>
        ${!none && !count && c.entities ? `<div class="bs">${c.entities} ${esc(c.entities === 1 ? t("unit_one") : t("unit_many"))}</div>` : ""}
        ${nImpl ? `<div class="bs">${esc(nImpl === 1 ? t("impl_one") : t("impl_count", { n: nImpl }))} ›</div>` : ""}
        ${nReg ? `<div class="bs">${esc(t("reg_count", { n: nReg }))} ›</div>` : ""}
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

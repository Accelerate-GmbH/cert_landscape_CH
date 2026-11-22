// Switzerland at a glance: the layer model, one block per building block,
// filled with the share over all entities of the chosen level.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, LEVELS, GROUPS, CONTROL, t } from "../text.js";
import { esc, fmt, light, dot, store, HOME_KEY } from "../ui.js";

const ORDER = ["apps", "dpi", "ext", "trust", "cloud", "net"];

export async function render(el, params) {
  const [ov, meta, inf] = await Promise.all([data.overview(), data.meta(), data.infrastructure().catch(() => ({ blocks: {} }))]);
  const level = params.level && ov[params.level] ? params.level : "municipality";
  const o = ov[level], cfg = meta.cfg;
  const model = Object.fromEntries(meta.model.layer.map((L) => [L.id, L]));
  const home = store.get(HOME_KEY);

  const tabs = LEVELS.map(([k, n]) => `<a class="tab${k === level ? " on" : ""}" href="#/?level=${k}">${esc(n)}</a>`).join("");
  const lights = o.lights || {};
  const head = `<section class="lead">
    <h1>Wo hält die Schweiz ihre digitalen Grundbausteine in eigener Hand?</h1>
    <p>Jede Box ist ein Baustein, auf dem öffentliche Dienste ruhen. Die Zahl zeigt, wie gut ${esc(LEVELS.find((l) => l[0] === level)[1])}
      diesen Baustein im Durchschnitt abdecken, von 0 bis 100. Gestrichelt ist, was es heute noch nicht gibt.</p>
    <div class="tabs" role="tablist">${tabs}</div>
    <p class="sub">${o.entities} erfasst · ${o.rated} bewertet · Gesamtwert ${fmt(o.overall)} ·
      ${dot("green")} ${lights.green || 0} ${dot("yellow")} ${lights.yellow || 0} ${dot("red")} ${lights.red || 0}
      ${home ? ` · <a href="#/org/${encodeURIComponent(home)}">zu meiner Organisation →</a>` : ""}</p>
  </section>`;

  const rows = ORDER.map((lid) => {
    const L = model[lid];
    const blocks = L.blocks.map((b) => {
      const key = `${lid}.${b.id}`, c = o.cells[key] || {};
      const nImpl = (((inf.blocks || {})[key] || {}).implementations || []).length;
      const none = c.m === "none", count = c.m === "count";
      const l = none || count ? "none" : light(c.v, cfg);
      const empty = !none && !count && (c.v === null || c.v === undefined);
      const val = none ? (nImpl ? t("use_unmeasured") : "noch nicht gemessen") : count ? "Typen pro Organisation" : empty ? "noch keine Daten" : fmt(c.v);
      // blocks of the digital public infrastructure open their own page
      const href = L.group === "dpi" ? `#/baustein/${key}` : !none && !count && !empty ? `#/karte/${encodeURIComponent("blk:" + key)}?level=${level === "canton" ? "canton" : "municipality"}` : "";
      const tag = href ? "a" : "div";
      return `<${tag} class="block ${l}${none ? " unmeasured" : ""}" ${href ? `href="${href}"` : 'tabindex="0"'} title="${esc(BLOCK_WHAT[key] || "")}">
        <div class="bn">${esc(BLOCKS[key] || key)}</div>
        <div class="bv">${none || count || empty ? `<span class="muted">${esc(val)}</span>` : `${dot(l)} <b>${val}</b>`}</div>
        ${!none && !count && c.entities ? `<div class="bs">${c.entities} ${c.entities === 1 ? "Einheit" : "Einheiten"}</div>` : ""}
        ${nImpl ? `<div class="bs">${esc(nImpl === 1 ? t("impl_one") : t("impl_count", { n: nImpl }))} ›</div>` : ""}
      </${tag}>`;
    }).join("");
    return `<div class="layer ${lid}${L.group ? " " + L.group : ""}">
      <div class="ln">${L.group && GROUPS[L.group] ? `<span class="grp" title="${esc(GROUPS[L.group].hint)}">${esc(GROUPS[L.group].name)}</span>` : ""}<b>${esc(LAYERS[lid].name)}</b><span>${esc(LAYERS[lid].hint)}</span></div>
      <div class="blocks" style="--n:${L.blocks.length}">${blocks}</div>
    </div>`;
  }).join("");

  el.innerHTML = head + `<div class="modelwrap"><section class="model" aria-label="Schichtenmodell">${rows}</section>
    <div class="ctrl" tabindex="0" title="${esc(CONTROL.hint)}" aria-label="${esc(CONTROL.name + ": " + CONTROL.hint)}"><span>${esc(CONTROL.name)}</span></div></div>
    <section class="note"><p>Grundlage: öffentliche Messungen von DNS, Zertifikaten, Netzwerken und Mail, Stand ${esc((meta.data_generated || "").slice(0, 10))}.
      Was eine Organisation intern betreibt, ist nicht sichtbar. Bei der digitalen öffentlichen Infrastruktur zeigt ein Klick auf den Baustein,
      worauf ihre Umsetzungen ruhen; wer sie nutzt, wird erst teilweise erkannt. Die Kontrollschicht ist ein Entwurf und erscheint nach Prüfung der Quellen.</p></section>`;
}

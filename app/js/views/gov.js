// Governance (#/governance, #/governance/<law>, #/governance?blk=<layer.block>):
// the legal bases from governance.json, per law who it applies to, its status
// and per provision the article (link to Fedlex), a summary and the building
// blocks it concerns. Filtered by a block, it shows what applies to that block.
import * as data from "../data.js";
import { BLOCKS, LANG, t } from "../text.js";
import { esc } from "../ui.js";

const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const link = (s) => `<a href="${esc(fedlex(s.url))}" rel="noopener">${esc(s.title)}</a>`;

// texts in the chosen language (governance.json "i18n"), else German
export const lawText = (law, k) => ((law.i18n || {})[LANG] || {})[k] || (k === "status_sources" ? null : law[k]);
const provText = (p) => (p.i18n || {})[LANG] || p.text;
// Fedlex has every act in German, French and Italian: same link, other language
export const fedlex = (u) => (LANG === "fr" || LANG === "it") && /fedlex\.admin\.ch\/eli\//.test(u || "")
  ? u.replace(/\/de(?=#|$)/, "/" + LANG) : u;
// article labels in the notation of the language (Art. 2 Abs. 1 Bst. b)
const ART = {
  fr: [[/^Art\./, "art."], [/ Abs\. /g, ", al. "], [/ Bst\. /g, ", let. "], [/ und /g, " et "]],
  it: [[/^Art\./, "art."], [/ Abs\. /g, " cpv. "], [/ Bst\. /g, " lett. "], [/ und /g, " e "]],
  en: [[/ Abs\. /g, " para. "], [/ Bst\. /g, " let. "], [/ und /g, " and "]],
};
export const artLabel = (a) => (ART[LANG] || []).reduce((s, [re, r]) => s.replace(re, r), a || "");
const REF = { fr: [[/^SR /, "RS "], [/^BBl /, "FF "]], it: [[/^SR /, "RS "], [/^BBl /, "FF "]] };
const refLabel = (r) => (REF[LANG] || []).reduce((s, [re, x]) => s.replace(re, x), r || "");

export const statusWord = (law) => t(law.status === "in_force" ? "gov_in_force" : "gov_adopted");

// a block name that leads to the laws concerning it
export const blockChip = (key, on) =>
  `<a class="chip${on ? " on" : ""}" href="#/governance?blk=${encodeURIComponent(key)}">${esc(BLOCKS[key] || key)}</a>`;

export function provisionRows(law, only) {
  return law.provisions.filter((p) => !only || p.blocks.includes(only)).map((p) =>
    `<tr><th><a href="${esc(fedlex(p.url))}" rel="noopener">${esc(artLabel(p.art))}</a></th><td>${esc(provText(p))}
      <div class="chips">${p.blocks.map((b) => blockChip(b, b === only)).join("")}</div></td></tr>`).join("");
}

export async function render(el, params) {
  const g = await data.governance();
  const only = params.blk && BLOCKS[params.blk] ? params.blk : "";
  const laws = g.laws.filter((l) => !only || l.blocks.includes(only));
  const one = (l) => `<section class="law" id="law-${esc(l.id)}">
      <h2>${esc(lawText(l, "abbr"))} <span class="badge ${l.status === "in_force" ? "ok" : "wait"}">${esc(statusWord(l))}</span></h2>
      <p class="sub"><a href="${esc(fedlex(l.url))}" rel="noopener">${esc(lawText(l, "name"))}</a> · ${esc(refLabel(l.ref))}</p>
      <p class="small">${esc(lawText(l, "status_text"))} <span class="muted">${esc(t("sources"))}: ${(l.status_sources || []).map((s, i) => link({ ...s, title: (lawText(l, "status_sources") || [])[i] || s.title })).join(" · ")}</span></p>
      <p><b>${esc(t("gov_scope"))}:</b> ${esc(lawText(l, "scope"))}</p>
      <table class="deps gov"><thead><tr><th>${esc(t("gov_art"))}</th><td>${esc(t("gov_provision"))}</td></tr></thead>
        <tbody>${provisionRows(l, only)}</tbody></table></section>`;
  el.innerHTML = `<section class="lead"><h1>${esc(t("gov_h1"))}</h1>
      <p>${esc(t("gov_intro"))}</p>
      ${only ? `<p>${esc(t("gov_filtered", { b: BLOCKS[only] }))} · <a href="#/governance">${esc(t("gov_show_all"))}</a></p>` : ""}
      <p class="muted small">${esc(t("checked_on", { d: date(g.checked) }))} · ${esc(t("gov_de_only"))}</p></section>
    ${laws.map(one).join("") || `<p class="muted">${esc(t("gov_none"))}</p>`}`;
  if (params.law) document.getElementById("law-" + params.law)?.scrollIntoView();
}

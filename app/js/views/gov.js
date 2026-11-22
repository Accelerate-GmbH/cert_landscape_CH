// Governance (#/governance, #/governance/<law>, #/governance?blk=<layer.block>):
// the legal bases from governance.json, per law who it applies to, its status
// and per provision the article (link to Fedlex), a summary and the building
// blocks it concerns. Filtered by a block, it shows what applies to that block.
import * as data from "../data.js";
import { BLOCKS, LANG, t } from "../text.js";
import { esc } from "../ui.js";

const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const link = (s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`;

export const statusWord = (law) => t(law.status === "in_force" ? "gov_in_force" : "gov_adopted");

// a block name that leads to the laws concerning it
export const blockChip = (key, on) =>
  `<a class="chip${on ? " on" : ""}" href="#/governance?blk=${encodeURIComponent(key)}">${esc(BLOCKS[key] || key)}</a>`;

export function provisionRows(law, only) {
  return law.provisions.filter((p) => !only || p.blocks.includes(only)).map((p) =>
    `<tr><th><a href="${esc(p.url)}" rel="noopener">${esc(p.art)}</a></th><td>${esc(p.text)}
      <div class="chips">${p.blocks.map((b) => blockChip(b, b === only)).join("")}</div></td></tr>`).join("");
}

export async function render(el, params) {
  const g = await data.governance();
  const only = params.blk && BLOCKS[params.blk] ? params.blk : "";
  const laws = g.laws.filter((l) => !only || l.blocks.includes(only));
  const one = (l) => `<section class="law" id="law-${esc(l.id)}">
      <h2>${esc(l.abbr)} <span class="badge ${l.status === "in_force" ? "ok" : "wait"}">${esc(statusWord(l))}</span></h2>
      <p class="sub"><a href="${esc(l.url)}" rel="noopener">${esc(l.name)}</a> · ${esc(l.ref)}</p>
      <p class="small">${esc(l.status_text)} <span class="muted">${esc(t("sources"))}: ${(l.status_sources || []).map(link).join(" · ")}</span></p>
      <p><b>${esc(t("gov_scope"))}:</b> ${esc(l.scope)}</p>
      <table class="deps gov"><thead><tr><th>${esc(t("gov_art"))}</th><td>${esc(t("gov_provision"))}</td></tr></thead>
        <tbody>${provisionRows(l, only)}</tbody></table></section>`;
  el.innerHTML = `<section class="lead"><h1>${esc(t("gov_h1"))}</h1>
      <p>${esc(t("gov_intro"))}</p>
      ${only ? `<p>${esc(t("gov_filtered", { b: BLOCKS[only] }))} · <a href="#/governance">${esc(t("gov_show_all"))}</a></p>` : ""}
      <p class="muted small">${esc(t("checked_on", { d: date(g.checked) }))}${LANG !== "de" ? " · " + esc(t("gov_de_only")) : ""}</p></section>
    ${laws.map(one).join("") || `<p class="muted">${esc(t("gov_none"))}</p>`}`;
  if (params.law) document.getElementById("law-" + params.law)?.scrollIntoView();
}

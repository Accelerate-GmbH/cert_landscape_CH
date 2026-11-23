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
// an act not published in the chosen language is shown in its own language (German
// if published in German, else its first language); acts are not translated
const own = (law) => { const ls = law.languages || ["de"];
  return law.level !== "canton" || ls.includes(LANG) ? LANG : ls.includes("de") ? "de" : ls[0]; };
export const lawText = (law, k) => ((law.i18n || {})[own(law)] || {})[k] || (k === "status_sources" ? null : law[k]);
const provText = (p, law) => (p.i18n || {})[law ? own(law) : LANG] || p.text;
// "only in German" when the act is not published in the chosen language
const langNames = (codes) => { let dn = null; try { dn = new Intl.DisplayNames([LANG], { type: "language" }); } catch { /* old browser */ }
  return codes.map((c) => (dn ? dn.of(c) : c)).join(", "); };
const actLang = (law) => (law.level === "canton" && law.languages && own(law) !== LANG
  ? `<p class="muted small">${esc(t("gov_act_lang", { l: langNames(law.languages), s: langNames([own(law)]) }))}</p>` : "");
// Fedlex has every act in German, French and Italian: same link, other language
// the collections of Bern (BELEX), Fribourg (BDLF) and Valais (Lex VS) are German and
// French: French readers get the French version (article routes tested 23.11.2026)
export const fedlex = (u) => (LANG === "fr" || LANG === "it") && /fedlex\.admin\.ch\/eli\//.test(u || "")
  ? u.replace(/\/de(?=#|$)/, "/" + LANG)
  : LANG === "fr" && /(belex\.sites\.be\.ch|bdlf\.fr\.ch|lex\.vs\.ch)\/app\/de\//.test(u || "") ? u.replace("/app/de/", "/app/fr/") : u;
// article labels in the notation of the language (Art. 2 Abs. 1 Bst. b)
const ART = {
  fr: [[/^Art\./, "art."], [/ Abs\. /g, ", al. "], [/ Bst\. /g, ", let. "], [/ und /g, " et "]],
  it: [[/^Art\./, "art."], [/ Abs\. /g, " cpv. "], [/ Bst\. /g, " lett. "], [/ und /g, " e "]],
  en: [[/ Abs\. /g, " para. "], [/ Bst\. /g, " let. "], [/ und /g, " and "]],
};
export const artLabel = (a) => (ART[LANG] || []).reduce((s, [re, r]) => s.replace(re, r), a || "");
const REF = { fr: [[/^SR /, "RS "], [/^BBl /, "FF "]], it: [[/^SR /, "RS "], [/^BBl /, "FF "]] };
const refLabel = (r) => (REF[LANG] || []).reduce((s, [re, x]) => s.replace(re, x), r || "");

// cantonal abbreviations that already start with the canton (TG DSG) lose it next to the canton badge
const ktAbbr = (l) => { const a = lawText(l, "abbr") || ""; return l.canton && a.startsWith(l.canton + " ") ? a.slice(l.canton.length + 1) : a; };

export const statusWord = (law) => t(law.status === "in_force" ? "gov_in_force" : "gov_adopted");

// a block name that leads to the laws concerning it
export const blockChip = (key, on) =>
  `<a class="chip${on ? " on" : ""}" href="#/governance?blk=${encodeURIComponent(key)}">${esc(BLOCKS[key] || key)}</a>`;

export function provisionRows(law, only) {
  return law.provisions.filter((p) => !only || p.blocks.includes(only)).map((p) =>
    `<tr><th><a href="${esc(fedlex(p.url))}" rel="noopener">${esc(artLabel(p.art))}</a></th><td>${esc(provText(p, law))}
      <div class="chips">${p.blocks.map((b) => blockChip(b, b === only)).join("")}</div></td></tr>`).join("");
}

export async function render(el, params) {
  const g = await data.governance();
  const only = params.blk && BLOCKS[params.blk] ? params.blk : "";
  const cantons = [...new Set(g.laws.filter((l) => l.level === "canton").map((l) => l.canton))].sort();
  const kt = cantons.includes(params.canton) ? params.canton : "";
  const laws = g.laws.filter((l) => (!only || l.blocks.includes(only)) && (l.level !== "canton" || !kt || l.canton === kt));
  const fed = laws.filter((l) => l.level !== "canton"), can = laws.filter((l) => l.level === "canton");
  const qs = (o) => "#/governance?" + new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
  const one = (l) => `<section class="law" id="law-${esc(l.id)}">
      <h2>${l.canton ? `<span class="kt">${esc(l.canton)}</span> ` : ""}${esc(ktAbbr(l))} <span class="badge ${l.status === "in_force" ? "ok" : "wait"}">${esc(statusWord(l))}</span></h2>
      <p class="sub"><a href="${esc(fedlex(l.url))}" rel="noopener">${esc(lawText(l, "name"))}</a> · ${esc(refLabel(l.ref))}</p>${actLang(l)}
      <p class="small">${esc(lawText(l, "status_text"))} <span class="muted">${esc(t("sources"))}: ${(l.status_sources || []).map((s, i) => link({ ...s, title: (lawText(l, "status_sources") || [])[i] || s.title })).join(" · ")}</span></p>
      <p><b>${esc(t("gov_scope"))}:</b> ${esc(lawText(l, "scope"))}</p>
      <table class="deps gov"><thead><tr><th>${esc(t("gov_art"))}</th><td>${esc(t("gov_provision"))}</td></tr></thead>
        <tbody>${provisionRows(l, only)}</tbody></table></section>`;
  // the three levels of the Swiss state and the law recorded for each (own graphic, no third-party image)
  const ALL = ["ZH", "BE", "LU", "UR", "SZ", "OW", "NW", "GL", "ZG", "FR", "SO", "BS", "BL", "SH", "AR", "AI", "SG", "GR", "AG", "TG", "TI", "VD", "VS", "NE", "GE", "JU"];
  const fedAll = g.laws.filter((l) => l.level !== "canton");
  const missing = ALL.filter((c) => !cantons.includes(c));
  const levels = only || kt ? "" : `<figure class="levels" aria-label="${esc(t("lvl_title"))}">
    <div class="lv"><div class="lvh">${esc(t("lvl_bund"))}</div>
      <div class="chips">${fedAll.map((l) => `<a class="chip" href="#/governance/${encodeURIComponent(l.id)}">${esc(lawText(l, "abbr"))}</a>`).join("")}</div></div>
    <div class="lvarrow" aria-hidden="true">↓</div>
    <div class="lv"><div class="lvh">${esc(t("lvl_kt"))} <span class="muted small">${esc(t("lvl_kt_n", { n: cantons.length }))}</span></div>
      <div class="chips">${ALL.map((c) => cantons.includes(c)
        ? `<a class="chip" href="#/governance?canton=${c}">${c}</a>` : `<span class="chip off" title="${esc(t("lvl_missing"))}">${c}</span>`).join("")}</div>
      ${missing.length ? `<p class="muted small">${esc(t("lvl_missing_list", { c: missing.join(", ") }))}</p>` : ""}</div>
    <div class="lvarrow" aria-hidden="true">↓</div>
    <div class="lv"><div class="lvh">${esc(t("lvl_gem"))}</div><p class="small">${esc(t("lvl_gem_t"))}</p></div>
    <figcaption class="muted small">${esc(t("lvl_caption"))}</figcaption></figure>`;
  el.innerHTML = `<section class="lead"><h1>${esc(t("gov_h1"))}</h1>
      <p>${esc(t("gov_intro"))}</p>
      ${only ? `<p>${esc(t("gov_filtered", { b: BLOCKS[only] }))} · <a href="${qs({ canton: kt })}">${esc(t("gov_show_all"))}</a></p>` : ""}
      ${cantons.length ? `<p><label>${esc(t("gov_canton"))} <select id="govkt"><option value="">${esc(t("gov_all_cantons"))}</option>
        ${cantons.map((c) => `<option${c === kt ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label></p>` : ""}
      <p class="muted small">${esc(t("checked_on", { d: date(g.checked) }))} · ${esc(t("gov_de_only"))}</p></section>
    ${levels}
    ${fed.length ? `<h2 class="lvl">${esc(t("gov_federal"))}</h2>${fed.map(one).join("")}` : ""}
    ${can.length ? `<h2 class="lvl">${esc(t("gov_cantonal"))}</h2><p class="sub">${esc(t("gov_cantonal_note"))}</p>${kt || only
      ? can.map(one).join("")
      // without a chosen canton: one collapsed section per canton
      : [...new Set(can.map((l) => l.canton))].map((c) => { const ls = can.filter((l) => l.canton === c);
          return `<details class="kt-group"><summary><span class="kt">${esc(c)}</span> ${ls.map((l) => esc(ktAbbr(l))).join(", ")}
            <span class="muted small">· ${esc(t("gov_acts", { n: ls.length }))}</span></summary>${ls.map(one).join("")}</details>`; }).join("")}` : ""}
    ${laws.length ? "" : `<p class="muted">${esc(t("gov_none"))}</p>`}`;
  el.querySelector("#govkt")?.addEventListener("change", (ev) => { location.hash = qs({ blk: only, canton: ev.target.value }); });
  if (params.law) document.getElementById("law-" + params.law)?.scrollIntoView();
}

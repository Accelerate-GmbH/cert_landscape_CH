// «Grundlagen»: how the radar rates (weights and thresholds from meta.json, never
// fixed here), the standard behind each check, which data sources feed which
// building block, the limits of the measurement and how to get raw data.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, CATS, t, checkName } from "../text.js";
import { esc } from "../ui.js";

const CAT_OF = { own: "ownership", sov: "sovereignty", sec: "security", prv: "privacy" };
const link = (s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.title)}</a>`;
const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const pct = (w) => `${Math.round(w * 100)} %`;

export async function render(el) {
  const meta = await data.meta();
  const inf = await data.infrastructure().catch(() => ({}));
  const cfg = meta.cfg || {}, src = meta.sources || {}, std = src.checks || {};
  const checks = meta.check_order || [];
  const weights = cfg.checks || {};

  const cats = Object.entries(cfg.category_weights || {}).map(([c, w]) => {
    const rows = checks.filter((id) => CAT_OF[id.split(".")[0]] === c).map((id) =>
      `<tr><td>${esc(checkName(id))} <span class="muted small">${esc(id)}</span></td><td class="num">${weights[id] ?? ""}</td>
        <td>${(std[id] || []).map(link).join("<br>")}</td></tr>`).join("");
    return `<h3>${esc(CATS[c] || c)} <span class="muted small">${esc(t("weight"))} ${pct(w)}</span></h3>
      <div class="scroll"><table class="basics"><thead><tr><th>${esc(t("check"))}</th><th>${esc(t("weight"))}</th><th>${esc(t("standard"))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("");
  const mail = Object.entries(meta.mail_weights || {}).map(([id, w]) =>
    `<tr><td>${esc(checkName(id))} <span class="muted small">${esc(id)}</span></td><td class="num">${w}</td><td>${(std[id] || []).map(link).join("<br>")}</td></tr>`).join("");
  const pts = cfg.points || {};

  const blocks = meta.model.layer.slice().reverse().map((L) => L.blocks.map((b) => {
    const key = `${L.id}.${b.id}`;
    const ds = (src.data || []).filter((d) => (d.blocks || []).includes(key));
    const how = b.none ? t("not_measured") : b.checks ? (b.checks || []).map(checkName).join(", ") : b.mail ? t("mail_checks") : BLOCK_WHAT[key] || "";
    return `<tr><td><b>${esc(BLOCKS[key] || key)}</b><div class="muted small">${esc(LAYERS[L.id].name)}</div></td><td>${esc(how)}</td>
      <td>${ds.map(link).join("<br>") || '<span class="muted">–</span>'}</td></tr>`;
  }).join("")).join("");

  const sources = (src.data || []).map((d) => `<tr><td>${link(d)}</td><td>${esc(d.use)}</td></tr>`).join("");

  el.innerHTML = `<section class="lead"><h1>${esc(t("basics_title"))}</h1>
      <p>${esc(t("basics_intro"))}</p>
      <p class="sub">${esc(t("data_as_of", { d: date((meta.data_generated || "").slice(0, 10)) }))} · ${esc(t("links_checked", { d: date(src.checked) }))}</p></section>
    <section><h2>${esc(t("how_rated"))}</h2>
      <p>${esc(t("rating_text", { g: cfg.green, y: cfg.yellow, p: String(pts.partial ?? "").replace(".", ","), c: cfg.critical_resource_weight }))}
        ${src.rating ? link(src.rating) : ""}</p>
      ${cats}
      <h3>${esc(t("mail"))} <span class="muted small">${esc(t("mail_separate"))}</span></h3>
      <div class="scroll"><table class="basics"><thead><tr><th>${esc(t("check"))}</th><th>${esc(t("weight"))}</th><th>${esc(t("standard"))}</th></tr></thead><tbody>${mail}</tbody></table></div></section>
    <section><h2>${esc(t("blocks_title"))}</h2><div class="scroll"><table class="basics"><thead><tr><th>${esc(t("block"))}</th><th>${esc(t("measured_by"))}</th><th>${esc(t("data_sources"))}</th></tr></thead><tbody>${blocks}</tbody></table></div></section>
    <section><h2>${esc(t("data_sources"))}</h2><div class="scroll"><table class="basics"><tbody>${sources}</tbody></table></div></section>
    ${inf.source ? `<section><h2>${esc(t("dpi_title"))}</h2><p>${esc(t("dpi_text"))} ${link(inf.source)}${(inf.aspect_sources || []).length ? " · " + inf.aspect_sources.map(link).join(" · ") : ""}</p></section>` : ""}
    <section><h2>${esc(t("limits_title"))}</h2><p>${esc(t("limits_text"))}</p></section>
    <section><h2>${esc(t("raw_title"))}</h2><p>${esc(t("raw_text"))}</p></section>`;
}

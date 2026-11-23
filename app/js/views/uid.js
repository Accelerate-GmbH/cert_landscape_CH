// The page of an organisation with a UID (#/uid/<CHE-…>, docs/PRODUCT.md 8.1):
// every role it has in the radar (measured entity, provider, provider under
// ZertES or recognised delivery platform, participant of the swiyu Trust
// Registry), with links to the pages of each role. Without a measured domain
// it says «not measured». Seat, LEI and commercial register number come from
// the UID register; sole proprietorships have no page.
import * as data from "../data.js";
import { t, BLOCKS, LEVEL_ONE } from "../text.js";
import { esc, fmt, light, dot, uidLink } from "../ui.js";

const date = (d) => (d || "").split("-").reverse().map(Number).join(".");

export async function render(el, params) {
  let u;
  try {
    u = await data.uid(params.uid || "");
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(params.uid || "")}</p></section>`;
    return;
  }
  const meta = await data.meta();
  const cfg = meta.cfg;
  const blk = (b) => `<a href="#/baustein/${encodeURIComponent(b)}">${esc(BLOCKS[b] || b)}</a>`;
  const role = (r) => {
    if (r.kind === "entity") return `<tr><th>${esc(t("uid_role_entity"))}</th><td>${r.value === null || r.value === undefined ? "" : `${dot(light(r.value, cfg))} <b>${fmt(r.value)}</b> `}
      <a href="#/org/${encodeURIComponent(r.key)}">${esc(r.name)}</a> <span class="muted small">${esc(LEVEL_ONE[r.level] || r.level)}</span></td></tr>`;
    if (r.kind === "provider") return `<tr><th>${esc(t("uid_role_provider"))}</th><td><a href="#/anbieter/${encodeURIComponent(r.id)}">${esc(r.name)}</a>
      <span class="muted small">${esc(t("kind_" + r.provider_kind) || r.provider_kind || "")} · ${esc(t("uid_by_lei"))}</span></td></tr>`;
    if (r.kind === "swiyu") return `<tr><th>${esc(t("uid_role_swiyu"))}</th><td><span class="badge ${r.env === "production" ? "ok" : "wait"}">${esc(t("env_" + r.env))}</span>
      ${esc(r.name)} · ${blk(r.block)} · <a href="${esc(r.src)}" rel="noopener">${esc(t("reg_swiyu_statement"))}</a></td></tr>`;
    return `<tr><th>${esc(t("uid_role_" + r.kind))}</th><td>${blk(r.block)}<ul class="bd-ev">${(r.services || []).map((s) =>
      `<li>${esc(s.name)} <span class="muted small">${esc(t("kind_" + s.kind) || s.kind)}${s.since ? " · " + esc(t("reg_since", { d: date(s.since) })) : ""}</span></li>`).join("")}</ul></td></tr>`;
  };
  const ids = [
    `UID ${uidLink(u.uid)}`,
    u.lei ? `LEI <a href="https://search.gleif.org/#/record/${encodeURIComponent(u.lei)}" rel="noopener">${esc(u.lei)}</a>` : "",
    u.hr ? `${esc(t("uid_hr"))} ${esc(u.hr)}` : "",
  ].filter(Boolean).join(" · ");
  el.innerHTML = `<section class="lead org" data-uid-page><div class="kind">${esc(t("uid_kind"))}</div>
      <h1>${esc(u.name)}</h1>
      <p class="sub">${u.town ? esc(u.town) + (u.canton ? ` (${esc(u.canton)})` : "") + " · " : ""}${ids}</p>
      ${u.measured ? "" : `<p><span class="badge wait">${esc(t("not_measured"))}</span> ${esc(t("uid_not_measured_d"))}</p>`}</section>
    <section><h2>${esc(t("uid_roles"))}</h2><table class="deps"><tbody>${u.roles.map(role).join("")}</tbody></table>
      <p class="muted small">${u.checked ? esc(t("uid_checked", { d: date(u.checked) })) + " · " : ""}${esc(t("sources"))}: <a href="${esc(u.src)}" rel="noopener">${esc(t("uid_register"))}</a></p></section>`;
}

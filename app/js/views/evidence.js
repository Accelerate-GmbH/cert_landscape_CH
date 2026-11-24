// Evidence behind a host's values (evidence/<level>-<id>.json, loaded when a host is
// opened): every check with status, measured value, method and detail, the time of
// the measurement, addresses and networks, the certificate, and per check a link to
// a public place where anyone can verify it. Links are only followed on click; the
// page itself asks no third party.
import * as data from "../data.js";
import { checkName, t } from "../text.js";
import { esc, dot } from "../ui.js";

const LIGHT = { pass: "green", partial: "yellow", fail: "red" };
const q = encodeURIComponent;

// where a value can be checked by hand
function verify(c, host, ev) {
  const [id, , , method, detail] = c;
  // the zone a DNS check refers to: its own detail, else that of the name server check
  const zoneOf = (x) => (x && !/^https?:/.test(x) && !/\s/.test(x) ? x : "");
  const zone = zoneOf(detail) || zoneOf((ev.chk.find((x) => x[0] === "sov.dns") || [])[4]) || host;
  const cert = ev.cert && ev.cert.src === "crtsh" && ev.cert.id ? `https://crt.sh/?id=${q(ev.cert.id)}` : null;
  const asn = (ev.ips.find((x) => x[1]) || [])[1];
  if (id === "sov.registrar" && /^https:\/\//.test(detail || "")) return detail;
  if (id === "own.sectxt" && /^https:\/\//.test(detail || "")) return detail;
  if (id === "sov.dns") return `https://dns.google/query?name=${q(zone)}&type=NS`;
  if (id === "own.caa") return `https://dns.google/query?name=${q(zone)}&type=CAA`;
  if (id === "prv.ech") return `https://dns.google/query?name=${q(host)}&type=HTTPS`;
  if (id === "own.dnssec") return `https://dnsviz.net/d/${q(zone)}/dnssec/`;
  if (id === "sov.hosting" && asn) return `https://bgp.he.net/AS${q(asn)}`;
  if (["own.identity", "own.ct", "sov.ca"].includes(id) && cert) return cert;
  if (["sec.tls13", "sec.pqc", "sec.hsts", "own.revocation"].includes(id) && method !== "none") return `https://www.ssllabs.com/ssltest/analyze.html?d=${q(host)}`;
  return null;
}

const when = (s) => (s ? new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "–");

// the reason of a knock-out in words (docs/RATING.md, Knock-outs); the measured message stays visible
export const koKind = (ko) => (/hostname mismatch/i.test(ko) ? "mismatch" : /self-signed/i.test(ko) ? "selfsigned" : /expired/i.test(ko) ? "expired"
  : /revoked/i.test(ko) ? "revoked" : /too weak/i.test(ko) ? "weak" : "other");
export function koReason(ko) {
  const k = /hostname mismatch/i.test(ko) ? "mismatch" : /self-signed/i.test(ko) ? "selfsigned" : /expired/i.test(ko) ? "expired"
    : /revoked/i.test(ko) ? "revoked" : /too weak/i.test(ko) ? "weak" : "other";
  return t("ko_" + k);
}

export function table(host, ev, ko) {
  const koLine = ko ? `<p class="ko-line"><span class="tag red">${esc(t("tag_ko"))}</span> ${esc(koReason(ko))} ${esc(t("ko_effect"))}
      <span class="muted small">${esc(t("ko_measured"))}: <span class="mono">${esc(ko)}</span></span></p>` : "";
  // the certificate actually served at each address that does not validate (from the run of 2.12.2026 with its names)
  const served = ((ev && ev.served) || []).map((x) => `<li><span class="mono">${esc(x.ip)}</span>: ${x.names && x.names.length
      ? `${esc(t("ev_served_names"))} <span class="mono">${esc(x.names.slice(0, 6).join(", "))}${x.names.length > 6 ? " …" : ""}</span>` : x.subj ? `CN <span class="mono">${esc(x.subj)}</span>` : ""}
      ${x.iss ? ` · ${esc(x.iss)}` : ""}${x.exp ? ` · ${esc(t("ev_until", { d: String(x.exp).slice(0, 10) }))}` : ""}
      ${x.sha ? ` · <a href="${esc(x.src)}" rel="noopener noreferrer" title="SHA-256 ${esc(x.sha)}">${esc(t("ev_served_check"))}</a>` : ""}
      ${x.name_ok ? ` <span class="tag">${esc(t("ev_served_suspect"))}</span>` : ""}</li>`).join("");
  const koBlock = koLine + (served ? `<p class="small">${esc(t("ev_served"))}</p><ul class="bd-ev">${served}</ul>` : "");
  if (!ev) return koBlock + `<p class="muted small">${esc(t("ev_none"))}</p>`;
  const rows = ev.chk.map((c) => {
    const [id, status, value, method, detail] = c;
    const link = verify(c, host, ev);
    return `<tr><td>${status in LIGHT ? dot(LIGHT[status]) : '<span class="muted">–</span>'} ${esc(checkName(id))}</td>
      <td>${esc(value === true ? t("yes") : value === false ? t("no") : String(value ?? "").replace(/(^|, )\s*\(\)(?=, |$)/g, "$1–"))}</td>
      <td class="muted small">${esc(t("m_" + method.replace(/[^a-z]/g, "_")) || method)}${detail && !/^https?:/.test(detail) ? " · " + esc(detail) : ""}</td>
      <td>${link ? `<a href="${esc(link)}" rel="noopener noreferrer">${esc(t("ev_check"))}</a>` : ""}</td></tr>`;
  }).join("");
  const c = ev.cert;
  return `<div class="ev">${koBlock}<p class="small">${esc(t("ev_measured", { d: when(ev.at) }))}
      ${ev.ips.length ? " · " + ev.ips.map((x) => `${esc(x[0])}${x[2] ? ` (AS${esc(x[1])} ${esc(x[2])}, ${esc(x[3])})` : ""}`).join(", ") : ""}</p>
    ${c ? `<p class="small">${esc(t(c.src === "crtsh" ? "ev_cert_ct" : "ev_cert"))}: ${esc(c.iss || "")}${c.org ? ` · ${esc(c.org)}` : ""}${c.val ? ` · ${esc(c.val)}` : ""}${c.exp ? ` · ${esc(t("ev_until", { d: c.exp.slice(0, 10) }))}` : ""}</p>` : ""}
    <div class="scroll"><table class="evt"><thead><tr><th>${esc(t("check"))}</th><th>${esc(t("value"))}</th><th>${esc(t("ev_method"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// opens the evidence below a host row; the file is loaded once per entity
export function wire(el, key, kos = {}) {
  el.querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", async () => {
    const host = b.dataset.ev, row = b.closest("tr");
    const next = row.nextElementSibling;
    if (next && next.classList.contains("evrow")) { next.remove(); b.setAttribute("aria-expanded", "false"); return; }
    let ev = null;
    try { ev = ((await data.evidence(b.dataset.evkey || key)).hosts || {})[host] || null; } catch { /* no evidence file */ }
    const tr = document.createElement("tr");
    tr.className = "evrow";
    tr.innerHTML = `<td colspan="${row.children.length}">${table(host, ev, kos[host])}</td>`;
    row.after(tr);
    b.setAttribute("aria-expanded", "true");
  }));
}

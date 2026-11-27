// Feedback on every page (docs/PRODUCT.md, section 15): kind, text, optional source. On «Send»
// the form opens a prefilled issue in the public repository (form .github/ISSUE_TEMPLATE/feedback.yml);
// a workflow moves it into the private repository (data/reported/inbox/) and removes the text from
// the issue. Page, language, role, data date, the settings of the selectors and the evidence opened last go along, with links to
// check it. Nothing is sent when the page loads.
import { esc, store } from "./ui.js";
import { LANG, t } from "./text.js";

const REPO = "https://github.com/Accelerate-GmbH/cert_landscape_CH";
const KINDS = ["wrong", "missing", "idea", "feedback"];
// options of the issue form, prefilled by their label
const FORM_KIND = { wrong: "Wrong data", missing: "Missing data", idea: "Suggestion", feedback: "Feedback on the page" };
let last = null;   // evidence opened last on this page: {kind, key, label}

// the element a click opened, if it carries evidence
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-ev],[data-blk],[data-tile],[data-fail],[data-pfail]");
  if (!el || el.closest(".fb")) return;
  if (el.dataset.ev) last = { kind: "host", key: el.dataset.ev, entity: el.dataset.evkey || "" };
  else if (el.dataset.blk) last = { kind: "block", key: el.dataset.blk };
  else if (el.dataset.tile) last = { kind: "tile", key: (el.getAttribute("title") || "").split(":")[0] };
  else last = { kind: "check", key: el.dataset.fail || el.dataset.pfail };
}, true);
window.addEventListener("hashchange", () => { last = null; });
// the button at the top right opens the form at the foot of the page
document.getElementById("fbbtn")?.addEventListener("click", () => {
  const d = document.querySelector("#fb details");
  if (!d) return;
  d.open = true;
  d.scrollIntoView({ behavior: "smooth", block: "center" });
  d.querySelector("textarea")?.focus({ preventScroll: true });
});

// links to check the evidence by hand, where one exists
function checks(e) {
  if (!e || e.kind !== "host") return [];
  const h = e.key.replace(/^\*\./, "");
  return [`https://crt.sh/?q=${encodeURIComponent(h)}`, `https://dns.google/query?name=${encodeURIComponent(h)}&type=A`];
}

// settings of the selectors on the page: drop-downs, search fields, chosen tabs and fields,
// sorted columns and opened sections, so that the page can be seen as the sender saw it
const short = (x) => (x || "").replace(/\s+/g, " ").trim().slice(0, 40);
function settings() {
  const v = document.getElementById("view");
  if (!v) return "";
  const out = [];
  v.querySelectorAll("select").forEach((s) => {
    const name = s.dataset.f || s.id || s.getAttribute("aria-label") || s.name || "select";
    out.push(`${name}=${s.value}`);
  });
  v.querySelectorAll('input[type="search"], input[type="text"]').forEach((i) => {
    if (i.value.trim() && !i.closest(".fb")) out.push(`${i.id || i.dataset.regq !== undefined && "regq" || i.getAttribute("aria-label") || "search"}="${short(i.value)}"`);
  });
  v.querySelectorAll('.on, [aria-pressed="true"], [aria-selected="true"]').forEach((e) => {
    const d = Object.entries(e.dataset).find(([k]) => k !== "evkey");
    out.push(`on:${d ? `${d[0]}=${d[1]}` : short(e.textContent)}`);
  });
  v.querySelectorAll("[aria-sort]").forEach((e) => out.push(`sort:${short(e.textContent)} ${e.getAttribute("aria-sort")}`));
  v.querySelectorAll("details[open] > summary").forEach((e) => { if (!e.closest(".fb")) out.push(`open:${short(e.textContent)}`); });
  return [...new Set(out)].join("; ").slice(0, 1500);
}

function issueUrl(kind, text, source, asof) {
  const page = location.href;
  const e = last;
  const evid = e ? `${e.kind}: ${e.key}${e.entity ? ` (${e.entity})` : ""}` : "";
  const ctx = [`page: ${page}`, `lang: ${LANG}`, `role: ${store.get("tp.role") || "lay"}`, `data: ${asof}`, settings() ? `settings: ${settings()}` : "", evid ? `evidence: ${evid}` : "",
    ...checks(e).map((u) => `check: ${u}`)].filter(Boolean).join("\n");
  const title = `[Feedback] ${t("fb_kind_" + kind)}: ${decodeURIComponent(location.hash.replace(/^#\/?/, "")) || "/"}`.slice(0, 120);
  const q = new URLSearchParams({ template: "feedback.yml", labels: "feedback", title, kind: FORM_KIND[kind], text, source, context: ctx });
  return `${REPO}/issues/new?${q}`;
}

export function render(asof) {   // asof: function returning the data date
  let box = document.getElementById("fb");
  if (!box) {
    box = document.createElement("section");
    box.id = "fb";
    box.className = "fb";
    document.querySelector("footer").before(box);
  }
  box.innerHTML = `<details><summary>${esc(t("fb_title"))}</summary>
    <form class="fbf">
      <label>${esc(t("fb_kind"))} <select name="kind">${KINDS.map((k) => `<option value="${k}">${esc(t("fb_kind_" + k))}</option>`).join("")}</select></label>
      <label class="wide">${esc(t("fb_text"))}<textarea name="text" rows="4" maxlength="4000" required></textarea></label>
      <label class="wide">${esc(t("fb_source"))} <input name="source" type="text" maxlength="500" placeholder="https://…"></label>
      <p class="muted small fbctx"></p>
      <p class="muted small">${esc(t("fb_note"))}</p>
      <button type="submit">${esc(t("fb_send"))}</button>
    </form></details>`;
  const form = box.querySelector("form"), ctx = box.querySelector(".fbctx");
  const showCtx = () => { const st = settings();
    ctx.textContent = t("fb_ctx", { p: location.hash || "#/" }) + (st ? " · " + t("fb_ctx_set", { s: st }) : "") + (last ? " · " + t("fb_ctx_ev", { e: last.key }) : ""); };
  box.querySelector("details").addEventListener("toggle", showCtx);
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const text = String(f.get("text") || "").trim();
    if (!text) return;
    window.open(issueUrl(f.get("kind"), text, String(f.get("source") || "").trim(), asof()), "_blank", "noopener");
  });
}

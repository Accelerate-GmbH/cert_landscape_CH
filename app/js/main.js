// Router and shared controls: search with suggestions, role, home organisation.
import * as data from "./data.js";
import * as start from "./views/start.js";
import * as org from "./views/org.js";
import * as compare from "./views/compare.js";
import * as deps from "./views/deps.js";
import * as infra from "./views/infra.js";
import * as service from "./views/service.js";
import * as basics from "./views/basics.js";
import * as gov from "./views/gov.js";
import * as report from "./views/report.js";
import * as plan from "./views/plan.js";
import * as lens from "./views/lens.js";
import { esc, store } from "./ui.js";
import { LEVEL_ONE, LANG, LANGS, setLang, t } from "./text.js";

const view = document.getElementById("view");

// texts of the page frame (header, footer) in the chosen language
function frame() {
  document.documentElement.lang = LANG;
  document.querySelectorAll("[data-t]").forEach((n) => { n.textContent = t(n.dataset.t); });
  document.querySelectorAll("[data-t-ph]").forEach((n) => { n.placeholder = t(n.dataset.tPh); });
  document.querySelectorAll("[data-t-label]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.tLabel)); });
}
const langSel = document.getElementById("lang");
langSel.innerHTML = Object.keys(LANGS).map((l) => `<option value="${l}"${l === LANG ? " selected" : ""}>${l.toUpperCase()}</option>`).join("");
langSel.addEventListener("change", () => { setLang(langSel.value); frame(); route(); });
frame();
const roleSel = document.getElementById("role");
roleSel.value = store.get("tp.role") || "lay";
roleSel.addEventListener("change", () => { store.set("tp.role", roleSel.value); route(); });

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "karte") return { name: "start", sub: "lens", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "grundlagen") return { name: "basics", params };
  if (parts[0] === "governance") return { name: "gov", params: { ...params, law: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "baustein") return { name: "start", sub: "infra", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "abhaengigkeiten") return { name: "deps", params };
  if (parts[0] === "anbieter" && parts[1]) return { name: "deps", sub: "anbieter", params: { ...params, id: decodeURIComponent(parts[1]) } };
  if (parts[0] === "dienst" && parts[1]) return { name: "start", sub: "dienst", params: { ...params, id: decodeURIComponent(parts[1]) } };
  if (parts[0] === "anbieter") return { name: "deps", params };
  if (parts[0] === "vergleich") return { name: "compare", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "org" && parts[2] === "plan") return { name: "org", sub: "plan", params: { ...params, key: decodeURIComponent(parts[1] || "") } };
  if (parts[0] === "org" && parts[2] === "bericht") return { name: "org", sub: "report", params: { ...params, key: decodeURIComponent(parts[1] || "") } };
  if (parts[0] === "org") return { name: "org", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  return { name: "start", params };
}

async function route() {
  const r = parse();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.name));
  view.innerHTML = `<p class="muted">${esc(t("loading"))}</p>`;
  try {
    if (r.sub === "report") await report.render(view, r.params, roleSel.value);
    else if (r.sub === "plan") await plan.render(view, r.params);
    else if (r.name === "org") await org.render(view, r.params, roleSel.value);
    else if (r.sub === "lens") await lens.render(view, r.params);
    else if (r.name === "basics") await basics.render(view, r.params);
    else if (r.name === "gov") await gov.render(view, r.params);
    else if (r.sub === "infra") await infra.render(view, r.params, roleSel.value);
    else if (r.sub === "dienst" || r.sub === "anbieter") await service.render(view, r.params, r.sub);
    else if (r.name === "deps") await deps.renderList(view, r.params);
    else if (r.name === "compare") await compare.render(view, r.params, roleSel.value);
    else await start.render(view, r.params, roleSel.value);
  } catch (e) {
    view.innerHTML = `<p>${esc(t("load_error", { e: e.message }))}</p>`;
  }
  if (!(r.name === "gov" && r.params.law) && r.params.to !== "rank") window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// search with suggestions over all entities
const q = document.getElementById("q"), sugg = document.getElementById("sugg");
let rows = [], active = -1;
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
data.index().then((ix) => { rows = ix.rows.map((r) => [...r, norm(r[1] + " " + (r[4] || ""))]); });
function show(list) {
  sugg.innerHTML = list.map((r, i) => `<li role="option" id="s${i}" data-key="${esc(r[0])}"${i === active ? ' aria-selected="true"' : ""}>
    <b>${esc(r[1])}</b> <span class="muted">${esc(LEVEL_ONE[r[0].split(":")[0]])}${r[2] ? " · " + esc(r[2]) : ""}${r[5] ? " · " + esc(r[0].startsWith("education:") ? t("edu_" + r[5]) : r[5]) : ""}</span></li>`).join("");
  sugg.hidden = !list.length;
  q.setAttribute("aria-expanded", String(!!list.length));
}
let current = [];
q.addEventListener("input", () => {
  const t = norm(q.value.trim());
  active = -1;
  if (t.length < 2) { current = []; show(current); return; }
  current = rows.filter((r) => r[6].includes(t))
    .sort((a, b) => (norm(a[1]).startsWith(t) ? 0 : 1) - (norm(b[1]).startsWith(t) ? 0 : 1) || a[1].length - b[1].length).slice(0, 10);
  show(current);
});
q.addEventListener("keydown", (ev) => {
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    active = Math.max(0, Math.min(current.length - 1, active + (ev.key === "ArrowDown" ? 1 : -1)));
    show(current);
  } else if (ev.key === "Enter" && current.length) {
    go(current[Math.max(0, active)][0]);
  } else if (ev.key === "Escape") { show([]); }
});
sugg.addEventListener("mousedown", (ev) => { const li = ev.target.closest("li"); if (li) go(li.dataset.key); });
function go(key) { q.value = ""; current = []; show([]); location.hash = `#/org/${encodeURIComponent(key)}`; }

data.meta().then((m) => { document.getElementById("asof").textContent = (m.data_generated || "").slice(0, 10); });
route();

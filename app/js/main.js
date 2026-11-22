// Router and shared controls: search with suggestions, role, home organisation.
import * as data from "./data.js";
import * as start from "./views/start.js";
import * as org from "./views/org.js";
import * as compare from "./views/compare.js";
import * as deps from "./views/deps.js";
import { esc, store } from "./ui.js";
import { LEVEL_ONE } from "./text.js";

const view = document.getElementById("view");
const roleSel = document.getElementById("role");
roleSel.value = store.get("tp.role") || "lay";
roleSel.addEventListener("change", () => { store.set("tp.role", roleSel.value); route(); });

function parse() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "abhaengigkeiten") return { name: "deps", params };
  if (parts[0] === "anbieter") return { name: "deps", params: { ...params, id: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "vergleich") return { name: "compare", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  if (parts[0] === "org") return { name: "org", params: { ...params, key: parts[1] ? decodeURIComponent(parts[1]) : undefined } };
  return { name: "start", params };
}

async function route() {
  const r = parse();
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === r.name));
  view.innerHTML = '<p class="muted">Lade …</p>';
  try {
    if (r.name === "org") await org.render(view, r.params, roleSel.value);
    else if (r.name === "deps") await (r.params.id ? deps.renderProvider(view, r.params) : deps.renderList(view, r.params));
    else if (r.name === "compare") await compare.render(view, r.params, roleSel.value);
    else await start.render(view, r.params, roleSel.value);
  } catch (e) {
    view.innerHTML = `<p>Die Daten konnten nicht geladen werden (${esc(e.message)}).</p>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);

// search with suggestions over all entities
const q = document.getElementById("q"), sugg = document.getElementById("sugg");
let rows = [], active = -1;
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
data.index().then((ix) => { rows = ix.rows.map((r) => [...r, norm(r[1] + " " + (r[4] || ""))]); });
function show(list) {
  sugg.innerHTML = list.map((r, i) => `<li role="option" id="s${i}" data-key="${esc(r[0])}"${i === active ? ' aria-selected="true"' : ""}>
    <b>${esc(r[1])}</b> <span class="muted">${esc(LEVEL_ONE[r[0].split(":")[0]])}${r[2] ? " · " + esc(r[2]) : ""}${r[5] ? " · " + esc(r[5]) : ""}</span></li>`).join("");
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

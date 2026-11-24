// Use of a data exchange service (sedex, I14Y; infrastructure.json, `usage`): a short summary, the
// map of the cantons and municipalities, and a treemap of domains or themes whose fields are as large
// as their use; a click on a field shows its detail. Aggregates only, no lists of entries.
import { t, LANG } from "../text.js";
import { esc } from "../ui.js";
import { usersMap } from "./usermap.js";

const txt = (o) => (o ? o[LANG] || o.de || o.en || Object.values(o)[0] || "" : "");

// squarified treemap (Bruls, Huizing, van Wijk 2000) in a w × h box; returns [{item, x, y, w, h}]
function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.filter((i) => i.n > 0).sort((a, b) => b.n - a.n);
  const total = rest.reduce((a, i) => a + i.n, 0);
  const scale = (w * h) / (total || 1);
  const worst = (row, side) => {
    const s = row.reduce((a, i) => a + i.n * scale, 0);
    return Math.max(...row.map((i) => Math.max((side * side * i.n * scale) / (s * s), (s * s) / (side * side * i.n * scale))));
  };
  while (rest.length) {
    const side = Math.min(w, h);
    let row = [rest[0]], i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) row.push(rest[i++]);
    rest = rest.slice(row.length);
    const s = row.reduce((a, r) => a + r.n * scale, 0);
    if (w >= h) {
      const rw = s / h; let yy = y;
      row.forEach((r) => { const rh = (r.n * scale) / rw; out.push({ item: r, x, y: yy, w: rw, h: rh }); yy += rh; });
      x += rw; w -= rw;
    } else {
      const rh = s / w; let xx = x;
      row.forEach((r) => { const rw = (r.n * scale) / rh; out.push({ item: r, x: xx, y, w: rw, h: rh }); xx += rw; });
      y += rh; h -= rh;
    }
  }
  return out;
}

function detail(u, tile) {
  const d = tile.detail || {};
  if (u.kind === "sedex") {
    if (d.domains) return `<p>${esc(d.domains.map(([n, c]) => `${n} ${c}`).join(" · "))}</p>`;
    const cant = Object.entries(d.cantons || {}).slice(0, 8).map(([c, n]) => `${c} ${n}`).join(" · ");
    return `<p><b>${esc(txt(tile.label))}</b> · ${esc(t("us_participants", { n: tile.n }))}${d.office ? ` · ${esc(t("us_office"))}: ${esc(d.office)}` : ""}</p>
      ${d.description ? `<p class="sub">${esc(d.description)}</p>` : ""}
      ${cant ? `<p class="small"><span class="muted">${esc(t("us_by_canton"))}:</span> ${esc(cant)}</p>` : ""}
      <p class="small"><span class="muted">${esc(t("us_msgtypes", { n: d.message_types || 0 }))}</span>${(d.examples || []).length ? `: ${esc(d.examples.join(" · "))}` : ""}</p>`;
  }
  const counts = Object.entries(d.counts || {}).map(([k, n]) => `${t("us_type_" + k)} ${n}`).join(" · ");
  return `<p><b>${esc(txt(tile.label))}</b> · ${esc(t("us_entries", { n: tile.n }))}</p><p class="small">${esc(counts)}</p>
    ${(d.publishers || []).length ? `<p class="small"><span class="muted">${esc(t("us_publishers"))}:</span> ${esc(d.publishers.map((p) => `${txt(p.name)} ${p.n}`).join(" · "))}</p>` : ""}`;
}

export async function usageView(u, ix) {
  const s = u.summary || {};
  const head = u.kind === "sedex"
    ? t("us_sedex_sum", { p: s.participants, d: s.domains, m: s.message_types, t: s.test_participants })
    : t("us_i14y_sum", { e: s.entries, p: s.publishers, ds: s.datasets, sv: s.dataservices, ps: s.publicservices, c: s.concepts });
  const map = await usersMap(u.map_keys || [], ix, { lists: false, note: "" });
  const W = 1000, H = 420;
  const cells = squarify(u.tiles || [], 0, 0, W, H).map((c, i) => {
    const big = c.w > 90 && c.h > 34;
    return `<button class="tm-cell" data-tile="${i}" style="left:${(100 * c.x) / W}%;top:${(100 * c.y) / H}%;width:${(100 * c.w) / W}%;height:${(100 * c.h) / H}%"
      title="${esc(`${txt(c.item.label)}: ${c.item.n}`)}">${big ? `<span>${esc(txt(c.item.label))}</span><b>${c.item.n}</b>` : ""}</button>`;
  });
  const order = squarify(u.tiles || [], 0, 0, W, H).map((c) => c.item);
  const html = `<p>${esc(head)}</p>
    ${u.kind === "i14y" ? `<p class="muted small">${esc(t("us_i14y_note"))}</p>` : ""}
    ${map.html}
    ${u.map_assessment ? `<p class="muted small">${esc(t("us_sedex_map"))}</p>` : ""}
    <h3>${esc(t(u.kind === "sedex" ? "us_tm_sedex" : "us_tm_i14y"))}</h3>
    <div class="treemap" role="group" aria-label="${esc(t(u.kind === "sedex" ? "us_tm_sedex" : "us_tm_i14y"))}">${cells.join("")}</div>
    <div class="tm-detail" data-tmdetail><p class="muted small">${esc(t("us_tm_hint"))}</p></div>
    <p class="muted small">${esc(t("reg_fetched", { c: (u.fetched || "").split("-").reverse().map(Number).join(".") }))} · ${esc(t("sources"))}: ${(u.sources || []).map((x) => `<a href="${esc(x.url)}" rel="noopener">${esc(x.title)}</a>`).join(" · ")}</p>`;
  const bind = (el) => {
    map.bind(el);
    const box = el.querySelector("[data-tmdetail]");
    el.querySelectorAll("[data-tile]").forEach((b) => b.addEventListener("click", () => {
      el.querySelectorAll("[data-tile]").forEach((x) => x.classList.toggle("on", x === b));
      box.innerHTML = detail(u, order[+b.dataset.tile]);
    }));
  };
  return { html, bind };
}

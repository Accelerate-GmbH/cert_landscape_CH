// «Entwicklung»: the overall value of one entity per month (history/<level>-<id>.json),
// a line with one marker per month and a table with the categories. One series: no
// legend, the heading names it; values on hover and in the table.
import { CATS, t, monthName } from "../text.js";
import { esc, fmt, light, dot } from "../ui.js";

const W = 640, H = 170, L = 34, R = 14, T = 16, B = 26, PAD = 36;   // PAD keeps the first and last month off the edges

function chart(points, cfg) {
  const pts = points.filter((p) => p.overall !== null && p.overall !== undefined);
  const x = (i) => (pts.length === 1 ? (L + W - R) / 2 : L + PAD + (i * (W - L - R - 2 * PAD)) / (pts.length - 1));
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const grid = [0, 50, 100].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.overall).toFixed(1)}`).join("");
  const marks = pts.map((p, i) => `<g class="pt" tabindex="0"><title>${esc(monthName(p.month))}: ${fmt(p.overall)}</title>
      <circle class="hit" cx="${x(i)}" cy="${y(p.overall)}" r="12"/><circle class="mk ${light(p.overall, cfg)}" cx="${x(i)}" cy="${y(p.overall)}" r="4.5"/></g>`).join("");
  const step = Math.ceil(pts.length / 8);
  const labels = pts.map((p, i) => (i % step === 0 || i === pts.length - 1 ? `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(monthName(p.month))}</text>` : "")).join("");
  const last = pts[pts.length - 1];
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("trend_chart"))}">${grid}
    <path class="ln" d="${line}"/>${marks}${labels}
    <text class="val" x="${x(pts.length - 1)}" y="${y(last.overall) - 10}" text-anchor="middle">${fmt(last.overall)}</text></svg>`;
}

function table(points) {
  const cats = Object.keys(CATS);
  return `<div class="scroll"><table class="trendtab"><thead><tr><th>${esc(t("month"))}</th><th>${esc(t("overall"))}</th>
    ${cats.map((c) => `<th>${esc(CATS[c])}</th>`).join("")}<th>${esc(t("mail"))}</th></tr></thead>
    <tbody>${points.slice().reverse().map((p) => `<tr><td>${esc(monthName(p.month))}</td><td><b>${fmt(p.overall)}</b></td>
      ${cats.map((c) => `<td>${fmt((p.categories || {})[c])}</td>`).join("")}<td>${fmt(p.mail)}</td></tr>`).join("")}</tbody></table></div>`;
}

export function render(h, cfg) {
  if (!h) return "";
  const pts = h.points || [];
  const rated = pts.filter((p) => p.overall !== null && p.overall !== undefined);
  let body;
  if (!rated.length) body = `<p class="muted">${esc(t("trend_none"))}</p>`;
  else if (rated.length === 1) body = `<p>${dot(light(rated[0].overall, cfg))} <b>${fmt(rated[0].overall)}</b> · ${esc(t("trend_one", { m: monthName(rated[0].month) }))}</p>`;
  else {
    const first = rated[0], last = rated[rated.length - 1], d = Math.round(last.overall - first.overall);
    body = `<p class="sub">${esc(t("change", { d: (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d), m: monthName(first.month) }))}</p>${chart(pts, cfg)}${table(pts)}`;
  }
  const preds = (h.predecessors || []).map((p) => {
    const lp = (p.points || []).filter((x) => x.overall !== null && x.overall !== undefined).pop();
    return `<li>${esc(t("merged_into", { d: p.merged.split("-").reverse().map(Number).join("."), n: p.name }))}${lp ? ` · ${esc(t("last_value", { v: fmt(lp.overall), m: monthName(lp.month) }))}` : ""}</li>`;
  }).join("");
  return `<section><h2>${esc(t("trend"))}</h2>${body}${preds ? `<ul class="preds small">${preds}</ul>` : ""}</section>`;
}

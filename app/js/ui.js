export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fmt = (v) => (v === null || v === undefined ? "–" : Math.round(v));

export function light(v, cfg) {
  if (v === null || v === undefined) return "none";
  const g = (cfg && cfg.green) || 80, y = (cfg && cfg.yellow) || 50;
  return v >= g ? "green" : v >= y ? "yellow" : "red";
}
export const LIGHT_WORD = { green: "gut", yellow: "Lücken", red: "Handlungsbedarf", none: "keine Daten" };

export function dot(l, label) {
  return `<span class="dot ${l}" role="img" aria-label="${esc(label || LIGHT_WORD[l])}"></span>`;
}

// own value against the benchmark, on a 0–100 scale
export function bar(own, best, bestLabel) {
  const o = own === null || own === undefined ? null : Math.max(0, Math.min(100, own));
  const b = best === null || best === undefined ? null : Math.max(0, Math.min(100, best));
  return `<div class="bar" role="img" aria-label="eigener Wert ${fmt(o)}, ${esc(bestLabel)} ${fmt(b)}">
    ${o !== null ? `<span class="own" style="width:${o}%"></span>` : ""}
    ${b !== null ? `<span class="best" style="left:${b}%" title="${esc(bestLabel)}: ${fmt(b)}"></span>` : ""}
  </div>`;
}

export const cc = (c) => (c ? `<span class="cc${c === "CH" ? "" : " abroad"}">${esc(c)}</span>` : "");
export const uidLink = (u) => (u ? `<a href="https://www.uid.admin.ch/Detail.aspx?uid_id=${encodeURIComponent(u)}" target="_blank" rel="noopener" title="Eintrag im UID-Register">${esc(u)}</a>` : "");

export const HOME_KEY = "tp.home";
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// Monthly report of one entity (#/org/<key>/bericht, ?m=YYYY-MM for an earlier month):
// the value and its categories against the month before, the checks that changed,
// the comparison with the best of the level and, for the current month, the next
// steps. Printable (the browser saves it as PDF); the RSS feed of the entity lists
// the same months. Everything from the entity file, its history and benchmarks.
import * as data from "../data.js";
import { LEVEL_ONE, LEVEL_DAT, CATS, LIGHT_WORD, checkName, checkText, monthName, t } from "../text.js";
import { esc, fmt, light, dot } from "../ui.js";

const date = (d) => (d || "").split("-").reverse().map(Number).join(".");
const delta = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : Math.round((a - b) * 10) / 10);
const signed = (x) => (x === null ? "–" : (x > 0 ? "+" : "") + fmt(x));
const share = (k) => {
  if (!k) return null;
  const n = k.assessed ?? (k.pass || 0) + (k.partial || 0) + (k.fail || 0);
  return n ? (100 * ((k.pass || 0) + 0.5 * (k.partial || 0))) / n : null;
};

export async function render(el, params, role) {
  let d;
  try {
    d = await data.entity(params.key);
  } catch {
    el.innerHTML = `<section class="lead"><h1>${esc(t("not_found"))}</h1><p>${esc(params.key || "")}</p></section>`;
    return;
  }
  const [meta, bm, hist] = await Promise.all([data.meta(), data.benchmarks(), data.history(d.key).catch(() => ({ points: [] }))]);
  const cfg = meta.cfg, B = bm[d.kind] || {};
  const pts = hist.points || [];
  const i = Math.max(0, params.m ? pts.findIndex((p) => p.month === params.m) : pts.length - 1);
  const cur = pts[i] || null, prev = i > 0 ? pts[i - 1] : null;
  const latest = !pts.length || i === pts.length - 1;
  const best = (b) => (!b ? null : b.mode === "top" ? b.mean : b.value);
  const bestLabel = (b) => (!b ? "" : b.mode === "top" ? t("best_top", { p: Math.round(b.share * 100) }) : t("best_one"));
  const slug = d.key.replace(":", "-");

  const months = pts.length > 1 ? `<label class="noprint">${esc(t("rep_month"))}
      <select id="repm">${pts.map((p, n) => `<option value="${esc(p.month)}"${n === i ? " selected" : ""}>${esc(monthName(p.month))}</option>`).join("")}</select></label>` : "";
  const head = `<section class="lead org report">
    <div class="kind">${esc(t("rep_title"))} · ${esc(LEVEL_ONE[d.kind] || d.kind)}${d.canton ? " · " + esc(d.canton) : ""}</div>
    <h1>${esc(d.name)}</h1>
    <p class="sub">${esc(cur ? t("rep_as_of", { m: monthName(cur.month), d: date(cur.run) }) : t("no_data_yet"))}</p>
    <p class="noprint"><button class="home" onclick="window.print()">${esc(t("rep_print"))}</button>
      <a href="data/rss/${esc(slug)}.xml">${esc(t("rep_rss"))}</a> · <a href="#/org/${encodeURIComponent(d.key)}">${esc(t("rep_to_org"))}</a> ${months}</p>
  </section>`;

  if (!cur) {
    el.innerHTML = head + `<p class="muted">${esc(t("no_data_yet"))}</p>`;
    return;
  }

  // value and categories against the month before and the best of the level
  const row = (label, now, before, b) => `<tr><th>${esc(label)}</th>
    <td>${now === null || now === undefined ? "–" : `${dot(light(now, cfg))} <b>${fmt(now)}</b>`}</td>
    <td>${before === null || before === undefined ? "–" : fmt(before)}</td><td>${prev ? signed(delta(now, before)) : "–"}</td>
    <td>${b ? `${fmt(best(b))} <span class="muted small">${esc(bestLabel(b))}</span>` : "–"}</td></tr>`;
  const values = `<table class="deps rep"><thead><tr><th></th><td>${esc(monthName(cur.month))}</td><td>${esc(t("rep_prev"))}</td><td>${esc(t("rep_delta"))}</td><td>${esc(t("rep_best", { lv: LEVEL_DAT[d.kind] }))}</td></tr></thead><tbody>
    ${row(t("overall"), cur.overall, prev && prev.overall, B.overall)}
    ${Object.entries(cur.categories || {}).map(([c, v]) => row(CATS[c] || c, v, prev && (prev.categories || {})[c], B["cat:" + c])).join("")}
    ${row(t("mail"), cur.mail, prev && prev.mail, null)}</tbody></table>
    <p class="muted small">${esc(t("rep_hosts", { n: cur.hosts ?? "–" }))}${cur.knockouts ? " · " + esc(t("with_ko", { n: cur.knockouts })) : ""}${cur.overall !== null && cur.overall !== undefined ? " · " + esc(LIGHT_WORD[light(cur.overall, cfg)]) : ""}</p>`;

  // checks that moved by at least one point
  let changes;
  if (!prev) changes = `<p class="muted">${esc(t("rep_first"))}</p>`;
  else {
    const moved = Object.keys({ ...(cur.checks || {}), ...(prev.checks || {}) })
      .map((c) => [c, delta((cur.checks || {})[c], (prev.checks || {})[c]), (cur.checks || {})[c]])
      .filter(([, x]) => x !== null && Math.abs(x) >= 1).sort((a, b) => b[1] - a[1]);
    const list = (arr) => `<ul class="plain">${arr.map(([c, x, v]) => `<li>${dot(light(v, cfg))} ${esc(checkName(c))}: ${fmt(v)} % <span class="muted">(${signed(x)})</span></li>`).join("")}</ul>`;
    const up = moved.filter(([, x]) => x > 0), down = moved.filter(([, x]) => x < 0).reverse();
    changes = moved.length ? `<div class="two"><div><h3>${esc(t("rep_better"))}</h3>${up.length ? list(up) : "<p>–</p>"}</div>
        <div><h3>${esc(t("rep_worse"))}</h3>${down.length ? list(down) : "<p>–</p>"}</div></div>`
      : `<p>${esc(t("rep_nochange"))}</p>`;
  }

  // next steps: the weakest checks of the current month (as on the organisation page)
  let steps = `<p class="muted">${esc(t("rep_next_old"))}</p>`;
  if (latest) {
    const p = d.posture || {};
    const all = [...Object.entries(p.checks || {}), ...Object.entries((d.mail || {}).checks || {})]
      .map(([id, k]) => [id, share(k)]).filter(([, v]) => v !== null && v < (cfg.green || 80)).sort((a, b) => a[1] - b[1]).slice(0, 4);
    steps = all.length ? `<ol class="steps">${all.map(([id, v]) => {
      const bb = B["chk:" + id];
      return `<li><div class="st">${dot(light(v, cfg))} <b>${esc(checkName(id))}</b> <span class="muted">${fmt(v)} %${bb ? ` · ${bestLabel(bb)}: ${fmt(best(bb))} %` : ""}</span></div><p>${esc(checkText(id, role))}</p></li>`;
    }).join("")}</ol>` : `<p>${esc(t("none_below", { g: cfg.green || 80 }))}</p>`;
  }

  el.innerHTML = head +
    `<section><h2>${esc(t("rep_values"))}</h2>${values}</section>
     <section><h2>${esc(t("rep_changes"))}</h2>${changes}</section>
     <section><h2>${esc(t("next_steps"))}</h2>${steps}</section>
     <section class="note"><p class="small">${esc(t("rep_basis", { d: date(cur.run), lv: LEVEL_DAT[d.kind] }))}
       <a href="#/grundlagen">${esc(t("nav_basics"))}</a></p></section>`;
  const sel = el.querySelector("#repm");
  if (sel) sel.addEventListener("change", () => { location.hash = `#/org/${encodeURIComponent(d.key)}/bericht?m=${sel.value}`; });
}

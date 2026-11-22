// «Meine Organisation»: the entity's own layers against the best of its level,
// the weakest checks as next steps, dependencies and the weakest services.
import * as data from "../data.js";
import { LAYERS, BLOCKS, BLOCK_WHAT, LEVEL_ONE, LEVEL_MANY, LEVEL_DAT, APPS, CATS, WHY, checkName, checkText } from "../text.js";
import { esc, fmt, light, dot, bar, cc, uidLink, store, HOME_KEY, LIGHT_WORD } from "../ui.js";

const ORDER = ["apps", "control", "ext", "trust", "cloud", "net"];
const share = (k) => {
  if (!k) return null;
  const n = k.assessed ?? (k.pass || 0) + (k.partial || 0) + (k.fail || 0);
  return n ? (100 * ((k.pass || 0) + 0.5 * (k.partial || 0))) / n : null;
};

export async function render(el, params, role) {
  const key = params.key || store.get(HOME_KEY);
  if (!key) {
    el.innerHTML = `<section class="lead"><h1>Meine Organisation</h1>
      <p>Suchen Sie oben Ihre Gemeinde, Ihren Kanton, Ihr Amt oder Ihre Firma. Sie können sie danach als Heim-Organisation festlegen;
      der Browser merkt sie sich, ohne Konto und ohne dass etwas an uns übermittelt wird.</p></section>`;
    return;
  }
  let d;
  try {
    d = await data.entity(key);
  } catch {
    el.innerHTML = `<section class="lead"><h1>Nicht gefunden</h1><p>${esc(key)}</p></section>`;
    return;
  }
  const [meta, bm] = await Promise.all([data.meta(), data.benchmarks()]);
  const cfg = meta.cfg, B = bm[d.kind] || {};
  const p = d.posture || {};
  const home = store.get(HOME_KEY) === d.key;
  // the best 5 % by their mean (a threshold is often 0 or 100 because many share it); the single best where the group is small
  const bestLabel = (b) => (!b ? "" : b.mode === "top" ? `Ø beste ${Math.round(b.share * 100)} %` : "Bester");
  const bestVal = (b) => (!b ? null : b.mode === "top" ? b.mean : b.value);
  const bo = B.overall;

  const head = `<section class="lead org">
    <div class="kind">${esc(LEVEL_ONE[d.kind] || d.kind)}${d.canton ? " · " + esc(d.canton) : ""}${d.sector ? " · " + esc(d.sector) : ""}</div>
    <h1>${esc(d.name)}</h1>
    <p class="sub">${d.uid ? uidLink(d.uid) + (d.uid_name ? " · " + esc(d.uid_name) : "") + " · " : ""}${esc((d.domains || []).slice(0, 4).join(", "))}</p>
    <button class="home${home ? " on" : ""}" data-home="${esc(d.key)}">${home ? "Heim-Organisation ✓" : "Als Heim-Organisation festlegen"}</button>
  </section>`;

  const verdict = p.overall === null || p.overall === undefined
    ? `<section class="verdict none"><p>Keine Bewertung: ${esc(d.no_data || "keine öffentlich erreichbaren Dienste gefunden")}.</p></section>`
    : `<section class="verdict ${light(p.overall, cfg)}">
      <div class="big">${fmt(p.overall)}<small>/100</small></div>
      <div><div class="vt">${esc(LIGHT_WORD[light(p.overall, cfg)])}</div>
        <div class="sub">${p.resources || 0} Dienste geprüft${p.knockouts ? ` · ${p.knockouts} mit ungültigem Zertifikat` : ""}</div>
        ${bo ? `<div class="sub">${bo.mode === "top" ? `Die besten ${Math.round(bo.share * 100)} % der ${esc(LEVEL_MANY[d.kind])} erreichen ${fmt(bo.value)} oder mehr` : `Bester Wert unter den ${esc(LEVEL_DAT[d.kind])}: ${fmt(bo.value)}`}</div>` : ""}
      </div></section>`;

  // the layer model with the entity's own values and the benchmark
  const layers = ORDER.map((lid) => {
    const L = meta.model.layer.find((x) => x.id === lid);
    const blocks = L.blocks.map((b) => {
      const k = `${lid}.${b.id}`, v = (d.layers[lid] || {})[b.id] || {};
      if (v.m === "none") return `<div class="block unmeasured"><div class="bn">${esc(BLOCKS[k])}</div><div class="bv muted">noch nicht gemessen</div></div>`;
      if (v.m === "count") {
        const apps = Object.entries(d.dependencies.apps || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
        return `<div class="block none"><div class="bn">${esc(BLOCKS[k])}</div><div class="bs">${apps.map(([a, n]) => `${esc(APPS[a] || a)} ${n}`).join(" · ") || "–"}</div></div>`;
      }
      const bb = B["blk:" + k];
      const l = light(v.v, cfg);
      return `<div class="block ${l}" title="${esc(BLOCK_WHAT[k] || "")}"><div class="bn">${esc(BLOCKS[k])}</div>
        <div class="bv">${v.v === null || v.v === undefined ? "" : `${dot(l)} <b>${fmt(v.v)}</b>`}${bb ? `<span class="bb"> · ${bestLabel(bb)} ${fmt(bestVal(bb))}</span>` : ""}</div>
        ${v.v !== null && v.v !== undefined ? bar(v.v, bestVal(bb), bestLabel(bb)) : `<div class="bs muted">noch keine Daten</div>`}</div>`;
    }).join("");
    return `<div class="layer ${lid}${lid === "control" ? " control" : ""}"><div class="ln"><b>${esc(LAYERS[lid].name)}</b></div>
      <div class="blocks" style="--n:${L.blocks.length}">${blocks}</div></div>`;
  }).join("");

  // next steps: the weakest checks, with the reason for the chosen role and why it matters
  const checks = Object.entries(p.checks || {}).map(([id, k]) => [id, share(k), k]).filter(([, v]) => v !== null);
  const mailChecks = Object.entries((d.mail || {}).checks || {}).map(([id, k]) => [id, share(k), k]).filter(([, v]) => v !== null);
  const cat = (id) => (id.startsWith("mail.") ? "mail" : { own: "ownership", sov: "sovereignty", sec: "security", prv: "privacy" }[id.split(".")[0]]);
  const weakest = [...checks, ...mailChecks].filter(([, v]) => v < (cfg.green || 80)).sort((a, b) => a[1] - b[1]).slice(0, 4);
  const steps = weakest.length
    ? `<ol class="steps">${weakest.map(([id, v]) => {
        const bb = B["chk:" + id];
        return `<li><div class="st">${dot(light(v, cfg))} <b>${esc(checkName(id))}</b> <span class="muted">${fmt(v)} %${bb ? ` · ${bestLabel(bb)}: ${fmt(bestVal(bb))} %` : ""}</span></div>
          <p>${esc(checkText(id, role))}</p><p class="why">${esc(WHY[cat(id)] || "")}</p></li>`;
      }).join("")}</ol>`
    : `<p>Keine Prüfung liegt unter ${cfg.green || 80} Prozent.</p>`;

  const cats = Object.entries(p.categories || {}).map(([c, v]) => `<div class="cat">${dot(light(v, cfg))} <span>${esc(CATS[c] || c)}</span> <b>${fmt(v)}</b>
    ${B["cat:" + c] ? `<span class="muted"> · ${bestLabel(B["cat:" + c])} ${fmt(bestVal(B["cat:" + c]))}</span>` : ""}</div>`).join("");

  const dep = d.dependencies || {};
  // what each provider was recognised by (docs/DATA_CONTRACT.md, «Dependencies»)
  const PROOF = { mx: "MX", spf: "SPF", txt: "TXT-Nachweis", dkim: "DKIM-Schlüssel", cname: "CNAME", redirect: "Weiterleitung", path: "Login-Pfad" };
  const proof = (part, name) => {
    const v = (dep.via || []).find((x) => x.part === part && x.name === name);
    return v ? v.ev.map(([k, where, what]) => `${PROOF[k] || k}: ${where} → ${what}`).join("; ") : "";
  };
  const depRow = (label, arr, withN, part) => (arr && arr.length ? `<tr><th>${esc(label)}</th><td>${arr.slice(0, 6).map((x) => {
    const pr = part ? proof(part, x[0]) : "";
    return `<span${pr ? ` class="proof" title="${esc(pr)}"` : ""}>${esc(x[0])}</span> ${cc(x[1])}${withN && x[2] ? ` <span class="muted">${x[2]}</span>` : ""}`;
  }).join("<br>")}</td></tr>` : "");
  const deps = `<table class="deps"><tbody>${depRow("Mail-Plattform", dep.mail, false, "mail")}${depRow("Versand und Mail-Dienste", dep.send, false, "send")}${depRow("SaaS", dep.saas, false, "saas")}
    ${depRow("Login-Anbieter", dep.idp, false, "idp")}${depRow("Cloud und Hosting (Hosts)", dep.cloud, true)}</tbody></table>
    <p class="muted small">Aus öffentlichen DNS-Einträgen, Netzwerken und Weiterleitungen. Nachweis beim Zeigen auf den Namen. Interne Nutzung ist nicht sichtbar.</p>`;

  const hosts = (d.hosts || []).filter((h) => h.overall !== null && h.overall !== undefined).sort((a, b) => a.overall - b.overall).slice(0, 10);
  const hostList = hosts.length ? `<table class="hosts"><thead><tr><th>Dienst</th><th>Wert</th></tr></thead><tbody>${hosts.map((h) =>
    `<tr><td>${esc(h.host)}${h.critical ? ' <span class="tag">kritisch</span>' : ""}${h.knockout ? ' <span class="tag red">K.-o.</span>' : ""}${h.unreachable ? ' <span class="tag">nicht erreichbar</span>' : ""}</td>
     <td>${dot(light(h.overall, cfg))} ${fmt(h.overall)}</td></tr>`).join("")}</tbody></table>` : "<p>–</p>";

  el.innerHTML = head + verdict +
    `<section><h2>Bausteine</h2><p class="sub">Eigener Wert, darunter der Balken; der Strich zeigt, was die Besten erreichen.</p><div class="model compact">${layers}</div></section>
     <div class="two"><section><h2>Nächste Schritte</h2>${steps}</section>
     <section><h2>Bereiche</h2>${cats || "<p>–</p>"}<h2>Abhängigkeiten</h2>${deps}</section></div>
     <section><h2>Schwächste Dienste</h2>${hostList}</section>`;

  el.querySelector("[data-home]").addEventListener("click", (ev) => {
    const k = ev.currentTarget.dataset.home;
    store.set(HOME_KEY, store.get(HOME_KEY) === k ? null : k);
    render(el, params, role);
  });
}

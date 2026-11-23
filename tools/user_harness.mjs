// Plays the user stories of docs/PRODUCT.md as journeys through /v2, each from
// the position of a user group (role lay or tech, language, home organisation),
// and reports which stories the site serves, where a journey breaks, and what
// to improve from that group's view. Run by hand or on a schedule.
//
//   node tools/user_harness.mjs <folder with v2/ | https://…/> [report.md]
//
// A folder is the same as for check_site.mjs (v2/ with the app and its data,
// v2/map-ch.json for the map) and is served locally; a URL is the published
// site (…/cert_landscape_CH/). Nothing else is fetched.
//
// Checks per journey, besides the steps: page errors; clicks against the
// group's max_clicks; for lay groups, check codes (e.g. sov.ca) or text keys
// (e.g. blk_how_mail) visible on the last page; load time of the last page.
// Exit code 1 when a journey of today's site breaks; targets of the proposal
// (target = true) do not fail the run.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ARG = process.argv[2] || path.join(ROOT, "pub");
const OUT = process.argv[3];
const { personas, journeys, ignore } = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/user_journeys.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)("playwright");

let server = null, BASE;
if (/^https?:\/\//.test(ARG)) {
  BASE = ARG.replace(/\/?$/, "/") + "v2/";
} else {
  const SITE = path.resolve(ARG);
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml" };
  server = http.createServer((req, res) => {
    const p = path.join(SITE, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
    if (!p.startsWith(SITE) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  BASE = `http://localhost:${server.address().port}/v2/`;
}

const CODE = /\b(own|sov|sec|prv|mail)\.[a-z0-9]+\b/g;
const KEY = /\b[a-z]{2,8}_[a-z]{2,}(?:_[a-z]+)*\b/g;
const browser = await chromium.launch();
const results = [];
for (const j of journeys) {
  const who = personas[j.persona] || {};
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: who.lang === "de" ? "de-CH" : `${who.lang}-CH` });
  await ctx.addInitScript(([role, lang, home]) => {
    try { localStorage.setItem("tp.role", role); localStorage.setItem("tp.lang", lang); if (home) localStorage.setItem("tp.home", home); } catch { /* storage blocked */ }
  }, [who.role || "lay", who.lang || "de", who.home || ""]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failed = null, clicks = 0, loadMs = 0;
  for (const [i, s] of j.steps.entries()) {
    try {
      if (s.go) { const t0 = Date.now(); await page.goto(BASE + s.go); await page.waitForLoadState("networkidle"); loadMs = Date.now() - t0; }
      else if (s.fill) { await page.fill(s.fill[0], s.fill[1]); await page.waitForTimeout(700); }
      else if (s.click) { clicks++; const t0 = Date.now(); await page.locator(s.click).first().click({ timeout: 3000 }); await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); loadMs = Date.now() - t0; }
      else if (s.expect) { await page.locator(s.expect).first().waitFor({ state: "visible", timeout: 3000 }); }
      else if (s.text) { await page.locator("main").getByText(s.text, { exact: false }).first().waitFor({ timeout: 3000 }); }
    } catch {
      failed = { step: i + 1, what: JSON.stringify(s) };
      break;
    }
  }
  // the group's view of the last page
  const text = await page.locator("main").innerText().catch(() => "");
  const codes = [...new Set(text.match(CODE) || [])];
  const skip = (k) => (ignore?.tokens || []).some((x) => k.startsWith(x));
  const keys = [...new Set((text.match(KEY) || []).filter((k) => !skip(k)))];
  const hints = [];
  if (failed && j.target && j.proposal) hints.push(`Vorschlag umsetzen: ${j.proposal}`);
  if (failed && !j.target) hints.push(`Weg bricht ab bei Schritt ${failed.step}; Ansicht oder Selektor prüfen.`);
  if (errors.length) hints.push(`Fehler im Browser beheben: ${errors[0]}`);
  if (who.max_clicks && clicks > who.max_clicks) hints.push(`Weg verkürzen: ${clicks} Klicks, für diese Gruppe höchstens ${who.max_clicks}.`);
  if (who.role === "lay" && codes.length) hints.push(`Kürzel in der Laiensicht durch Namen ersetzen: ${codes.slice(0, 4).join(", ")}.`);
  if (keys.length) hints.push(`Unübersetzte Textschlüssel (${who.lang}): ${keys.slice(0, 4).join(", ")}.`);
  if (loadMs > 3000) hints.push(`Ladezeit ${Math.round(loadMs / 100) / 10} s; Daten verkleinern oder später laden.`);
  results.push({ ...j, who, ok: !failed, failed, errors, clicks, loadMs, hints });
  await ctx.close();
}
await browser.close();
if (server) server.close();

const status = (r) => (r.ok ? (r.target ? "erfüllt (Ziel)" : "erfüllt") : r.target ? "Ziel offen" : "Lücke");
const out = [`# Harness der Nutzergruppen`, ``, `Website: ${BASE} · Lauf: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, ``,
  `| ID | Nutzergruppe (Rolle, Sprache) | Story | Stand | Klicks | Vorschläge |`, `|---|---|---|---|---|---|`,
  ...results.map((r) => `| ${r.id} | ${r.who.name} (${r.who.role}, ${r.who.lang}) | ${r.story} | ${status(r)} | ${r.clicks} | ${r.hints.join(" ") || "–"} |`)];
const sum = (f) => results.filter(f).length;
out.push("", `Erfüllt ${sum((r) => r.ok && !r.target)} von ${sum((r) => !r.target)} Stories des heutigen Stands; Ziele des Vorschlags erfüllt ${sum((r) => r.ok && r.target)} von ${sum((r) => r.target)}; Vorschläge ${results.reduce((a, r) => a + r.hints.length, 0)}.`);
const md = out.join("\n");
console.log(md);
if (OUT) fs.writeFileSync(OUT, md + "\n");
process.exit(sum((r) => !r.ok && !r.target) ? 1 : 0);

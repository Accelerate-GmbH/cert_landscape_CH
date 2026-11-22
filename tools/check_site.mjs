// Consistency of the two frontends with the published data, run in CI.
//
//   node tools/check_site.mjs <folder with v2/meta.json>   (default: pub; the site build puts the data there)
//
// Checks: every check the pipeline publishes (meta.json check_order, mail
// checks of the model) has a simple and an expert text and labels in all four
// languages; the four languages carry the same keys; web/app.js lists the
// checks in the published order; the dependencies in the entity files follow
// docs/DATA_CONTRACT.md; every file the pages reference exists; every view in
// the navigation of /v2 has a route, and every data file app/js/data.js loads is
// published; no file in the repository names an AI tool.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PUB = path.resolve(process.argv[2] || path.join(ROOT, "pub"));
const LANGS = ["de", "fr", "it", "en"];
const problems = [];
const fail = (m) => problems.push(m);

globalThis.window = {};
await import(path.join(ROOT, "web/i18n.js"));
await import(path.join(ROOT, "web/guide.js"));
const { I18N, GUIDE } = globalThis.window;

// 1. languages carry the same keys
const flat = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, p + k + ".") : [p + k]));
for (const [name, obj] of [["I18N", I18N], ["GUIDE", GUIDE]]) {
  const base = new Set(flat(obj.de));
  for (const l of LANGS.slice(1)) {
    const other = new Set(flat(obj[l]));
    const diff = [...base].filter((k) => !other.has(k)).concat([...other].filter((k) => !base.has(k)));
    if (diff.length) fail(`${name}: ${l} differs from de in ${diff.slice(0, 8).join(", ")}`);
  }
}

// 2. every published check is explained
const metaPath = path.join(PUB, "v2", "meta.json");
if (!fs.existsSync(metaPath)) {
  fail(`published data not found at ${metaPath}`);
} else {
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const checks = meta.check_order || [];
  const mail = [...new Set(meta.model.layer.flatMap((L) => L.blocks.flatMap((b) => b.mail || [])))];
  for (const l of LANGS) {
    const g = GUIDE[l] || {};
    for (const id of [...checks, ...mail]) {
      const c = (g.checks || {})[id] || {};
      if (!c.s || !c.x) fail(`web/guide.js ${l}: check ${id} needs simple and expert text`);
      if (!(g.s || {})[id]) fail(`web/guide.js ${l}: no simple label for ${id}`);
      if (!((g.ui || {})[id] || (I18N[l] || {})[id])) fail(`${l}: no expert label for ${id}`);
    }
  }
  const app = fs.readFileSync(path.join(ROOT, "web/app.js"), "utf8");
  const m = app.match(/const CHECK_IDS\s*=\s*\[([^\]]*)\]/);
  const ids = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  if (JSON.stringify(ids) !== JSON.stringify(checks)) fail("web/app.js CHECK_IDS is not the published check order");
}

// 3. dependencies follow the data contract (docs/DATA_CONTRACT.md, «Dependencies»)
const entDir = path.join(PUB, "v2", "entities");
if (fs.existsSync(entDir)) {
  const SHAPE = { mail: 3, send: 2, saas: 2, idp: 2, cloud: 3 };
  const KINDS = new Set(["mx", "spf", "txt", "dkim", "cname", "redirect", "path"]);
  let bad = 0;
  const report = (f, m) => { if (++bad <= 5) fail(`v2/entities/${f}: dependencies ${m}`); };
  for (const f of fs.readdirSync(entDir).filter((x) => x.endsWith(".json"))) {
    const dep = JSON.parse(fs.readFileSync(path.join(entDir, f), "utf8")).dependencies || {};
    const extra = Object.keys(dep).filter((k) => !(k in SHAPE) && k !== "apps" && k !== "via");
    if (extra.length) report(f, `unknown parts ${extra.join(", ")}`);
    const names = new Set();
    for (const [part, n] of Object.entries(SHAPE)) {
      for (const row of dep[part] || []) {
        if (!Array.isArray(row) || row.length !== n || typeof row[0] !== "string" || typeof row[1] !== "string") { report(f, `${part}: malformed entry`); break; }
        names.add(part + "\u0000" + row[0]);
      }
    }
    for (const v of dep.via || []) {
      if (!v || !["mail", "send", "saas", "idp"].includes(v.part) || typeof v.provider !== "string") { report(f, "via: malformed entry"); continue; }
      if (!names.has(v.part + "\u0000" + v.name)) report(f, `via: ${v.part} ${v.name} not in the part`);
      for (const ev of v.ev || []) if (!Array.isArray(ev) || ev.length !== 3 || !KINDS.has(ev[0])) report(f, "via: proof is not [kind, where, what]");
    }
  }
  if (bad > 5) fail(`… ${bad - 5} more dependency problems`);
  // services × functions (docs/DATA_CONTRACT.md, «services»)
  const SVC = new Set(["website", "portal", "login", "gever", "mail"]);
  const FN = new Set(["resolve", "registrar", "secure", "operate", "identity"]);
  let badS = 0;
  for (const f of fs.readdirSync(entDir).filter((x) => x.endsWith(".json"))) {
    const svc = JSON.parse(fs.readFileSync(path.join(entDir, f), "utf8")).services;
    const problem = !Array.isArray(svc) ? "missing" : svc.map((x) =>
      !SVC.has(x.service) || !x.host || !Number.isInteger(x.hosts) ? `bad entry ${x.service}`
        : Object.entries(x.cells || {}).map(([k, c]) => !FN.has(k) ? `unknown function ${k}`
          : c && (![null, "pass", "partial", "fail"].includes(c.status) || !c.count) ? `${x.service}.${k}: bad cell` : "").find(Boolean) || "").find(Boolean);
    if (problem && ++badS <= 5) fail(`v2/entities/${f}: services ${problem}`);
  }
  if (badS > 5) fail(`… ${badS - 5} more service problems`);
  const histDir = path.join(PUB, "v2", "history");
  const missing = fs.readdirSync(entDir).filter((f) => f.endsWith(".json") && !fs.existsSync(path.join(histDir, f)));
  if (missing.length) fail(`v2/history: ${missing.length} entities without a time series, e.g. ${missing.slice(0, 3).join(", ")}`);
}

// 4. referenced files exist
for (const [dir, file] of [["web", "index.html"], ["app", "index.html"]]) {
  const html = fs.readFileSync(path.join(ROOT, dir, file), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^":#?]+)(?:\?[^"]*)?"/g)) {
    if (ref.startsWith("http") || ref.startsWith("data/") || ref.startsWith("../") || ref.startsWith("#")) continue;
    if (!fs.existsSync(path.join(ROOT, dir, ref))) fail(`${dir}/${file} references missing ${ref}`);
  }
}

// 5. views and data files of /v2
{
  const html = fs.readFileSync(path.join(ROOT, "app/index.html"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "app/js/main.js"), "utf8");
  for (const [, nav] of html.matchAll(/data-nav="([^"]+)"/g)) {
    if (!main.includes(`name: "${nav}"`)) fail(`app/index.html: view ${nav} has no route in app/js/main.js`);
  }
  const dj = fs.readFileSync(path.join(ROOT, "app/js/data.js"), "utf8");
  for (const [, f] of dj.matchAll(/get\("([^"]+\.json)"\)/g)) {
    if (fs.existsSync(path.join(PUB, "v2")) && !fs.existsSync(path.join(PUB, "v2", f))) fail(`v2/${f} is loaded by app/js/data.js but not published`);
  }
}

// 6. the four language files of /v2 carry the same keys
{
  const flatKeys = (o, p = "") => Object.entries(o || {}).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatKeys(v, p + k + ".") : [p + k + (Array.isArray(v) ? `[${v.length}]` : "")]);
  const langs = {};
  for (const l of LANGS) langs[l] = (await import(path.join(ROOT, "app/js/lang", l + ".js"))).default;
  const base = new Set(flatKeys(langs.de));
  for (const l of LANGS.slice(1)) {
    const other = new Set(flatKeys(langs[l]));
    const diff = [...base].filter((k) => !other.has(k)).concat([...other].filter((k) => !base.has(k)));
    if (diff.length) fail(`app/js/lang/${l}.js differs from de.js in ${diff.slice(0, 8).join(", ")}`);
  }
}

// 7. no AI tool named anywhere in the repository
const files = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter(Boolean);
const word = new RegExp(["cla", "ude|anth", "ropic"].join(""), "i");
for (const f of files) {
  if (/\.(png|jpg|gz|xlsx)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  if (word.test(text) || word.test(f)) fail(`${f}: names an AI tool`);
}

for (const p of problems) console.log("✗", p);
console.log(problems.length ? `${problems.length} problem(s)` : "site consistent");
process.exit(problems.length ? 1 : 0);

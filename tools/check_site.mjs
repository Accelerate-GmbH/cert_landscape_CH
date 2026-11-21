// Consistency of the two frontends with the published data, run in CI.
//
//   node tools/check_site.mjs <folder with v2/meta.json>   (default: pub; the site build puts the data there)
//
// Checks: every check the pipeline publishes (meta.json check_order, mail
// checks of the model) has a simple and an expert text and labels in all four
// languages; the four languages carry the same keys; web/app.js lists the
// checks in the published order; every file the pages reference exists; no
// file in the repository names an AI tool.
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

// 3. referenced files exist
for (const [dir, file] of [["web", "index.html"], ["app", "index.html"]]) {
  const html = fs.readFileSync(path.join(ROOT, dir, file), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^":#?]+)(?:\?[^"]*)?"/g)) {
    if (ref.startsWith("http") || ref.startsWith("data/") || ref.startsWith("../") || ref.startsWith("#")) continue;
    if (!fs.existsSync(path.join(ROOT, dir, ref))) fail(`${dir}/${file} references missing ${ref}`);
  }
}

// 4. no AI tool named anywhere in the repository
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

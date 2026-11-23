// All data comes from one folder with a fixed schema (docs/DATA_CONTRACT.md).
// Only this module knows where it lives, so the data can move to another
// origin (e.g. a private repository's release) by changing BASE.
export const BASE = "data";
const cache = new Map();

async function get(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${BASE}/${path}?v=${window.BUILD || ""}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const meta = () => get("meta.json");
export const overview = () => get("overview.json");
export const benchmarks = () => get("benchmarks.json");
export const index = () => get("index.json");
export const scores = () => get("scores.json");
export const providers = () => get("providers.json");
export const infrastructure = () => get("infrastructure.json");
export const governance = () => get("governance.json");
export const places = () => get("places.json").then((d) => d.places).catch(() => ({}));
export const uids = () => get("uids.json").then((d) => new Set(d.uids)).catch(() => new Set());
export const uid = (u) => get(`uid/${String(u).replace(/\D/g, "")}.json`);
export const provider = (id) => get(`providers/${encodeURIComponent(id)}.json`);
export const entity = (key) => get(`entities/${key.replace(":", "-")}.json`);
export const history = (key) => get(`history/${key.replace(":", "-")}.json`);
export const evidence = (key) => get(`evidence/${key.replace(":", "-")}.json`);

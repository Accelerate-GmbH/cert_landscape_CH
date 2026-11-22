// Texts of the new frontend in four languages (lang/de.js, fr.js, it.js, en.js,
// same keys). The language is chosen in the header and kept in the browser
// (localStorage), else taken from the browser's language. Check texts come from
// the guide of the current map (../guide.js), so both versions explain a check
// in the same words.
import de from "./lang/de.js";
import fr from "./lang/fr.js";
import it from "./lang/it.js";
import en from "./lang/en.js";

export const LANGS = { de, fr, it, en };
const KEY = "tp.lang";
const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
const browser = ((navigator.language || "de").slice(0, 2)).toLowerCase();
export let LANG = LANGS[saved] ? saved : LANGS[browser] ? browser : "de";
export function setLang(l) {
  if (!LANGS[l]) return;
  LANG = l;
  try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
  document.documentElement.lang = l;
}
const cur = () => LANGS[LANG];

// objects that always read from the current language, so views can keep
// importing LAYERS, BLOCKS … and get the chosen language
function live(section) {
  return new Proxy({}, {
    get: (_, k) => cur()[section][k] ?? de[section][k],
    has: (_, k) => k in cur()[section],
    ownKeys: () => Reflect.ownKeys(cur()[section]),
    getOwnPropertyDescriptor: (_, k) => ({ value: cur()[section][k], enumerable: true, configurable: true }),
  });
}
export const LAYERS = live("layers");
export const GROUPS = live("groups");
export const CONTROL = live("control");
export const BLOCKS = live("blocks");
export const BLOCK_WHAT = live("block_what");
export const LEVEL_ONE = live("level_one");
export const LEVEL_MANY = live("level_many");
export const LEVEL_DAT = live("level_dat");
export const APPS = live("apps");
export const CATS = live("cats");
export const WHY = live("why");
export const LIGHT_WORD = live("light_word");
// [[key, name], …] in the order of the levels
export const LEVELS = new Proxy([], {
  get: (_, k) => {
    const a = cur().levels;
    const v = a[k];
    return typeof v === "function" ? v.bind(a) : v;
  },
});
export const locale = () => cur().locale;

export function t(key, vars = {}) {
  const s = cur().ui[key] ?? de.ui[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

const G = () => (window.GUIDE && (window.GUIDE[LANG] || window.GUIDE.de)) || {};
export const checkName = (id) => (G().s || {})[id] || (G().ui || {})[id] || id;
export const checkText = (id, role) => {
  const c = (G().checks || {})[id] || {};
  return role === "tech" ? c.x || c.s || "" : c.s || "";
};
export const monthName = (m) => {
  const [y, mo] = (m || "").split("-").map(Number);
  return y ? new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(locale(), { month: "short", year: "numeric", timeZone: "UTC" }) : m;
};

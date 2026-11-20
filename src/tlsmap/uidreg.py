"""UID numbers (CHE-…) for cantons, municipalities and federal departments.

The UID is the key that links an entity on the map to other registers: the
GLEIF LEI and vLEI directory, the swiyu trust registry, the commercial
register. Critical-service operators already carry their UID in the list;
this module finds it for the public administration through the public search
service of the UID register (Federal Statistical Office):

- municipalities by BFS municipality number and legal form 0223
  (administration of the municipality), so names never have to be guessed;
- federal departments by name and legal form 0220;
- cantons by canton abbreviation and legal form 0221.

Every unit of an administration can have its own UID (school, utilities,
police). The resolver keeps the unit that stands for the whole entity
("Politische Gemeinde Bonstetten", "Ville de Lausanne") and records the
other candidates when it cannot decide. Choices can be pinned by hand in
data/uid/pins.json; pins always win.

    tlsmap uid                       # all kinds, resumes from the cache
    tlsmap uid --kinds municipalities --canton ZG
"""
from __future__ import annotations

import json
import logging
import re
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

log = logging.getLogger(__name__)

URL = "https://www.uid-wse.admin.ch/V5.0/PublicServices.svc"
DETAIL = "https://www.uid.admin.ch/Detail.aspx?uid_id={uid}"
ACTION = "http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/Search"
CAP = 30                           # the public search returns at most this many results
ACTIVE = "3"                       # eCH-0108 uidregStatusEnterpriseDetail: definitive (active)
FORM = {"federal": "0220", "canton": "0221", "municipality": "0223"}

# Names of units that belong to an administration but do not stand for it.
UNIT_WORDS = re.compile(
    r"schul|kirch|bürger|burger|ortsbürger|feuerwehr|pensionskasse|caisse|werk|spital|alters|"
    r"forst|wasser|abwasser|abfall|kabelnetz|elektrizit|energie|polizei|police|zivilschutz|"
    r"bourgeoisie|paroisse|scolaire|école|ecole|scuola|patriziato|parrocchia|corporazione|"
    r"zweckverband|korporation|genossenschaft|stiftung|fondation|fondazione|heim|bibliothek|"
    r"wärme|warme|verbund|liegenschaft|ordures|dechets|déchets|steuer|betreibung|grundbuch|sozial|kesb|museum|tourismus|hafen|friedhof|bad\b",
    re.I)
MUNI_PREFIX = re.compile(
    r"^(politische gemeinde|einwohnergemeinde|einwohnerinnengemeinde|gemeinde|stadt|"
    r"commune des\s|commune du\s|commune d[e'’]\s*|commune|municipalité d[e'’]\s*|ville d[e'’]\s*|ville|"
    r"comune di|comune|città di|città|municipio di|vischnanca|cumün da|cumün|"
    r"vischnaunca|lai\b)\s*", re.I)
CANTON_PREFIX = re.compile(
    r"^(kanton\b|canton d[eu'’]\s*|canton\b|etat du canton d[eu'’]\s*|etat d[eu'’]\s*|état d[eu'’]\s*|"
    r"république et canton d[eu'’]\s*|repubblica e cantone\b|staat\b|chantun\b)\s*", re.I)


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    # articles: "Les Verrières" = "Commune des Verrières", "Le Lieu" = "Commune du Lieu"
    return re.sub(r"^(les|le|la|l|il|lo|i)\s+", "", s)


def fmt_uid(digits: str) -> str:
    d = re.sub(r"\D", "", digits or "")
    return f"CHE-{d[:3]}.{d[3:6]}.{d[6:9]}" if len(d) == 9 else ""


class UidRegister:
    """Public search of the UID register, with a JSON cache and a polite pace."""

    def __init__(self, cache: Path, interval: float = 3.0, timeout: float = 120.0, retries: int = 3):
        self.cache_path = cache
        self.cache: dict = json.loads(cache.read_text()) if cache.exists() else {}
        self.interval = interval
        self.timeout = timeout
        self.retries = retries
        self._last = 0.0

    def save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False, sort_keys=True))

    def search(self, *, name: str = "", municipality: int | None = None, canton: str = "",
               legal_form: str = "") -> list[dict] | None:
        """Active and inactive results; None when the service could not be reached."""
        key = f"n={name}|m={municipality or ''}|c={canton}|f={legal_form}"
        if key in self.cache:
            return self.cache[key]
        p = ""
        if name:
            p += f"<v5:organisationName>{_xml(name)}</v5:organisationName>"
        if municipality or canton:
            p += "<v5:address>"
            p += f"<v5:municipalityId>{int(municipality)}</v5:municipalityId>" if municipality else ""
            p += f"<v5:cantonAbbreviation>{_xml(canton)}</v5:cantonAbbreviation>" if canton else ""
            p += "</v5:address>"
        if legal_form:
            p += f"<v5:legalForm>{legal_form}</v5:legalForm>"
        body = ('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
                'xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse" xmlns:v5="http://www.uid.admin.ch/xmlns/uid-wse/5">'
                "<soapenv:Header/><soapenv:Body><uid:Search><uid:searchParameters><v5:uidEntitySearchParameters>"
                + p + "</v5:uidEntitySearchParameters></uid:searchParameters></uid:Search></soapenv:Body></soapenv:Envelope>")
        for attempt in range(self.retries):
            wait = self.interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                req = urllib.request.Request(URL, data=body.encode(), headers={
                    "Content-Type": "text/xml; charset=utf-8", "SOAPAction": ACTION})
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    res = parse(r.read().decode("utf-8", "replace"))
                self.cache[key] = res
                return res
            except Exception as e:  # network, HTTP 5xx, SOAP fault: retried, then reported
                log.warning("UID search %s failed (%s), attempt %d", key, e, attempt + 1)
                time.sleep(10 * (attempt + 1))
        return None


def _xml(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def parse(text: str) -> list[dict]:
    t = re.sub(r'\sxmlns(:\w+)?="[^"]+"', "", text)
    t = re.sub(r"<(/?)\w+:", r"<\1", t)
    root = ET.fromstring(t)
    if root.find(".//Fault") is not None:
        raise RuntimeError(root.findtext(".//faultstring") or "SOAP fault")
    out = []
    for it in root.iter("uidEntitySearchResultItem"):
        o = it.find("organisation/organisation")
        oi = o.find("organisationIdentification") if o is not None else None
        if oi is None:
            continue
        adr = next((a for a in o.findall("address") if a.findtext("addressCategory") == "LEGAL"), o.find("address"))
        out.append({
            "uid": fmt_uid(oi.findtext("uid/uidOrganisationId") or ""),
            "name": oi.findtext("organisationName") or "",
            "add": oi.findtext("organisationAdditionalName") or "",
            "form": oi.findtext("legalForm") or "",
            "status": it.findtext("organisation/uidregInformation/uidregStatusEnterpriseDetail") or "",
            "town": adr.findtext("town") if adr is not None else "",
            "kt": adr.findtext("cantonAbbreviation") if adr is not None else "",
        })
    return out


# --- choosing the unit that stands for the whole entity ---------------------------------

def _main_units(results: list[dict], form: str, base: str = "") -> list[dict]:
    """Active units of the right legal form whose name, apart from the
    entity's own name, does not point to a sub-unit (school, utility …)."""
    def rest(n: str) -> str:
        f = _fold(n)
        return f.replace(base, " ") if base else f
    return [r for r in results if r["status"] == ACTIVE and r["form"] == form and r["uid"]
            and "," not in r["name"] and "uid-stelle" not in (r["add"] or "").lower()
            and not UNIT_WORDS.search(rest(r["name"]))]


# words that may stand next to the municipality's name in its own entry
ADMIN_WORDS = set("""politische einwohnergemeinde einwohnerinnengemeinde gemeinde stadt stadtgemeinde der die
gemeindeverwaltung bezirk commune mixte municipale de du des d ville municipalite comune politico di delle della
municipio citta vischnanca cumun da lai am an im bei sur sous pres""".split())


def _only_admin_words(name: str, base: str) -> bool:
    """True when the entry's name is the municipality's name plus administrative words
    and canton codes ("Gemeinde Pfäffikon ZH"), not a service ("…, Wärmeverbund")."""
    rest = _fold(name).replace(base, " ").split()
    return all(w in ADMIN_WORDS or len(w) == 2 for w in rest)


def pick_municipality(results: list[dict], name: str, canton: str = "") -> tuple[dict | None, list[dict]]:
    base = _fold(name)
    cands = _main_units(results, FORM["municipality"], base)
    if canton:  # "Brugg" (AG) is not "Brügg" (BE)
        cands = [r for r in cands if not r.get("kt") or r["kt"] == canton]
    exact = [r for r in cands if _fold(MUNI_PREFIX.sub("", r["name"])) == base]
    if len(exact) == 1:
        return exact[0], []
    pool = exact or [r for r in cands if base and base in _fold(r["name"]) and _only_admin_words(r["name"], base)]
    if not pool:  # "Bezirk Küssnacht am Rigi" for Küssnacht (SZ): the name may carry a longer form
        pool = [r for r in cands if base and base in _fold(r["name"]) and len(_fold(r["name"]).replace(base, " ").split()) <= 3
                and not UNIT_WORDS.search(_fold(r["name"]).replace(base, " "))]
    if len(pool) == 1:
        return pool[0], []
    if not pool and len(cands) == 1 and MUNI_PREFIX.match(cands[0]["name"]) and _only_admin_words(cands[0]["name"], base):
        return cands[0], []
    uids = {r["uid"] for r in pool}
    if len(uids) == 1 and pool:            # the same unit listed twice
        return pool[0], []
    if pool and len({r["name"] for r in pool}) == 1:
        # one name, several entries: the one without an additional name is the municipality itself
        plain = [r for r in pool if not r.get("add")]
        if len(plain) == 1:
            return plain[0], []
    if pool:  # same name twice: prefer the political municipality, then the shortest name
        pref = [r for r in pool if re.match(r"(?i)politische gemeinde|einwohnergemeinde|commune|comune|ville|stadt|città", r["name"])]
        if len(pref) == 1:
            return pref[0], []
    return None, pool or cands


def pick_canton(results: list[dict], name: str, code: str) -> tuple[dict | None, list[dict]]:
    base = _fold(CANTON_PREFIX.sub("", name))
    cands = [r for r in _main_units(results, FORM["canton"], base) if CANTON_PREFIX.match(r["name"])]
    exact = [r for r in cands if _fold(CANTON_PREFIX.sub("", r["name"])) in (base, code.lower())]
    pool = exact or cands
    if len(pool) > 1:  # "République et Canton de Genève" next to "Etat de Genève/DSES/…": a short plain name wins
        plain = [r for r in pool if "/" not in r["name"] and len(_fold(CANTON_PREFIX.sub("", r["name"])).split()) <= 2]
        if len(plain) == 1:
            return plain[0], []
    if len(pool) > 1:  # "Repubblica e Cantone Ticino" next to "… Ticino DFE. Sezione …": the plain name wins
        pool = sorted(pool, key=lambda r: len(r["name"]))
        if len(pool[0]["name"]) < len(pool[1]["name"]) and all(r["name"].startswith(pool[0]["name"]) for r in pool[1:]):
            return pool[0], []
    return (pool[0], []) if len(pool) == 1 else (None, pool)


def pick_federal(results: list[dict], name: str, code: str) -> tuple[dict | None, list[dict]]:
    # department names contain commas ("… Verteidigung, Bevölkerungsschutz und Sport (VBS)"),
    # sub-units continue after the tag ("… (EDA), Informatik")
    cands = [r for r in results if r["status"] == ACTIVE and r["form"] == FORM["federal"]]
    tagged = [r for r in cands if r["name"].lower().endswith(f"({code})".lower())]
    pool = tagged or [r for r in cands if _fold(r["name"]) == _fold(name)]
    return (pool[0], []) if len(pool) == 1 else (None, pool)


# --- run over the entity list ------------------------------------------------------------

def resolve(entities, reg: UidRegister, pins: dict, previous: dict, refresh: bool = False,
            save_every: int = 25) -> dict:
    """Returns {kind: {id: record}}; a record without uid carries its candidates."""
    out: dict = {k: dict(v) for k, v in (previous or {}).items()}
    done = 0
    for e in entities:
        kind = e.kind
        if kind not in FORM:
            continue
        slot = out.setdefault(kind, {})
        pin = (pins.get(kind) or {}).get(e.id)
        if pin:
            slot[e.id] = {"uid": pin["uid"], "name": pin.get("name", ""), "match": "pinned"}
            continue
        if not refresh and slot.get(e.id, {}).get("uid"):
            continue
        if kind == "municipality":
            res = reg.search(municipality=int(e.id), legal_form=FORM[kind])
            pick = pick_municipality(res, e.name, e.code) if res is not None else (None, [])
            short = re.sub(r"\s*\(.*?\)", "", e.name).strip()
            if res is not None and not pick[0] and len(res) >= CAP:
                # large municipalities have more units than one answer holds: narrow by name
                res2 = reg.search(name=short, municipality=int(e.id), legal_form=FORM[kind])
                if res2:
                    pick = pick_municipality(res2, e.name, e.code)
            if res is not None and not pick[0] and not pick[1] and e.code:
                # nothing under this BFS number (number changed, address elsewhere): by name within the canton
                res3 = reg.search(name=short, canton=e.code, legal_form=FORM[kind])
                if res3:
                    pick = pick_municipality(res3, e.name, e.code)
        elif kind == "canton":
            res = reg.search(canton=e.code, legal_form=FORM[kind])
            pick = pick_canton(res, e.name, e.code) if res is not None else (None, [])
            if res is not None and not pick[0]:
                # large cantons have more units than one answer holds: by name
                for q in (e.name, CANTON_PREFIX.sub("", e.name)):
                    res2 = reg.search(name=q, canton=e.code, legal_form=FORM[kind])
                    if res2 and (p2 := pick_canton(res2, e.name, e.code))[0]:
                        pick = p2
                        break
        else:
            res = reg.search(name=e.code, legal_form=FORM[kind])
            pick = pick_federal(res, e.name, e.code) if res is not None else (None, [])
            if res is not None and not pick[0]:
                res = reg.search(name=e.name, legal_form=FORM[kind])
                pick = pick_federal(res, e.name, e.code) if res is not None else (None, [])
        hit, cands = pick
        if res is None:
            slot[e.id] = {"uid": "", "match": "error"}
        elif hit:
            slot[e.id] = {"uid": hit["uid"], "name": hit["name"], "match": "auto"}
        else:
            slot[e.id] = {"uid": "", "match": "ambiguous" if cands else "none",
                          "candidates": [{"uid": c["uid"], "name": c["name"]} for c in cands[:8]]}
        done += 1
        if done % save_every == 0:
            reg.save()
            log.info("UID: %d looked up", done)
    reg.save()
    return out


def summary(data: dict) -> dict:
    s: dict = {}
    for kind, v in data.items():
        c: dict = {}
        for rec in v.values():
            c[rec.get("match", "none")] = c.get(rec.get("match", "none"), 0) + 1
        s[kind] = c
    return s


def write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {"generated": date.today().isoformat(), "source": URL, "detail": DETAIL,
           "summary": summary(data), "entities": data}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n")


def load(path: Path) -> dict:
    return json.loads(path.read_text()).get("entities", {}) if path.exists() else {}

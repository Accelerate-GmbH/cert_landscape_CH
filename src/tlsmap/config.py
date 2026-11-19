"""Load settings, the CA registry and entity lists."""

from __future__ import annotations

import hashlib
import json
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"


def _load_toml(path: Path) -> dict:
    with path.open("rb") as fh:
        return tomllib.load(fh)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


@dataclass
class Settings:
    raw: dict
    path: Path

    def __getitem__(self, key):
        return self.raw[key]

    def get(self, key, default=None):
        return self.raw.get(key, default)


def load_settings(path: Path | None = None) -> Settings:
    path = path or CONFIG_DIR / "settings.toml"
    return Settings(_load_toml(path), path)


@dataclass
class Entity:
    kind: str          # canton | municipality | federal
    id: str            # BFS number (municipality / canton) or code
    name: str
    domains: list[str]
    canton: str = ""   # canton name for municipalities
    code: str = ""     # canton code
    excluded_hosts: dict[str, str] = field(default_factory=dict)
    shared_domain: bool = False  # only domain is shared with another entity
    # organisations from the host list (data/hosts_ch.csv)
    hosts: dict[str, dict] = field(default_factory=dict)   # hostname -> per-host attributes
    sector: str = ""
    subsector: str = ""
    uid: str = ""
    place: dict = field(default_factory=dict)              # plz, ort, kanton
    visibility: str = "oeffentlich"                         # oeffentlich | aggregat | intern

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"


PUBLIC_MAIL = {"bluewin.ch", "gmx.ch", "gmx.net", "gmail.com", "hispeed.ch", "sunrise.ch",
               "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "swissonline.ch"}


def _norm_host(h: str) -> str:
    """Hostname as listed (keeps www.), without scheme, path, port or trailing dot."""
    h = h.strip().lower()
    for prefix in ("https://", "http://"):
        if h.startswith(prefix):
            h = h[len(prefix):]
    return h.split("/")[0].split(":")[0].rstrip(".")


def _norm_domain(d: str) -> str:
    d = d.strip().lower().rstrip(".")
    for prefix in ("https://", "http://"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    d = d.split("/")[0]
    if d.startswith("www."):
        d = d[4:]
    return d


VISIBILITY = {"oeffentlich", "aggregat", "intern"}


def _slug(s: str) -> str:
    s = s.lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("é", "e"), ("è", "e"), ("à", "a"), ("ç", "c")):
        s = s.replace(a, b)
    return __import__("re").sub(r"[^a-z0-9]+", "-", s).strip("-")[:60] or "org"


def _registrable(host: str) -> str:
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def load_organisations(path: Path, canton_filter: str | None = None) -> list[Entity]:
    """Organisations and their hosts from the host list (one row per host).

    Expected columns (extra columns are kept): hostname, begruendung, organisation,
    uid, sektor, teilsektor, service_typ, kritisch, plz, ort, kanton, quelle_url,
    sichtbarkeit, sicherheit, bemerkung.
    """
    import csv
    orgs: dict[str, Entity] = {}
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            host = _norm_host(row.get("hostname", ""))
            if not host:
                continue
            if canton_filter and row.get("kanton", "").upper() != canton_filter:
                continue
            name = row.get("organisation") or _registrable(host)
            oid = _slug(row.get("uid") or name)
            e = orgs.get(oid)
            if e is None:
                vis = row.get("sichtbarkeit", "").lower() or "aggregat"
                e = Entity("organisation", oid, name, [], code=row.get("kanton", "").upper(),
                           sector=row.get("sektor", ""), subsector=row.get("teilsektor", ""),
                           uid=row.get("uid", ""), visibility=vis if vis in VISIBILITY else "aggregat",
                           place={"plz": row.get("plz", ""), "ort": row.get("ort", ""), "kanton": row.get("kanton", "").upper()})
                orgs[oid] = e
            k = row.get("kritisch", "").lower()
            e.hosts[host] = {
                "service_type": row.get("service_typ", ""),
                "critical": True if k in ("ja", "yes", "true", "1") else (False if k in ("nein", "no", "false", "0") else None),
                "reason": row.get("begruendung", ""), "source_url": row.get("quelle_url", ""),
                "confidence": row.get("sicherheit", ""), "note": row.get("bemerkung", ""),
                "sector": row.get("sektor", "") or e.sector, "subsector": row.get("teilsektor", "") or e.subsector,
            }
            d = _registrable(host)
            if d not in e.domains:
                e.domains.append(d)
    return list(orgs.values())


def load_entities(kinds: list[str], canton_filter: str | None = None,
                  entities_path: Path | None = None,
                  municipalities_path: Path | None = None,
                  overrides_path: Path | None = None, hosts_path: Path | str | None = None) -> list[Entity]:
    """Build the entity list. canton_filter is a canton code (e.g. 'ZG')."""
    ent_cfg = _load_toml(entities_path or CONFIG_DIR / "entities.toml")
    overrides = json.loads((overrides_path or DATA_DIR / "overrides.json").read_text())
    cantons = {c["name"]: c for c in ent_cfg.get("canton", [])}
    out: list[Entity] = []

    if "cantons" in kinds:
        for c in ent_cfg.get("canton", []):
            if canton_filter and c["code"] != canton_filter:
                continue
            out.append(Entity("canton", c["id"], c["name"], [_norm_domain(d) for d in c["domains"]],
                              canton=c["name"], code=c["code"]))

    if "municipalities" in kinds:
        data = json.loads((municipalities_path or DATA_DIR / "municipalities_ch.json").read_text())
        for m in data["municipalities"]:
            ccode = cantons.get(m.get("region", ""), {}).get("code", "")
            if canton_filter and ccode != canton_filter:
                continue
            doms: list[str] = []
            for d in [m.get("website")] + list(m.get("emails") or []):
                if d:
                    nd = _norm_domain(d)
                    if nd and nd not in doms:
                        doms.append(nd)
            out.append(Entity("municipality", str(m["code"]), m["name"], doms,
                              canton=m.get("region", ""), code=ccode))

    if "federal" in kinds:
        for f in ent_cfg.get("federal", []):
            out.append(Entity("federal", f["id"], f["name"], [_norm_domain(d) for d in f["domains"]], code=f["code"]))

    # Some source domains are not the municipality's own: the canton's domain
    # (several Zug municipalities list zg.ch), a domain shared by several
    # municipalities, or a public mail provider. Counting them would attribute
    # someone else's certificates to the municipality, so they are dropped
    # when the municipality has another domain, and flagged when it has none.
    canton_domains = {_norm_domain(d) for c in ent_cfg.get("canton", []) for d in c["domains"]}
    users: dict[str, int] = {}
    for e in out:
        for d in set(e.domains):
            users[d] = users.get(d, 0) + 1
    for e in out:
        if e.kind != "municipality":
            continue
        def foreign(d):
            return d in canton_domains or users.get(d, 0) > 1 or d in PUBLIC_MAIL
        own = [d for d in e.domains if not foreign(d)]
        if own:
            e.domains = own
        else:
            e.shared_domain = True
            e.domains = [d for d in e.domains if d not in PUBLIC_MAIL]

    if "organisations" in kinds:
        hp = DATA_DIR / "critical_services" / "critical_services_ch.csv"
        if not hp.exists():
            hp = DATA_DIR / "hosts_ch.csv"
        if hosts_path is not None:
            hp = Path(hosts_path)
        if hp.exists():
            out.extend(load_organisations(hp, canton_filter))

    for e in out:
        if e.key in overrides.get("replace_domains", {}):
            e.domains = [_norm_domain(d) for d in overrides["replace_domains"][e.key]]
        for d in overrides.get("extra_domains", {}).get(e.key, []):
            nd = _norm_domain(d)
            if nd not in e.domains:
                e.domains.append(nd)
        e.excluded_hosts = dict(overrides.get("exclude_hosts", {}).get(e.key, {}))
    return out

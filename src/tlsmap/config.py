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

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"


PUBLIC_MAIL = {"bluewin.ch", "gmx.ch", "gmx.net", "gmail.com", "hispeed.ch", "sunrise.ch",
               "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "swissonline.ch"}


def _norm_domain(d: str) -> str:
    d = d.strip().lower().rstrip(".")
    for prefix in ("https://", "http://"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    d = d.split("/")[0]
    if d.startswith("www."):
        d = d[4:]
    return d


def load_entities(kinds: list[str], canton_filter: str | None = None,
                  entities_path: Path | None = None,
                  municipalities_path: Path | None = None,
                  overrides_path: Path | None = None) -> list[Entity]:
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

    for e in out:
        if e.key in overrides.get("replace_domains", {}):
            e.domains = [_norm_domain(d) for d in overrides["replace_domains"][e.key]]
        for d in overrides.get("extra_domains", {}).get(e.key, []):
            nd = _norm_domain(d)
            if nd not in e.domains:
                e.domains.append(nd)
        e.excluded_hosts = dict(overrides.get("exclude_hosts", {}).get(e.key, {}))
    return out

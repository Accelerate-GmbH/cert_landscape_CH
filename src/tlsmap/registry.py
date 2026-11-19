"""CA attribution: issuer -> CA owner (via CCADB) -> controller and zone."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path

from .config import CONFIG_DIR


@dataclass
class CA:
    id: str
    name: str
    operator: str                 # CA owner (CCADB) or issuer organisation
    operator_country: str
    controller: str
    control_country: str
    validation: str = "mixed"
    cn_rules: list[tuple[re.Pattern, str]] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    notes: str = ""
    zone: str = "unknown"
    attribution: str = "none"     # ccadb | registry | none
    curated: bool = False         # entry exists in ca_registry.toml


UNKNOWN = CA(id="unknown", name="Unknown CA", operator="?", operator_country="??",
             controller="?", control_country="??", zone="unknown")


def parse_dn(dn: str) -> dict[str, str]:
    """Parse 'C=US, O=Let's Encrypt, CN=R11' (crt.sh / Cert Spotter style)."""
    out: dict[str, str] = {}
    for part in re.split(r",\s*(?=[A-Za-z][A-Za-z0-9.]*=)", dn or ""):
        if "=" in part:
            k, v = part.split("=", 1)
            out.setdefault(k.strip().upper(), v.strip().strip('"'))
    return out


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "unknown"


class Registry:
    def __init__(self, path: Path | None = None, ccadb=None):
        path = path or CONFIG_DIR / "ca_registry.toml"
        with path.open("rb") as fh:
            raw = tomllib.load(fh)
        self.path = path
        self.ccadb = ccadb
        reg = raw.get("registry", {})
        self.zone_basis = reg.get("zone_basis", "control_country")
        self.eea = set(reg.get("eea_countries", []))
        self.cas: list[CA] = []
        self._by_owner: dict[str, CA] = {}
        self._by_org: dict[str, CA] = {}
        self._regex: list[tuple[re.Pattern, CA]] = []
        for e in raw.get("ca", []):
            country = e.get("country", "??")
            owner = (e.get("match_ccadb") or [e["name"]])[0]
            ca = CA(
                id=e["id"], name=e["name"], operator=owner, operator_country=country,
                controller=e.get("controller", owner), control_country=e.get("control_country", country),
                validation=e.get("validation", "mixed"),
                cn_rules=[(re.compile(p, re.I), lvl) for p, lvl in e.get("cn_rules", [])],
                sources=e.get("sources", []), notes=e.get("notes", ""), curated=True,
            )
            ca.zone = self.zone_for(getattr(ca, self.zone_basis))
            self.cas.append(ca)
            for o in e.get("match_ccadb", []):
                self._by_owner[o.lower()] = ca
            for o in e.get("match_org", []):
                self._by_org[o.lower()] = ca
            for rx in e.get("match_org_regex", []):
                self._regex.append((re.compile(rx, re.I), ca))
        self._dynamic: dict[str, CA] = {}

    def zone_for(self, country: str) -> str:
        if country == "CH":
            return "ch"
        if country in self.eea:
            return "eea"
        if not country or country in ("??", "XX"):
            return "unknown"
        return "third"

    def match(self, issuer_org: str, issuer_cn: str = "") -> CA:
        """Attribute an issuing CA. CCADB first, then the issuer's O= field."""
        hit = self.ccadb.lookup(issuer_cn) if (self.ccadb and issuer_cn) else None
        if hit:
            owner = hit["owner"]
            ca = self._by_owner.get(owner.lower())
            if ca:
                # curated entry; the CCADB country is authoritative for the operator
                ccadb_country = hit["country"] if hit["country"] != "??" else ca.operator_country
                if ca.controller == ca.operator:  # no separate parent recorded
                    out = replace(ca, operator_country=ccadb_country, control_country=ccadb_country,
                                  attribution="ccadb")
                else:
                    out = replace(ca, operator_country=ccadb_country, attribution="ccadb")
                out.zone = self.zone_for(getattr(out, self.zone_basis))
                return out
            key = owner.lower()
            if key not in self._dynamic:
                ca = CA(id=_slug(owner), name=owner, operator=owner, operator_country=hit["country"],
                        controller=owner, control_country=hit["country"], attribution="ccadb")
                ca.zone = self.zone_for(getattr(ca, self.zone_basis))
                self._dynamic[key] = ca
            return self._dynamic[key]
        if issuer_org:
            ca = self._by_org.get(issuer_org.lower())
            if not ca:
                ca = next((c for rx, c in self._regex if rx.search(issuer_org)), None)
            if ca:
                return replace(ca, attribution="registry")
        return UNKNOWN

    def root_info(self, issuer_cn: str) -> dict:
        """Root CA above the issuing CA (CCADB), with owner, control country and zone."""
        r = self.ccadb.root_for(issuer_cn) if (self.ccadb and issuer_cn) else None
        if not r:
            return {"root_name": "", "root_owner": "", "root_country": "??", "root_zone": "unknown"}
        ca = self._by_owner.get(r["owner"].lower())
        country = r["country"]
        if ca and ca.controller != ca.operator:      # sourced parent elsewhere
            country = ca.control_country
        return {"root_name": r["root"], "root_owner": r["owner"], "root_country": country,
                "root_zone": self.zone_for(country)}

    @staticmethod
    def validation_from_name(ca: CA, issuer_cn: str) -> str | None:
        """Decide DV/OV/EV without the certificate, or None if it can't."""
        if ca.validation == "dv":
            return "DV"
        for rx, lvl in ca.cn_rules:
            if rx.search(issuer_cn or ""):
                return lvl
        return None

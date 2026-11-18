"""CA registry: map an issuer to operator, controller and sovereignty zone."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from .config import CONFIG_DIR


@dataclass
class CA:
    id: str
    name: str
    operator: str
    operator_country: str
    controller: str
    control_country: str
    validation: str = "mixed"
    cn_rules: list[tuple[re.Pattern, str]] = field(default_factory=list)
    verified: bool = False
    sources: list[str] = field(default_factory=list)
    notes: str = ""
    zone: str = "unknown"


UNKNOWN = CA(id="unknown", name="Unknown CA", operator="?", operator_country="??",
             controller="?", control_country="??", zone="unknown")


def parse_dn(dn: str) -> dict[str, str]:
    """Parse 'C=US, O=Let's Encrypt, CN=R11' (crt.sh / Cert Spotter style)."""
    out: dict[str, str] = {}
    # split on commas that start a new ATTR= pair
    for part in re.split(r",\s*(?=[A-Za-z][A-Za-z0-9.]*=)", dn or ""):
        if "=" in part:
            k, v = part.split("=", 1)
            v = v.strip().strip('"')
            out.setdefault(k.strip().upper(), v)
    return out


class Registry:
    def __init__(self, path: Path | None = None):
        path = path or CONFIG_DIR / "ca_registry.toml"
        with path.open("rb") as fh:
            raw = tomllib.load(fh)
        self.path = path
        reg = raw.get("registry", {})
        self.zone_basis = reg.get("zone_basis", "control_country")
        self.eea = set(reg.get("eea_countries", []))
        self.cas: list[CA] = []
        self._exact: dict[str, CA] = {}
        self._regex: list[tuple[re.Pattern, CA]] = []
        for e in raw.get("ca", []):
            ca = CA(
                id=e["id"], name=e["name"], operator=e.get("operator", ""),
                operator_country=e.get("operator_country", "??"),
                controller=e.get("controller", ""), control_country=e.get("control_country", "??"),
                validation=e.get("validation", "mixed"),
                cn_rules=[(re.compile(p, re.I), lvl) for p, lvl in e.get("cn_rules", [])],
                verified=bool(e.get("verified", False)), sources=e.get("sources", []),
                notes=e.get("notes", ""),
            )
            ca.zone = self.zone_for(getattr(ca, self.zone_basis))
            self.cas.append(ca)
            for o in e.get("match_org", []):
                self._exact[o.lower()] = ca
            for rx in e.get("match_org_regex", []):
                self._regex.append((re.compile(rx, re.I), ca))

    def zone_for(self, country: str) -> str:
        if country == "CH":
            return "ch"
        if country in self.eea:
            return "eea"
        if not country or country in ("??", "XX"):
            return "unknown"
        return "third"

    def match(self, issuer_org: str) -> CA:
        if not issuer_org:
            return UNKNOWN
        ca = self._exact.get(issuer_org.lower())
        if ca:
            return ca
        for rx, ca in self._regex:
            if rx.search(issuer_org):
                return ca
        return UNKNOWN

    @staticmethod
    def validation_from_name(ca: CA, issuer_cn: str) -> str | None:
        """Decide DV/OV/EV without the certificate, or None if it can't."""
        if ca.validation == "dv":
            return "DV"
        for rx, lvl in ca.cn_rules:
            if rx.search(issuer_cn or ""):
                return lvl
        return None

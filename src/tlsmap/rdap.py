"""Registrar of a domain via RDAP (registry first, then the registrar's own
RDAP service), with a small table for registrars whose RDAP data carry no
address."""
from __future__ import annotations

import json
from pathlib import Path

from .config import CONFIG_DIR

BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
# ccTLDs with RDAP that are not in the IANA bootstrap file
EXTRA = {"ch": "https://rdap.nic.ch/", "li": "https://rdap.nic.ch/"}


def _vcard(entity: dict) -> dict:
    out = {}
    for item in (entity.get("vcardArray") or [None, []])[1]:
        if item[0] in ("fn", "org") and not out.get("name"):
            out["name"] = item[3] if isinstance(item[3], str) else " ".join(item[3])
        if item[0] == "adr":
            cc = (item[1] or {}).get("cc")
            v = item[3]
            if isinstance(v, list) and v and isinstance(v[-1], str) and len(v[-1]) == 2:
                cc = cc or v[-1]
            if cc:
                out["country"] = cc.upper()
    return out


def _load_table() -> dict[str, str]:
    p = CONFIG_DIR / "registrars.json"
    try:
        return {k.lower(): v for k, v in json.loads(p.read_text()).items()}
    except (OSError, ValueError):
        return {}


class Rdap:
    def __init__(self, http):
        self.http = http
        self._boot: dict[str, str] | None = None
        self.table = _load_table()

    def _base(self, tld: str) -> str | None:
        if self._boot is None:
            self._boot = {}
            try:
                j = self.http.get_json(BOOTSTRAP, namespace="rdap", ttl_hours=168)
                for tlds, urls in j.get("services", []):
                    for t in tlds:
                        self._boot[t.lower()] = urls[0].rstrip("/") + "/"
            except Exception:  # noqa: BLE001
                pass
        return self._boot.get(tld.lower()) or EXTRA.get(tld.lower())

    def _get(self, url: str) -> dict | None:
        try:
            return self.http.get_json(url, headers={"Accept": "application/rdap+json, application/json"},
                                      namespace="rdap", ttl_hours=168)
        except Exception:  # noqa: BLE001 - not found, rate limited, unsupported TLD
            return None

    def registrar(self, domain: str) -> dict:
        tld = domain.rsplit(".", 1)[-1]
        base = self._base(tld)
        if not base:
            return {"error": "no RDAP service for ." + tld}
        url = base + "domain/" + domain
        j = self._get(url)
        if not j or j.get("errorCode"):
            return {"error": "not found", "url": url}
        out = {"url": url}
        for ev in j.get("events") or []:
            if ev.get("eventAction") == "expiration":
                out["expires"] = ev.get("eventDate", "")[:10]
        reg = next((e for e in j.get("entities") or [] if "registrar" in (e.get("roles") or [])), None)
        if reg:
            out.update(_vcard(reg))
            ids = [p.get("identifier") for p in reg.get("publicIds") or [] if p.get("identifier")]
            if ids:
                out["iana_id"] = ids[0]
        if not out.get("country"):
            # the registrar's own RDAP response often carries its address
            rel = next((lk.get("href") for lk in j.get("links") or []
                        if lk.get("rel") == "related" and "domain/" in (lk.get("href") or "")), None)
            if rel:
                j2 = self._get(rel)
                reg2 = next((e for e in (j2 or {}).get("entities") or [] if "registrar" in (e.get("roles") or [])), None)
                if reg2:
                    v = _vcard(reg2)
                    out.setdefault("name", v.get("name"))
                    if v.get("country"):
                        out["country"], out["country_source"] = v["country"], "registrar rdap"
        if not out.get("country") and out.get("name"):
            name = out["name"].lower()
            for k, cc in self.table.items():
                if k in name:
                    out["country"], out["country_source"] = cc, "table"
                    break
        return out

"""Common CA Database (CCADB) lookup: issuing CA -> CA owner and country.

The CCADB is the database the browser root programs (Mozilla, Chrome,
Microsoft, Apple) use to track which organisation is accountable for every
publicly trusted root and intermediate certificate. Using it means the
attribution of a certificate to a CA owner does not depend on the brand
printed in the certificate: ZeroSSL, Trustico or Gandi intermediates resolve
to Sectigo, QuoVadis and Thawte intermediates to DigiCert, and so on.
"""

from __future__ import annotations

import csv
import io
import json
from collections import Counter, defaultdict
from pathlib import Path

from .http import Http, HttpError

CCADB_URL = "https://ccadb.my.salesforce-sites.com/ccadb/AllCertificateRecordsCSVFormatv4"

COUNTRY_ISO = {
    "switzerland": "CH", "united states of america": "US", "united states": "US", "usa": "US", "us": "US",
    "united kingdom": "GB", "united kingdom of great britain and northern ireland": "GB",
    "belgium": "BE", "germany": "DE", "france": "FR", "italy": "IT", "spain": "ES", "españa": "ES",
    "poland": "PL", "polska": "PL", "greece": "GR", "norway": "NO", "netherlands": "NL", "nl": "NL",
    "austria": "AT", "slovakia": "SK", "slovenia": "SI", "czech republic": "CZ", "denmark": "DK",
    "estonia": "EE", "finland": "FI", "hungary": "HU", "ireland": "IE", "latvia": "LV", "lithuania": "LT",
    "luxembourg": "LU", "portugal": "PT", "romania": "RO", "sweden": "SE", "croatia": "HR", "bulgaria": "BG",
    "japan": "JP", "china": "CN", "中国": "CN", "canada": "CA", "australia": "AU", "israel": "IL",
    "turkey": "TR", "singapore": "SG", "india": "IN", "brazil": "BR", "brasil": "BR", "mexico": "MX",
    "republic of korea (south korea)": "KR", "taiwan (republic of china)": "TW",
    "taiwan, republic of china": "TW", "hong kong special administrative region of the people's republic of china": "HK",
    "saudi arabia": "SA", "uae": "AE", "south africa": "ZA", "serbia": "RS", "tunisia": "TN",
    "malaysia": "MY", "thailand": "TH", "indonesia": "ID", "chile": "CL", "colombia": "CO",
    "uruguay": "UY", "venezuela": "VE", "algeria": "DZ", "bangladesh": "BD", "pakistan": "PK",
    "sri lanka": "LK", "sudan": "SD", "cabo verde": "CV",
}


def iso_country(name: str) -> str:
    n = (name or "").strip()
    if len(n) == 2 and n.isalpha():
        return n.upper()
    return COUNTRY_ISO.get(n.lower(), "??")


class CCADB:
    """Index of CCADB certificate records, linked by SHA-256 fingerprint."""

    def __init__(self, records: dict[str, dict], names: dict[str, list[str]], fetched: str = ""):
        self.records = records    # fp -> {name, owner, sub, country, type, parent, revoked, tls}
        self.names = names        # lower-case certificate name -> [fp, ...]
        self.fetched = fetched

    @classmethod
    def from_index(cls, idx: dict) -> "CCADB":
        return cls(idx["records"], idx["names"], idx.get("fetched", ""))

    @classmethod
    def load(cls, http: Http | None, cache_file: Path, ttl_hours: float = 168) -> "CCADB | None":
        """Download (or reuse) the CCADB export and index it."""
        if http is not None:
            try:
                raw = http.get(CCADB_URL, namespace="ccadb", ttl_hours=ttl_hours,
                               headers={"Accept": "text/csv"})
                idx = cls._index(raw.decode("utf-8-sig"))
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps(idx, ensure_ascii=False))
                return cls.from_index(idx)
            except (HttpError, ValueError, KeyError):
                pass
        if cache_file.exists():
            return cls.from_index(json.loads(cache_file.read_text()))
        return None

    @staticmethod
    def _index(text: str) -> dict:
        records: dict[str, dict] = {}
        names: dict[str, list[str]] = defaultdict(list)
        for r in csv.DictReader(io.StringIO(text)):
            fp = (r.get("SHA-256 Fingerprint") or "").strip().upper()
            name = (r.get("Certificate Name") or "").strip()
            if not fp or not name:
                continue
            rtype = "root" if (r.get("Certificate Record Type") or "").startswith("Root") else "intermediate"
            records[fp] = {
                "name": name, "owner": r["CA Owner"].strip(),
                "sub": (r.get("Subordinate CA Owner") or "").strip(),
                "country": (r.get("Country") or "").strip(), "type": rtype,
                "parent": (r.get("Parent SHA-256 Fingerprint") or "").strip().upper(),
                "revoked": (r.get("Revocation Status") or "").strip() not in ("", "Not Revoked"),
                "tls": r.get("TLS Capable") == "True",
            }
            names[name.lower()].append(fp)
        from datetime import datetime, timezone
        return {"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "records": records, "names": dict(names)}

    def _candidates(self, name: str) -> list[dict]:
        fps = self.names.get((name or "").strip().lower(), [])
        recs = [dict(self.records[f], fp=f) for f in fps if f in self.records]
        # prefer live, TLS-capable intermediates
        recs.sort(key=lambda r: (r["revoked"], not r["tls"], r["type"] == "root"))
        return recs

    def lookup(self, issuer_cn: str) -> dict | None:
        """CA owner for the issuing CA named `issuer_cn`."""
        recs = self._candidates(issuer_cn)
        if not recs:
            return None
        owners = Counter(r["owner"] for r in recs if not r["revoked"]) or Counter(r["owner"] for r in recs)
        owner = owners.most_common(1)[0][0]
        h = next(r for r in recs if r["owner"] == owner)
        return {"owner": owner, "subordinate_owner": h["sub"], "country": iso_country(h["country"]),
                "country_name": h["country"], "ambiguous": len(owners) > 1}

    def _walk(self, fp: str) -> dict | None:
        seen = set()
        while fp and fp in self.records and fp not in seen:
            seen.add(fp)
            rec = self.records[fp]
            if rec["type"] == "root" or not rec["parent"]:
                return {"root": rec["name"], "owner": rec["owner"], "country": iso_country(rec["country"]), "fp": fp}
            fp = rec["parent"]
        return None

    def root_for(self, issuer_cn: str) -> dict | None:
        """Root certificate above the issuing CA, following CCADB parent fingerprints."""
        roots = Counter()
        found = {}
        for rec in self._candidates(issuer_cn):
            if rec["revoked"]:
                continue
            r = self._walk(rec["fp"])
            if r:
                roots[r["fp"]] += 1
                found[r["fp"]] = r
        if not roots:
            return None
        r = found[roots.most_common(1)[0][0]]
        return {"root": r["root"], "owner": r["owner"], "country": r["country"]}

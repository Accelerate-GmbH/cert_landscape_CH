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
    def __init__(self, by_name: dict[str, list[dict]], fetched: str = ""):
        self.by_name = by_name
        self.fetched = fetched

    @classmethod
    def load(cls, http: Http | None, cache_file: Path, ttl_hours: float = 168) -> "CCADB | None":
        """Download (or reuse) the CCADB export and index intermediates by name."""
        if http is not None:
            try:
                raw = http.get(CCADB_URL, namespace="ccadb", ttl_hours=ttl_hours,
                               headers={"Accept": "text/csv"})
                idx = cls._index(raw.decode("utf-8-sig"))
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                cache_file.write_text(json.dumps(idx, ensure_ascii=False))
                return cls(idx["by_name"], idx["fetched"])
            except (HttpError, ValueError, KeyError):
                pass
        if cache_file.exists():
            idx = json.loads(cache_file.read_text())
            return cls(idx["by_name"], idx.get("fetched", ""))
        return None

    @staticmethod
    def _index(text: str) -> dict:
        by_name: dict[str, Counter] = defaultdict(Counter)
        for r in csv.DictReader(io.StringIO(text)):
            if r.get("TLS Capable") != "True":
                continue
            key = (r.get("Certificate Name") or "").strip().lower()
            if not key:
                continue
            by_name[key][(r["CA Owner"].strip(), (r.get("Subordinate CA Owner") or "").strip(),
                          r.get("Country", "").strip())] += 1
        from datetime import datetime, timezone
        return {
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "by_name": {k: [{"owner": o, "subordinate_owner": s, "country": c, "n": n}
                            for (o, s, c), n in v.most_common()] for k, v in by_name.items()},
        }

    def lookup(self, issuer_cn: str) -> dict | None:
        """CA owner for the issuing CA named `issuer_cn` (most frequent record wins)."""
        hits = self.by_name.get((issuer_cn or "").strip().lower())
        if not hits:
            return None
        h = hits[0]
        return {"owner": h["owner"], "subordinate_owner": h["subordinate_owner"],
                "country": iso_country(h["country"]), "country_name": h["country"],
                "ambiguous": len({x["owner"] for x in hits}) > 1}

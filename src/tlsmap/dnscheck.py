"""DNS checks over DNS-over-HTTPS: existence, CNAME platform, CAA, network origin."""

from __future__ import annotations

import ipaddress
import urllib.parse

from .http import Http, HttpError

TYPE_A, TYPE_CNAME, TYPE_AAAA, TYPE_TXT, TYPE_CAA = 1, 5, 28, 16, 257
NAME_TO_TYPE = {"A": TYPE_A, "CNAME": TYPE_CNAME, "AAAA": TYPE_AAAA, "TXT": TYPE_TXT, "CAA": TYPE_CAA}


class DoH:
    def __init__(self, http: Http, endpoints: list[str], ttl_hours: float = 24):
        self.http = http
        self.endpoints = endpoints
        self.ttl = ttl_hours

    def query(self, name: str, rtype: str) -> dict:
        """Return {'status': int|None, 'answers': [{'type': int, 'data': str, 'name': str}]}."""
        last = None
        for ep in self.endpoints:
            url = ep + "?" + urllib.parse.urlencode({"name": name, "type": rtype})
            try:
                j = self.http.get_json(url, headers={"Accept": "application/dns-json"},
                                       namespace="dns", ttl_hours=self.ttl)
                return {"status": j.get("Status"),
                        "answers": [{"type": a.get("type"), "data": a.get("data", ""), "name": a.get("name", "")}
                                    for a in j.get("Answer", []) or []]}
            except (HttpError, ValueError) as e:
                last = e
        return {"status": None, "answers": [], "error": str(last)}

    # -- hostnames -----------------------------------------------------------
    def host(self, name: str) -> dict:
        q = self.query(name, "A")
        status = q["status"]
        cnames = [a["data"].rstrip(".").lower() for a in q["answers"] if a["type"] == TYPE_CNAME]
        ips = [a["data"] for a in q["answers"] if a["type"] == TYPE_A]
        if status == 0 and not ips:
            q6 = self.query(name, "AAAA")
            cnames += [a["data"].rstrip(".").lower() for a in q6["answers"]
                       if a["type"] == TYPE_CNAME and a["data"].rstrip(".").lower() not in cnames]
            ips += [a["data"] for a in q6["answers"] if a["type"] == TYPE_AAAA]
        if status is None:
            state = "error"
        elif status == 3:
            state = "nxdomain"
        elif status != 0:
            state = f"rcode{status}"
        elif ips:
            state = "resolves"
        else:
            state = "no_address"
        return {"state": state, "cnames": cnames, "ips": ips}

    # -- CAA -----------------------------------------------------------------
    def caa(self, domain: str) -> dict:
        """CAA records that apply to `domain` (climbing to the parent if needed)."""
        labels = domain.split(".")
        for i in range(len(labels) - 1):  # never query the TLD itself
            d = ".".join(labels[i:])
            q = self.query(d, "CAA")
            recs = [a["data"] for a in q["answers"] if a["type"] == TYPE_CAA]
            if recs:
                return {"found_at": d, "records": recs, **parse_caa(recs)}
        return {"found_at": None, "records": [], "issue": [], "issuewild": [], "iodef": []}

    # -- network origin (Team Cymru, over DoH) -------------------------------
    def asn(self, ip: str) -> dict:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return {}
        if addr.version == 4:
            qname = ".".join(reversed(ip.split("."))) + ".origin.asn.cymru.com"
        else:
            nibbles = addr.exploded.replace(":", "")
            qname = ".".join(reversed(nibbles)) + ".origin6.asn.cymru.com"
        q = self.query(qname, "TXT")
        txt = [a["data"].strip('"') for a in q["answers"] if a["type"] == TYPE_TXT]
        if not txt:
            return {}
        parts = [p.strip() for p in txt[0].split("|")]
        asn = parts[0].split()[0] if parts and parts[0] else ""
        out = {"asn": asn, "prefix": parts[1] if len(parts) > 1 else "",
               "country": parts[2] if len(parts) > 2 else "", "as_name": ""}
        if asn:
            q2 = self.query(f"AS{asn}.asn.cymru.com", "TXT")
            t2 = [a["data"].strip('"') for a in q2["answers"] if a["type"] == TYPE_TXT]
            if t2:
                p2 = [p.strip() for p in t2[0].split("|")]
                out["as_name"] = p2[4] if len(p2) > 4 else ""
        return out


def parse_caa(records: list[str]) -> dict:
    out = {"issue": [], "issuewild": [], "iodef": []}
    for r in records:
        parts = r.split(None, 2)
        if len(parts) < 3:
            continue
        tag = parts[1].lower()
        val = parts[2].strip().strip('"')
        if tag in out:
            out[tag].append(val.split(";")[0].strip().lower())
    return out


def platform_for(cnames: list[str], platforms: dict[str, str]) -> str:
    for c in cnames:
        for suffix, name in platforms.items():
            if c == suffix or c.endswith("." + suffix):
                return name
    return ""


# CAA issuer domains -> registry CA id, for checking whether the entity's CAA
# policy points to Swiss CAs. Values come from the CAs' published CPS.
CAA_DOMAINS = {
    "swisssign.com": "swisssign",
    "wisekey.com": "wisekey",
    "letsencrypt.org": "letsencrypt",
    "digicert.com": "digicert", "symantec.com": "digicert", "geotrust.com": "digicert",
    "thawte.com": "digicert", "rapidssl.com": "digicert", "quovadisglobal.com": "quovadis",
    "pki.goog": "google", "amazon.com": "amazon", "amazontrust.com": "amazon",
    "awstrust.com": "amazon", "amazonaws.com": "amazon",
    "sectigo.com": "sectigo", "comodoca.com": "sectigo", "usertrust.com": "sectigo",
    "trust-provider.com": "sectigo-branded",
    "zerossl.com": "zerossl",
    "globalsign.com": "globalsign",
    "godaddy.com": "godaddy", "starfieldtech.com": "godaddy",
    "ssl.com": "sslcom", "certainly.com": "certainly",
    "certum.pl": "certum", "certum.eu": "certum",
    "harica.gr": "harica", "buypass.com": "buypass", "buypass.no": "buypass",
    "actalis.it": "actalis", "d-trust.net": "dtrust", "telesec.de": "telekom",
    "entrust.net": "entrust", "affirmtrust.com": "entrust",
}

"""DNS checks over DNS-over-HTTPS: existence, CNAME platform, CAA, network origin."""

from __future__ import annotations

import ipaddress
import urllib.parse

from .http import Http, HttpError

import base64
import struct

TYPE_A, TYPE_NS, TYPE_CNAME, TYPE_AAAA, TYPE_TXT, TYPE_DS, TYPE_HTTPS, TYPE_CAA = 1, 2, 5, 28, 16, 43, 65, 257
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
                return {"status": j.get("Status"), "ad": bool(j.get("AD")),
                        "answers": [{"type": a.get("type"), "data": a.get("data", ""), "name": a.get("name", "")}
                                    for a in j.get("Answer", []) or []]}
            except (HttpError, ValueError) as e:
                last = e
        return {"status": None, "ad": False, "answers": [], "error": str(last)}

    # -- hostnames -----------------------------------------------------------
    def host(self, name: str) -> dict:
        """Addresses (A and AAAA), CNAME chain and DNSSEC validation of a hostname.

        `dnssec` is True when the resolver validated the answer (AD flag), i.e.
        the whole chain from the root down to this name is signed and valid.
        """
        q4 = self.query(name, "A")
        status = q4["status"]
        cnames = [a["data"].rstrip(".").lower() for a in q4["answers"] if a["type"] == TYPE_CNAME]
        ips4 = [a["data"] for a in q4["answers"] if a["type"] == TYPE_A]
        ips6: list[str] = []
        ad = q4.get("ad", False) if status == 0 else False
        if status == 0:
            q6 = self.query(name, "AAAA")
            ips6 = [a["data"] for a in q6["answers"] if a["type"] == TYPE_AAAA]
            if ips6:
                ad = ad and q6.get("ad", False) if ips4 else q6.get("ad", False)
        ips = ips4 + ips6
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
        return {"state": state, "cnames": cnames, "ips": ips, "ips4": ips4, "ips6": ips6, "dnssec": bool(ad and ips)}

    # -- ECH -------------------------------------------------------------------
    def ech(self, name: str) -> dict:
        """HTTPS resource record and whether it carries a valid ECH configuration."""
        q = self.query(name, "HTTPS")
        recs = [a["data"] for a in q["answers"] if a["type"] == TYPE_HTTPS]
        if not recs:
            return {"https_rr": False, "ech": "none"}
        for r in recs:
            cfg = ech_from_rdata(r)
            if cfg is not None:
                return {"https_rr": True, "ech": "valid" if valid_ech_config(cfg) else "invalid"}
        return {"https_rr": True, "ech": "none"}

    # -- zone ------------------------------------------------------------------
    def zone(self, domain: str) -> dict:
        """DNSSEC signing of the zone and its authoritative name servers."""
        ds = self.query(domain, "DS")
        signed = any(a["type"] == TYPE_DS for a in ds["answers"]) and ds.get("ad", False)
        ns = self.query(domain, "NS")
        servers = sorted({a["data"].rstrip(".").lower() for a in ns["answers"] if a["type"] == TYPE_NS})
        return {"dnssec_signed": signed, "ns": servers}

        # -- CAA -----------------------------------------------------------------
    def caa(self, domain: str, stop_at: str | None = None) -> dict:
        """CAA records that apply to `domain`, climbing towards the parent (RFC 8659).

        With `stop_at`, the climb ends at that domain (e.g. the entity's domain)."""
        labels = domain.split(".")
        last = len(labels) - 1
        if stop_at and (domain == stop_at or domain.endswith("." + stop_at)):
            last = len(labels) - len(stop_at.split(".")) + 1
        for i in range(last):  # never query the TLD itself
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
                out["as_name"] = clean_as_name(p2[4]) if len(p2) > 4 else ""
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


def ech_from_rdata(rdata: str) -> bytes | None:
    """ECHConfigList from an HTTPS record, presentation or RFC 3597 hex form."""
    m = __import__("re").search(r'ech="?([A-Za-z0-9+/=]+)"?', rdata)
    if m:
        try:
            return base64.b64decode(m.group(1))
        except ValueError:
            return b""
    if rdata.startswith("\\#"):
        try:
            raw = bytes.fromhex("".join(rdata.split()[2:]))
            pos = 2                                     # SvcPriority
            while pos < len(raw) and raw[pos] != 0:     # TargetName labels
                pos += 1 + raw[pos]
            pos += 1
            while pos + 4 <= len(raw):
                key, ln = struct.unpack("!HH", raw[pos:pos + 4])
                if key == 5:
                    return raw[pos + 4:pos + 4 + ln]
                pos += 4 + ln
        except ValueError:
            return b""
    return None


def valid_ech_config(data: bytes) -> bool:
    """Structural check of an ECHConfigList (draft-ietf-tls-esni, version 0xfe0d)."""
    if len(data) < 4:
        return False
    total = struct.unpack("!H", data[:2])[0]
    if total != len(data) - 2:
        return False
    pos, found = 2, False
    while pos + 4 <= len(data):
        version, ln = struct.unpack("!HH", data[pos:pos + 4])
        if pos + 4 + ln > len(data):
            return False
        if version == 0xFE0D and ln > 0:
            found = True
        pos += 4 + ln
    return found and pos == len(data)


def clean_as_name(raw: str) -> str:
    """'KNIPP-AS - Knipp Medien und Kommunikation GmbH, DE' -> 'Knipp Medien und Kommunikation GmbH'."""
    name = raw.strip()
    if " - " in name:
        name = name.split(" - ", 1)[1]
    name = __import__("re").sub(r",\s*[A-Z]{2}$", "", name)
    return name.strip() or raw.strip()

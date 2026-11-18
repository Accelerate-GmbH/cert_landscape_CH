"""Certificate Transparency discovery and per-hostname current certificate."""

from __future__ import annotations

import os
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .http import Http, HttpError
from .registry import parse_dn


def _iso(ts: str) -> str:
    """Normalise to YYYY-MM-DDTHH:MM:SSZ."""
    ts = ts.strip()
    if ts.endswith("Z"):
        ts = ts[:-1]
    ts = ts.split(".")[0]
    return ts + "Z"


def _parse_iso(ts: str) -> datetime:
    return datetime.strptime(_iso(ts), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


@dataclass
class CertRecord:
    source: str
    id: str
    issuer_dn: str
    not_before: str
    not_after: str
    names: list[str]
    sha256: str | None = None
    der_b64: str | None = None
    revoked: bool | None = None
    issuer_org: str = ""
    issuer_cn: str = ""

    def __post_init__(self):
        dn = parse_dn(self.issuer_dn)
        self.issuer_org = self.issuer_org or dn.get("O", "")
        self.issuer_cn = self.issuer_cn or dn.get("CN", "")
        self.names = sorted({n.strip().lower().rstrip(".") for n in self.names if n and n.strip()})

    def valid_at(self, now: datetime) -> bool:
        return _parse_iso(self.not_before) <= now < _parse_iso(self.not_after)


@dataclass
class DiscoveryResult:
    domain: str
    source: str
    records: list[CertRecord] = field(default_factory=list)
    error: str | None = None
    newest_not_before: str | None = None


class CTClient:
    def __init__(self, http: Http, order: list[str], ttl_hours: float = 72,
                 certspotter_requires_key: bool = True):
        self.http = http
        self.ttl = ttl_hours
        self.cs_key = os.environ.get("CERTSPOTTER_API_KEY", "").strip()
        self.order = [s for s in order if not (s == "certspotter" and certspotter_requires_key and not self.cs_key)]
        if not self.order:
            self.order = ["crtsh"]

    # -- sources ---------------------------------------------------------------
    def crtsh(self, domain: str) -> list[CertRecord]:
        q = urllib.parse.quote(f"%.{domain}")
        url = f"https://crt.sh/?q={q}&output=json&exclude=expired&deduplicate=Y"
        rows = None
        for attempt in range(3):
            try:
                rows = self.http.get_json(url, namespace="ct", ttl_hours=self.ttl)
                break
            except HttpError as e:   # crt.sh answers 404 or 5xx when overloaded
                if e.status != 404 or attempt == 2:
                    raise
                __import__("time").sleep(10 * (attempt + 1))
        out = []
        for r in rows or []:
            out.append(CertRecord(
                source="crtsh", id=str(r["id"]), issuer_dn=r.get("issuer_name", ""),
                not_before=_iso(r["not_before"]), not_after=_iso(r["not_after"]),
                names=(r.get("name_value") or "").split("\n") + [r.get("common_name") or ""],
            ))
        return out

    def certspotter(self, domain: str) -> list[CertRecord]:
        headers = {"Authorization": f"Bearer {self.cs_key}"} if self.cs_key else {}
        out: list[CertRecord] = []
        after = None
        for _ in range(1000):  # pagination guard
            params = [("domain", domain), ("include_subdomains", "true"),
                      ("expand", "dns_names"), ("expand", "issuer"), ("expand", "cert_der")]
            if after:
                params.append(("after", after))
            url = "https://api.certspotter.com/v1/issuances?" + urllib.parse.urlencode(params)
            rows = self.http.get_json(url, headers=headers, namespace="ct", ttl_hours=self.ttl)
            if not rows:
                break
            for r in rows:
                iss = r.get("issuer") or {}
                out.append(CertRecord(
                    source="certspotter", id=str(r["id"]), issuer_dn=iss.get("name", ""),
                    not_before=_iso(r["not_before"]), not_after=_iso(r["not_after"]),
                    names=r.get("dns_names") or [], sha256=r.get("cert_sha256"),
                    der_b64=r.get("cert_der"), revoked=r.get("revoked"),
                ))
            after = rows[-1]["id"]
        return out

    def discover(self, domain: str) -> DiscoveryResult:
        errors = []
        for src in self.order:
            try:
                recs = getattr(self, src)(domain)
                res = DiscoveryResult(domain=domain, source=src, records=recs)
                if recs:
                    res.newest_not_before = max(r.not_before for r in recs)
                return res
            except (HttpError, ValueError, KeyError) as e:
                errors.append(f"{src}: {e}")
        return DiscoveryResult(domain=domain, source="none", error="; ".join(errors))

    def fetch_der(self, rec: CertRecord) -> bytes | str | None:
        """Get the certificate itself (only needed for crt.sh records)."""
        if rec.der_b64:
            return rec.der_b64
        if rec.source == "crtsh":
            try:
                return self.http.get(f"https://crt.sh/?d={rec.id}", namespace="cert",
                                     ttl_hours=None, headers={"Accept": "application/x-pem-file"})
            except HttpError:
                return None
        return None


def in_scope(name: str, domains: list[str]) -> bool:
    bare = name[2:] if name.startswith("*.") else name
    return any(bare == d or bare.endswith("." + d) for d in domains)


@dataclass
class HostCert:
    hostname: str
    record: CertRecord
    other_issuers: list[str]           # issuer orgs of other valid certs for the same name
    valid_cert_count: int              # how many valid certificates exist for the name


def current_certs(records: list[CertRecord], domains: list[str], now: datetime | None = None) -> dict[str, HostCert]:
    """One entry per hostname: the most recently issued certificate that is valid now."""
    now = now or datetime.now(timezone.utc)
    by_name: dict[str, list[CertRecord]] = {}
    seen: set[tuple[str, str]] = set()
    for rec in records:
        if not rec.valid_at(now):
            continue
        for n in rec.names:
            if not in_scope(n, domains):
                continue
            key = (n, rec.sha256 or rec.issuer_dn + rec.not_before + rec.not_after)
            if key in seen:  # same cert seen twice (precert + final, two sources)
                continue
            seen.add(key)
            by_name.setdefault(n, []).append(rec)
    out: dict[str, HostCert] = {}
    for n, recs in by_name.items():
        recs.sort(key=lambda r: (r.not_before, r.not_after), reverse=True)
        cur = recs[0]
        others = sorted({r.issuer_org for r in recs[1:] if r.issuer_org != cur.issuer_org})
        out[n] = HostCert(hostname=n, record=cur, other_issuers=others, valid_cert_count=len(recs))
    return out

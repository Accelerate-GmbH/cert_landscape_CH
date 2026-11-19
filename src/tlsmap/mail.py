"""Mail checks per domain.

Most of it is read from DNS: where the mail servers (MX) run, whether the
domain asks senders to use TLS (MTA-STS, DANE), whether it collects TLS
reports (TLS-RPT), and how it protects against spoofing (SPF, DMARC). One
optional STARTTLS handshake per mail server on port 25 adds the TLS version
and whether the certificate is valid for the server's name.

The result per domain is rated with its own checks (category "mail"); it
does not change the web Trust Posture.
"""
from __future__ import annotations

import re
import smtplib
import ssl
from concurrent.futures import ThreadPoolExecutor

from . import posture
from .dnscheck import TYPE_TXT

TYPE_MX, TYPE_TLSA = 15, 52

CHECKS = ["mail.mx", "mail.starttls", "mail.transport", "mail.tlsrpt", "mail.dmarc", "mail.spf"]
DEFAULT_WEIGHTS = {"mail.mx": 2, "mail.starttls": 2, "mail.transport": 2, "mail.tlsrpt": 1, "mail.dmarc": 2, "mail.spf": 1}


def _txt(answers: list[dict]) -> list[str]:
    out = []
    for a in answers:
        if a["type"] == TYPE_TXT:
            # DoH returns quoted chunks; join them
            out.append("".join(re.findall(r'"([^"]*)"', a["data"])) or a["data"].strip('"'))
    return out


def parse_sts_policy(text: str) -> dict:
    pol = {}
    for line in (text or "").splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            k = k.strip().lower()
            if k == "mx":
                pol.setdefault("mx", []).append(v.strip())
            else:
                pol[k] = v.strip()
    return pol


def spf_all(record: str) -> str:
    """The qualifier of 'all' in an SPF record: '-', '~', '?', '+' or '' (none)."""
    m = re.search(r"(?:^|\s)([-~?+]?)all(?:\s|$)", record or "")
    if not m:
        return "redirect" if "redirect=" in (record or "") else ""
    return m.group(1) or "+"


def dmarc_policy(record: str) -> str:
    m = re.search(r"(?:^|;)\s*p\s*=\s*(\w+)", record or "", re.I)
    return m.group(1).lower() if m else ""


class MailCheck:
    def __init__(self, doh, http, conc: int = 16, probe: bool = False, timeout: float = 15):
        self.doh, self.http, self.conc, self.probe, self.timeout = doh, http, conc, probe, timeout
        self._asn: dict[str, dict] = {}

    # -- DNS ------------------------------------------------------------------
    def _asn_of(self, ip: str) -> dict:
        if ip not in self._asn:
            self._asn[ip] = self.doh.asn(ip)
        return self._asn[ip]

    def domain(self, d: str) -> dict:
        q = self.doh.query(d, "MX")
        mx = []
        for a in q["answers"]:
            if a["type"] != TYPE_MX:
                continue
            parts = a["data"].split()
            if len(parts) == 2:
                mx.append((int(parts[0]), parts[1].rstrip(".").lower()))
        mx.sort()
        out = {"domain": d, "mx": [], "null_mx": any(h in ("", ".") for _, h in mx)}
        txt = _txt(self.doh.query(d, "TXT")["answers"])
        spf = [t for t in txt if t.lower().startswith("v=spf1")]
        out["spf"] = spf[0] if spf else ""
        # follow redirect= (up to three steps) to find the effective 'all'
        rec, hops = out["spf"], 0
        while rec and spf_all(rec) == "redirect" and hops < 3:
            m = re.search(r"redirect=(\S+)", rec)
            nxt = [t for t in _txt(self.doh.query(m.group(1).rstrip("."), "TXT")["answers"]) if t.lower().startswith("v=spf1")] if m else []
            rec, hops = (nxt[0] if nxt else ""), hops + 1
        out["spf_all"] = spf_all(rec) if rec else ""
        dm = [t for t in _txt(self.doh.query("_dmarc." + d, "TXT")["answers"]) if t.lower().startswith("v=dmarc1")]
        out["dmarc"] = dm[0] if dm else ""
        rpt = [t for t in _txt(self.doh.query("_smtp._tls." + d, "TXT")["answers"]) if t.lower().startswith("v=tlsrptv1")]
        out["tlsrpt"] = rpt[0] if rpt else ""
        sts = [t for t in _txt(self.doh.query("_mta-sts." + d, "TXT")["answers"]) if t.lower().startswith("v=stsv1")]
        out["sts_txt"] = sts[0] if sts else ""
        out["sts_mode"] = ""
        if sts:
            try:
                body = self.http.get(f"https://mta-sts.{d}/.well-known/mta-sts.txt", headers={"Accept": "text/plain, */*"},
                                     namespace="mail", ttl_hours=24)
                out["sts_mode"] = parse_sts_policy(body.decode("utf-8", "replace")).get("mode", "").lower() or "invalid"
            except Exception:  # noqa: BLE001 - unreachable policy host counts as no policy
                out["sts_mode"] = "unreachable"
        for pref, host in mx:
            if not host or host == ".":
                continue
            h = self.doh.host(host)
            ips = (h.get("ips4") or []) + (h.get("ips6") or [])
            nets = [self._asn_of(ip) for ip in ips[:4]]
            tlsa = self.doh.query("_25._tcp." + host, "TLSA")
            out["mx"].append({
                "host": host, "pref": pref, "ips": ips[:4],
                "nets": [[n.get("as_name", ""), n.get("country", "")] for n in nets if n],
                "dane": any(a["type"] == TYPE_TLSA for a in tlsa["answers"]) and bool(tlsa.get("ad")),
            })
        return out

    # -- STARTTLS -------------------------------------------------------------
    def _smtp(self, host: str, ip: str) -> smtplib.SMTP:
        s = smtplib.SMTP(timeout=self.timeout)
        code, _ = s.connect(ip, 25)
        s._host = host            # name for SNI and certificate check (connect() stores the IP)
        if code != 220:
            s.close()
            raise smtplib.SMTPConnectError(code, "banner")
        s.ehlo("tlsmap.invalid")
        return s

    def starttls(self, host: str, ip: str) -> dict:
        """STARTTLS on port 25: TLS version and whether the certificate is valid
        for the server name. Never raises."""
        try:
            s = self._smtp(host, ip)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}
        try:
            if not s.has_extn("starttls"):
                return {"ok": True, "starttls": False}
            try:
                s.starttls(context=ssl.create_default_context())
                return {"ok": True, "starttls": True, "tls": s.sock.version(), "valid": True}
            except ssl.SSLCertVerificationError as e:
                return {**self._starttls_unverified(host, ip), "valid": False,
                        "verify_error": (getattr(e, "verify_message", "") or str(e))[:160]}
        except Exception as e:  # noqa: BLE001
            return {"ok": True, "starttls": True, "tls": "", "error": f"{type(e).__name__}: {str(e)[:120]}"}
        finally:
            try:
                s.close()
            except Exception:  # noqa: BLE001
                pass

    def _starttls_unverified(self, host: str, ip: str) -> dict:
        try:
            s = self._smtp(host, ip)
            ctx = ssl.create_default_context()
            ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
            s.starttls(context=ctx)
            ver = s.sock.version()
            s.close()
            return {"ok": True, "starttls": True, "tls": ver}
        except Exception as e:  # noqa: BLE001
            return {"ok": True, "starttls": True, "tls": "", "error": f"{type(e).__name__}: {str(e)[:120]}"}

    def run(self, domains: list[str]) -> dict[str, dict]:
        with ThreadPoolExecutor(self.conc) as ex:
            res = dict(zip(domains, ex.map(self.domain, domains)))
        if self.probe:
            jobs = sorted({(m["host"], m["ips"][0]) for r in res.values() for m in r["mx"] if m["ips"]})
            with ThreadPoolExecutor(self.conc) as ex:
                probes = dict(zip(jobs, ex.map(lambda j: self.starttls(*j), jobs)))
            for r in res.values():
                for m in r["mx"]:
                    if m["ips"]:
                        m["tls"] = probes.get((m["host"], m["ips"][0]))
        return res


# -- rating ---------------------------------------------------------------------
def evaluate(info: dict, selfs: set[str], eea: set[str]) -> list[dict]:
    """Checks for one mail domain; empty if the domain receives no mail."""
    mx = info.get("mx") or []
    if not mx:
        return []
    out = []

    def add(cid, status, value="", method="", evidence=""):
        out.append({"check": cid, "category": "mail", "status": status, "value": value,
                    "method": method, "evidence": evidence})

    nets = [tuple(n) for m in mx for n in m.get("nets") or []]
    add("mail.mx", posture.hosting_status(nets, selfs, eea) if nets else "n/a",
        ", ".join(sorted({f"{n} ({c})" for n, c in nets})), "mx-asn", ", ".join(m["host"] for m in mx))

    probes = [m.get("tls") for m in mx if m.get("tls")]
    answered = [p for p in probes if p.get("ok")]
    if not probes or not answered:
        add("mail.starttls", "n/a", "", "none", "STARTTLS not tested" if not probes else "no mail server answered on port 25")
    else:
        good = [p for p in answered if p.get("starttls") and p.get("valid", True) and p.get("tls") in ("TLSv1.3", "TLSv1.2")]
        best = all(p.get("starttls") and p.get("valid", True) and p.get("tls") == "TLSv1.3" for p in answered)
        st = "pass" if best else ("partial" if good else "fail")
        add("mail.starttls", st, ", ".join(sorted({(p.get("tls") or ("no STARTTLS" if not p.get("starttls") else "?")) +
                                                ("" if p.get("valid", True) else " invalid cert") for p in answered})), "smtp-starttls")

    dane = all(m.get("dane") for m in mx)
    mode = info.get("sts_mode", "")
    if dane or mode == "enforce":
        st = "pass"
    elif mode == "testing" or any(m.get("dane") for m in mx):
        st = "partial"
    else:
        st = "fail"
    add("mail.transport", st, ("DANE" if dane else "") + (" MTA-STS " + mode if mode else "") or "none", "dns-tlsa,mta-sts")

    add("mail.tlsrpt", "pass" if info.get("tlsrpt") else "fail", info.get("tlsrpt", "") or "none", "dns-txt")

    p = dmarc_policy(info.get("dmarc", ""))
    add("mail.dmarc", {"reject": "pass", "quarantine": "partial"}.get(p, "fail"), info.get("dmarc", "") or "none", "dns-txt")

    q = info.get("spf_all") if "spf_all" in info else spf_all(info.get("spf", ""))
    add("mail.spf", {"-": "pass", "~": "partial", "redirect": "partial"}.get(q, "fail"), info.get("spf", "") or "none", "dns-txt")
    return out


def score(checks: list[dict], weights: dict, points: dict) -> int | None:
    num = den = 0.0
    for c in checks:
        if c["status"] == "n/a":
            continue
        w = weights.get(c["check"], 1)
        num += w * points.get(c["status"], 0)
        den += w
    return round(100 * num / den) if den else None


def entity_mail(domain_results: dict[str, dict], domains: list[str], selfs: set[str], eea: set[str],
                weights: dict, points: dict) -> dict:
    doms, scores = [], []
    agg: dict[str, dict] = {}
    for d in domains:
        info = domain_results.get(d)
        if not info:
            continue
        checks = evaluate(info, selfs, eea)
        o = score(checks, weights, points) if checks else None
        if o is not None:
            scores.append(o)
        for c in checks:
            a = agg.setdefault(c["check"], {"pass": 0, "partial": 0, "fail": 0})
            if c["status"] in a:
                a[c["status"]] += 1
        doms.append({"domain": d, "overall": o, "checks": checks, "null_mx": info.get("null_mx", False),
                     "mx": [{"host": m["host"], "pref": m["pref"], "nets": m.get("nets"), "dane": m.get("dane"),
                             "tls": m.get("tls")} for m in info.get("mx", [])]})
    return {"overall": round(sum(scores) / len(scores)) if scores else None, "domains": doms, "checks": agg,
            "rated": len(scores)}

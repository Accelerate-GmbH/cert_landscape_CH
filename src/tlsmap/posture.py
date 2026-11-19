"""Trust Posture rating (draft v0.1, documented in docs/RATING.md).

A *resource* is a hostname in use (it resolves in public DNS). Each resource
gets twelve checks in four categories; check results become category scores,
and category scores a weighted overall score. Resources are then aggregated
per canton or municipality, with critical resources counting more.
"""

from __future__ import annotations

CATEGORIES = ["ownership", "sovereignty", "security", "privacy"]
CHECK_CATEGORY = {
    "own.identity": "ownership", "own.revocation": "ownership", "own.dnssec": "ownership",
    "own.caa": "ownership", "own.ct": "ownership", "own.sectxt": "ownership",
    "sov.ca": "sovereignty", "sov.dns": "sovereignty", "sov.registrar": "sovereignty", "sov.hosting": "sovereignty", "sov.tld": "sovereignty",
    "sec.tls13": "security", "sec.pqc": "security", "sec.hsts": "security",
    "prv.ech": "privacy",
}
IDENTITY_LEVELS = ("OV", "EV", "IV")


def _zone_status(zones: list[str]) -> str:
    """All Swiss -> pass; all Swiss or EEA -> partial; anything else -> fail."""
    if not zones:
        return "n/a"
    if all(z == "ch" for z in zones):
        return "pass"
    if all(z in ("ch", "eea") for z in zones):
        return "partial"
    return "fail"


# -- operators of name servers and hosting networks --------------------------
import re as _re
import unicodedata as _ud

_LEGAL = {"ag", "sa", "gmbh", "inc", "llc", "ltd", "bv", "b.v.", "corp", "corporation", "co", "plc", "sarl", "srl",
          "spa", "the", "international", "group", "holding", "company", "technologies", "services", "online",
          "kanton", "canton", "cantone", "stadt", "gemeinde", "commune", "comune", "ville", "citta"}


def _fold(s: str) -> str:
    s = s.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = "".join(c for c in _ud.normalize("NFKD", s) if not _ud.combining(c))
    return _re.sub(r"[^a-z0-9.\- ]", " ", s)


def operator_key(as_name: str) -> str:
    """Rough operator identity from an AS name: 'Akamai International B.V.' and
    'Akamai Technologies, Inc.' are both 'akamai'; 'UBS AG' and 'UBS Group AG'
    are both 'ubs'; 'Amazon.com, Inc.' is 'amazon'."""
    for tok in _fold(as_name).split():
        tok = tok.strip(".-").split(".")[0]
        if len(tok) > 1 and tok not in _LEGAL:
            return tok
    return _fold(as_name).strip()


def self_tokens(name: str, domains: list[str]) -> set[str]:
    """Words that identify the organisation itself in AS names."""
    out = {t for t in _fold(name).split() if len(t) > 2 and t not in _LEGAL}
    for d in domains:
        lab = d.split(".")[-2] if "." in d else d
        if len(lab) > 2:
            out.add(lab)
            out.update(x for x in lab.split("-") if len(x) > 2)
    return out


def parse_providers(text: str) -> list[tuple[str, str]]:
    """'Akamai International B.V. (NL), Vercara, LLC (US)' -> [(name, cc), ...]"""
    return [(m.group(1).strip(), m.group(2)) for m in _re.finditer(r"(.+?) \(([A-Z]{0,2}|\?)\)(?:, |$)", text or "")]


def _local(name: str, cc: str, selfs: set[str]) -> bool:
    return cc == "CH" or bool(selfs and operator_key(name) in selfs)


def dns_status(providers: list[tuple[str, str]], selfs: set[str], eea: set[str]) -> str:
    """Name servers of a zone.
    pass: all at the organisation itself or in Switzerland; or spread over at
          least two independent operators of which one is local; or spread
          over independent operators in at least two jurisdictions (e.g. USA
          and Asia; the EU/EEA counts as one jurisdiction);
    partial: several independent operators in one foreign jurisdiction, or all
          in the EU/EEA;
    fail: a single foreign operator outside the EU/EEA."""
    if not providers:
        return "n/a"
    local = [_local(n, c, selfs) for n, c in providers]
    if all(local):
        return "pass"
    juris: dict[str, set] = {}
    for (n, c), l in zip(providers, local):
        juris.setdefault(operator_key(n), set()).add("local" if l else ("EEA" if c in eea else c or "?"))
    if len(juris) >= 2:
        if any("local" in j for j in juris.values()):
            return "pass"
        if len(set().union(*juris.values())) >= 2:
            return "pass"
        return "partial"
    if all(l or c in eea for l, (n, c) in zip(local, providers)):
        return "partial"
    return "fail"


def hosting_status(providers: list[tuple[str, str]], selfs: set[str], eea: set[str]) -> str:
    """Networks of the endpoints; the organisation's own network counts as Swiss."""
    if not providers:
        return "n/a"
    local = [_local(n, c, selfs) for n, c in providers]
    if all(local):
        return "pass"
    if all(l or c in eea for l, (n, c) in zip(local, providers)):
        return "partial"
    return "fail"


def _share_status(flags: list[bool]) -> str:
    if not flags:
        return "n/a"
    if all(flags):
        return "pass"
    return "partial" if any(flags) else "fail"


def evaluate(r: dict, ctx: dict, cfg: dict) -> list[dict]:
    """All checks for one resource. `ctx` holds entity-level facts (name servers)."""
    eps = [e for e in r.get("endpoints") or [] if e.get("ok")]
    probed = bool(eps)
    out = []

    def add(cid, status, value, method, evidence=""):
        out.append({"check": cid, "category": CHECK_CATEGORY[cid], "status": status,
                    "value": value, "method": method, "evidence": evidence})

    # --- ownership visibility & protection ---------------------------------
    if probed:
        levels = [e["cert"]["validation"] for e in eps if e.get("cert")]
        add("own.identity", _share_status([lv in IDENTITY_LEVELS for lv in levels]),
            "/".join(sorted(set(levels))), "tls", f"{len(levels)} endpoints")
    else:
        lv = r.get("validation", "unknown")
        add("own.identity", "n/a" if lv == "unknown" else ("pass" if lv in IDENTITY_LEVELS else "fail"),
            lv, "ct", "certificate from Certificate Transparency")
    revs = [e.get("revocation", {}).get("status") for e in eps if e.get("cert")]
    if not revs:
        add("own.revocation", "n/a", "", "none", "needs live probe")
    elif "revoked" in revs:
        add("own.revocation", "fail", "revoked", "ocsp/crl")
    elif all(s == "good" for s in revs):
        methods = sorted({e["revocation"].get("method", "") for e in eps if e.get("revocation")})
        urls = sorted({e["revocation"].get("url", "") for e in eps if e.get("revocation", {}).get("url")})
        add("own.revocation", "pass", "good", "/".join(methods), " ".join(urls))
    else:
        add("own.revocation", "n/a", "unknown", "ocsp/crl", "no responder or CRL reachable")
    add("own.dnssec", "pass" if r.get("dnssec") else "fail", bool(r.get("dnssec")), "dns-ad")
    add("own.caa", "pass" if r.get("caa_found_at") else "fail",
        ", ".join(r.get("caa_issue") or []), "dns-caa", r.get("caa_found_at") or "no CAA record up to the entity domain")
    if probed:
        counts = [len(e.get("scts") or []) for e in eps if e.get("cert")]
        mn = min(counts) if counts else 0
        st = "pass" if mn >= cfg.get("min_scts", 2) else ("partial" if mn >= 1 else "fail")
        add("own.ct", st, mn, "tls-sct")
    else:
        add("own.ct", "n/a", "", "none", "needs live probe")
    st_txt = ctx.get("sectxt")
    if st_txt is None:
        add("own.sectxt", "n/a", "", "none", "not checked")
    else:
        sv = st_txt.get("status", "none")
        add("own.sectxt", {"valid": "pass", "expired": "partial", "no_expires": "partial"}.get(sv, "fail"),
            sv + (" (expires " + st_txt.get("expires", "")[:10] + ")" if st_txt.get("expires") else ""),
            "https-security-txt", st_txt.get("url", ""))

    # --- technology sovereignty ----------------------------------------------
    rz = r.get("root_zone") or "unknown"
    add("sov.ca", "n/a" if rz == "unknown" else {"ch": "pass", "eea": "partial"}.get(rz, "fail"),
        f"{r.get('root_owner', '')} ({r.get('root_country', '')})", "ccadb-root", r.get("root_name", ""))
    eea = set(cfg.get("eea_countries") or [])
    selfs = set(ctx.get("self") or [])
    ns_txt = ", ".join(ctx.get("ns_providers") or [])
    add("sov.dns", dns_status(parse_providers(ns_txt), selfs, eea), ns_txt, "dns-ns-asn", ctx.get("ns_domain", ""))
    reg = ctx.get("registrar")
    if not reg or not reg.get("country"):
        add("sov.registrar", "n/a", (reg or {}).get("name", "") or "", "rdap", (reg or {}).get("error", "") or "registrar country unknown")
    else:
        cc = reg["country"]
        add("sov.registrar", "pass" if cc == "CH" else ("partial" if cc in eea else "fail"),
            f"{reg.get('name', '')} ({cc})", "rdap", reg.get("url", ""))
    host_txt = ", ".join(sorted(set(r.get("hosting_as") or [])))
    add("sov.hosting", hosting_status(parse_providers(host_txt), selfs, eea), host_txt, "asn")
    tld = r.get("tld", "")
    add("sov.tld", "pass" if tld in cfg.get("swiss_tlds", ["ch", "swiss"]) else "fail", tld, "name")

    # --- connection security ---------------------------------------------------
    if probed:
        add("sec.tls13", _share_status([e.get("tls_version") == "TLSv1.3" for e in eps]),
            "/".join(sorted({e.get("tls_version", "") for e in eps})), "tls")
        pq = [e.get("pq") for e in eps if e.get("pq") and e.get("pq") != "untested"]
        if not pq:
            add("sec.pqc", "n/a", "", "none", "PQ test not available on probe host")
        elif all(p == "preferred" for p in pq):
            add("sec.pqc", "pass", "preferred", "tls-groups")
        elif any(p in ("preferred", "enabled") for p in pq):
            add("sec.pqc", "partial", "/".join(sorted(set(pq))), "tls-groups")
        else:
            add("sec.pqc", "fail", "no", "tls-groups")
    else:
        add("sec.tls13", "n/a", "", "none", "needs live probe")
        add("sec.pqc", "n/a", "", "none", "needs live probe")
    hs = r.get("http_sec")
    if not hs or ("hsts" not in hs and hs.get("http_status", "x") == "x"):
        add("sec.hsts", "n/a", "", "none", "needs live probe")
    else:
        min_age = cfg.get("hsts_min_age", 15552000)
        hsts_ok = (hs.get("hsts") or 0) >= min_age
        no_plain = hs.get("http_redirect_https") is True or hs.get("http_status") is None
        st = "pass" if hsts_ok and no_plain else ("partial" if hsts_ok or no_plain else "fail")
        val = ("HSTS max-age " + str(hs["hsts"]) if hs.get("hsts") is not None else "no HSTS") + " · " + (
            "port 80 closed" if hs.get("http_status") is None else
            ("HTTP → HTTPS" if hs.get("http_redirect_https") else f"HTTP {hs.get('http_status')} without redirect"))
        add("sec.hsts", st, val, "http-hsts", "preload" if hs.get("hsts_preload") else "")

    # --- connection privacy ----------------------------------------------------
    ech = r.get("ech", "none")
    add("prv.ech", "pass" if ech == "valid" else "fail", ech, "dns-https")
    return out


def knockout(r: dict) -> str:
    """Conditions that put a resource to zero regardless of other checks."""
    for e in r.get("endpoints") or []:
        err = e.get("verify_error") or ""
        # A missing intermediate is a server misconfiguration that most browsers
        # repair on their own (AIA fetching, cached intermediates); it is
        # reported per endpoint but not treated as a knock-out.
        if e.get("ok") and e.get("valid") is False and "unable to get local issuer certificate" not in err:
            return "invalid certificate: " + err[:80]
        if (e.get("revocation") or {}).get("status") == "revoked":
            return "revoked certificate"
    return ""


def score(results: list[dict], cfg: dict) -> dict:
    """Category and overall scores (0-100) for one resource."""
    pts, w = cfg["points"], cfg["checks"]
    cats = {}
    for c in CATEGORIES:
        rows = [x for x in results if x["category"] == c and x["status"] != "n/a"]
        tw = sum(w.get(x["check"], 1) for x in rows)
        cats[c] = round(100 * sum(w.get(x["check"], 1) * pts[x["status"]] for x in rows) / tw) if tw else None
    cw = cfg["category_weights"]
    assessed = [c for c in CATEGORIES if cats[c] is not None]
    tw = sum(cw[c] for c in assessed)
    overall = round(sum(cw[c] * cats[c] for c in assessed) / tw) if tw else None
    return {"categories": cats, "overall": overall}


def light(v: float | None, cfg: dict) -> str:
    if v is None:
        return "none"
    return "green" if v >= cfg["green"] else ("yellow" if v >= cfg["yellow"] else "red")


def aggregate(resources: list[dict], cfg: dict) -> dict:
    """Entity rating: weighted mean over resources (critical ones count more)."""
    if not resources:
        return {"overall": None, "categories": {c: None for c in CATEGORIES}, "lights": {},
                "checks": {}, "resources": 0, "knockouts": 0, "distribution": {}, "eligible": False}
    cw = cfg.get("critical_resource_weight", 3)

    def wmean(key_fn):
        vals = [(cw if r["critical"] else 1, key_fn(r)) for r in resources if key_fn(r) is not None]
        tw = sum(a for a, _ in vals)
        return round(sum(a * v for a, v in vals) / tw) if tw else None

    cats = {c: wmean(lambda r, c=c: r["tm"]["categories"][c]) for c in CATEGORIES}
    overall = wmean(lambda r: r["tm"]["overall"])
    checks = {}
    for cid in CHECK_CATEGORY:
        rows = [x for r in resources for x in r["tm_checks"] if x["check"] == cid and x["status"] != "n/a"]
        if rows:
            checks[cid] = {"pass": sum(1 for x in rows if x["status"] == "pass"),
                           "partial": sum(1 for x in rows if x["status"] == "partial"),
                           "fail": sum(1 for x in rows if x["status"] == "fail"), "assessed": len(rows)}
    dist = {"green": 0, "yellow": 0, "red": 0, "none": 0}
    for r in resources:
        dist[light(r["tm"]["overall"], cfg)] += 1
    kos = sum(1 for r in resources if r.get("posture_knockout"))
    lights = {c: light(cats[c], cfg) for c in CATEGORIES}
    lights["overall"] = light(overall, cfg)
    eligible = kos == 0 and all(lights[c] == "green" for c in CATEGORIES)
    return {"overall": overall, "categories": cats, "lights": lights, "checks": checks,
            "resources": len(resources), "knockouts": kos, "distribution": dist, "eligible": eligible}

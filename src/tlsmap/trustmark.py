"""TrustMark CH rating (draft v0.1, documented in docs/RATING.md).

A *resource* is a hostname in use (it resolves in public DNS). Each resource
gets twelve checks in four categories; check results become category scores,
and category scores a weighted overall score. Resources are then aggregated
per canton or municipality, with critical resources counting more.
"""

from __future__ import annotations

CATEGORIES = ["ownership", "sovereignty", "security", "privacy"]
CHECK_CATEGORY = {
    "own.identity": "ownership", "own.revocation": "ownership", "own.dnssec": "ownership",
    "own.caa": "ownership", "own.ct": "ownership",
    "sov.ca": "sovereignty", "sov.dns": "sovereignty", "sov.hosting": "sovereignty", "sov.tld": "sovereignty",
    "sec.tls13": "security", "sec.pqc": "security",
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

    # --- technology sovereignty ----------------------------------------------
    rz = r.get("root_zone") or "unknown"
    add("sov.ca", "n/a" if rz == "unknown" else {"ch": "pass", "eea": "partial"}.get(rz, "fail"),
        f"{r.get('root_owner', '')} ({r.get('root_country', '')})", "ccadb-root", r.get("root_name", ""))
    ns_zones = ctx.get("ns_zones") or []
    add("sov.dns", _zone_status(ns_zones), ", ".join(ctx.get("ns_providers") or []), "dns-ns-asn",
        ctx.get("ns_domain", ""))
    host_zones = r.get("hosting_zones") or []
    add("sov.hosting", _zone_status(host_zones), ", ".join(sorted(set(r.get("hosting_as") or []))), "asn")
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
    kos = sum(1 for r in resources if r.get("tm_knockout"))
    lights = {c: light(cats[c], cfg) for c in CATEGORIES}
    lights["overall"] = light(overall, cfg)
    eligible = kos == 0 and all(lights[c] == "green" for c in CATEGORIES)
    return {"overall": overall, "categories": cats, "lights": lights, "checks": checks,
            "resources": len(resources), "knockouts": kos, "distribution": dist, "eligible": eligible}

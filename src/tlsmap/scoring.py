"""Per-entity metrics, scores and good-practice checks.

Everything here works on the hostname table produced by the pipeline, so the
numbers can be recomputed from the published hostnames.csv.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime, timezone


def compile_critical(patterns: list[str]) -> list[re.Pattern]:
    return [re.compile(p, re.I) for p in patterns]


def is_critical(hostname: str, entity_domains: list[str], patterns: list[re.Pattern]) -> bool:
    name = hostname[2:] if hostname.startswith("*.") else hostname
    base = next((d for d in entity_domains if name == d or name.endswith("." + d)), "")
    sub = name[: -len(base) - 1] if base and name != base else ""
    labels = [lbl for lbl in sub.split(".") if lbl]
    return any(p.search(lbl) for lbl in labels for p in patterns)


def _share(n: int, total: int) -> float:
    return round(n / total, 4) if total else 0.0


def score_entity(hosts: list[dict], caa: dict | None, settings: dict, now: datetime | None = None,
                 ct_lag_days: float | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    sc = settings["scoring"]
    zw, vw, th = sc["zone_weights"], sc["validation_weights"], sc["thresholds"]
    used = [h for h in hosts if h["in_use"]]
    n = len(used)
    crit = [h for h in used if h["critical"]]

    def weighted(rows, key, weights):
        return round(100 * sum(weights.get(r[key], 0.0) for r in rows) / len(rows)) if rows else None

    zones = Counter(h["zone"] for h in used)
    vals = Counter(h["validation"] for h in used)
    cas = Counter((h["ca_id"], h["ca_name"], h["control_country"], h["zone"]) for h in used)
    by_ca = [{"ca_id": k[0], "name": k[1], "control_country": k[2], "zone": k[3], "hosts": v}
             for k, v in cas.most_common()]
    top = by_ca[0] if by_ca else None

    automated = [h for h in used if h.get("validity_days") is not None
                 and h["validity_days"] <= th["automated_max_validity_days"]]
    expiring = [h for h in used if h.get("days_left") is not None and h["days_left"] <= th["expiring_soon_days"]]
    keyed = [h for h in used if h.get("key_type")]
    weak = [h for h in keyed if (h["key_type"] == "RSA" and (h.get("key_bits") or 0) < th["min_rsa_bits"])
            or (h.get("signature_hash") or "").lower() in ("sha1", "md5")]
    platform = Counter(h["platform"] for h in used if h.get("platform"))
    net = Counter(h["net_country"] for h in used if h.get("net_country"))
    multi_ca = [h for h in used if h.get("other_issuers")]

    checks = []

    def check(cid, label, ok, detail, applicable=True):
        checks.append({"id": cid, "label": label,
                       "status": ("pass" if ok else "fail") if applicable else "n/a", "detail": detail})

    if caa is not None:
        issue_ids = caa.get("issue_ca_ids", [])
        check("caa_present", "CAA record limits which CAs may issue", bool(caa.get("records")),
              ", ".join(caa.get("issue", [])) or "no CAA record")
        check("caa_swiss_only", "CAA allows only Swiss CAs",
              bool(issue_ids) and all(z == "ch" for z in caa.get("issue_zones", [])),
              ", ".join(issue_ids) or "-", applicable=bool(caa.get("records")))
    check("critical_identity_validated", "Critical services use OV/EV certificates",
          all(h["validation"] in ("OV", "EV", "IV") for h in crit),
          f"{sum(1 for h in crit if h['validation'] in ('OV','EV','IV'))}/{len(crit)} critical hostnames",
          applicable=bool(crit))
    foreign_conc = bool(top and n >= 5 and top["hosts"] / n > th["concentration_flag_share"] and top["zone"] != "ch")
    check("no_foreign_concentration", "No single foreign CA above the concentration threshold",
          not foreign_conc, f"{top['name']} {round(100*top['hosts']/n)}%" if top else "-", applicable=n > 0)
    # Only meaningful when the CT source is current: a lagging source misses
    # renewals and makes valid hostnames look like they are about to expire.
    fresh = ct_lag_days is None or ct_lag_days <= th.get("max_ct_lag_days", 7) or any(h.get("validation_basis") == "served" for h in used)
    check("no_expiring", "No certificate expiring without renewal",
          not expiring,
          f"{len(expiring)} hostnames within {th['expiring_soon_days']} days" if fresh
          else f"not assessed: CT source lags {ct_lag_days:.0f} days", applicable=n > 0 and fresh)
    check("no_weak_crypto", "No weak keys or SHA-1 signatures",
          not weak, f"{len(weak)} of {len(keyed)} checked", applicable=bool(keyed))

    return {
        "hosts_found": len(hosts),
        "hosts_in_use": n,
        "hosts_not_in_dns": sum(1 for h in hosts if not h["in_use"] and not h.get("excluded")),
        "hosts_excluded": sum(1 for h in hosts if h.get("excluded")),
        "critical_in_use": len(crit),
        "sovereignty_score": weighted(used, "zone", zw),
        "critical_sovereignty_score": weighted(crit, "zone", zw),
        "assurance_score": weighted(used, "validation", vw),
        "critical_assurance_score": weighted(crit, "validation", vw),
        "zone_shares": {z: _share(zones.get(z, 0), n) for z in ("ch", "eea", "third", "unknown")},
        "validation_counts": {v: vals.get(v, 0) for v in ("DV", "OV", "IV", "EV", "unknown")},
        "by_ca": by_ca,
        "top_ca_share": _share(top["hosts"], n) if top else 0.0,
        "automated_share": _share(len(automated), n),
        "expiring_soon": len(expiring),
        "weak_crypto": len(weak),
        "crypto_coverage": _share(len(keyed), n),
        "multi_ca_hosts": len(multi_ca),
        "platforms": dict(platform.most_common()),
        "network_countries": dict(net.most_common()),
        "checks": checks,
    }

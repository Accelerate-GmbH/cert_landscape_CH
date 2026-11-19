"""Combine partial runs and link listed hosts to administrations.

A full run is split into batches (one per canton, one for the critical
services list) so that each fits into a CI job. Each batch writes its raw
result; `merge` combines them and writes the usual outputs.

Hosts on the critical-services list that belong to a canton or municipality
(for example www.zh.ch) are measured once: the organisation row takes the
administration's measurement and keeps its own list attributes (sector,
service type, criticality, confidence). It is marked `linked_to`.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from . import posture

LIST_FIELDS = ("entity", "entity_name", "critical", "service_type", "sector", "subsector",
               "reason", "source_url", "confidence")


def save_raw(result: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, default=str)


def load_raw(path: Path) -> dict:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def combine(parts: list[dict]) -> dict:
    out: dict = {"entities": [], "hostnames": [], "discovery": [], "checklog": []}
    seen = set()
    for p in parts:
        for e in p["entities"]:
            if e["key"] not in seen:           # cantons may appear in several batches
                seen.add(e["key"])
                out["entities"].append(e)
        keys = {e["key"] for e in p["entities"]}
        have = {(r["entity"], r["hostname"]) for r in out["hostnames"]}
        out["hostnames"] += [r for r in p["hostnames"] if r["entity"] in keys and (r["entity"], r["hostname"]) not in have]
        out["discovery"] += p.get("discovery", [])
        out["checklog"] += p.get("checklog", [])
    first = parts[0]
    out["generated"] = max(p["generated"] for p in parts)
    lags = [p.get("ct_lag_days") for p in parts if p.get("ct_lag_days") is not None]
    out["ct_lag_days"] = max(lags) if lags else None
    for k in ("ccadb_fetched", "tm_cfg", "probe_caps", "probe"):
        out[k] = next((p.get(k) for p in parts if p.get(k)), first.get(k))
    out["http_stats"] = {k: sum(p.get("http_stats", {}).get(k, 0) for p in parts)
                         for k in ("requests", "cache_hits", "errors")}
    return out


def link_admin_hosts(result: dict) -> int:
    """Organisation rows for hosts an administration already measured take that measurement."""
    admin = {r["hostname"]: r for r in result["hostnames"]
             if not r["entity"].startswith("organisation:") and r.get("tm")}
    linked = {}
    for r in result["hostnames"]:
        if r["entity"].startswith("organisation:") and r["hostname"] in admin:
            a = admin[r["hostname"]]
            own = {k: r.get(k) for k in LIST_FIELDS}
            r.clear()
            r.update(json.loads(json.dumps(a, default=str)))
            r.update(own)
            r["linked_to"] = a["entity"]
            linked[(own["entity"], r["hostname"])] = a["entity"]
    if linked:
        log = [x for x in result.get("checklog", []) if (x["entity"], x["hostname"]) not in linked]
        for (org, host), adm in linked.items():
            log += [{**x, "entity": org, "linked_to": adm} for x in result.get("checklog", [])
                     if x["entity"] == adm and x["hostname"] == host]
        result["checklog"] = log
        cfg = result.get("tm_cfg")
        if cfg:
            for e in result["entities"]:
                if e["kind"] == "organisation":
                    rows = [r for r in result["hostnames"] if r["entity"] == e["key"] and r.get("tm")]
                    e["posture"] = posture.aggregate(rows, cfg)
    return len(linked)


def apply_list_visibility(result: dict, list_path) -> int:
    """Take the visibility of organisations from the current list, so a change
    in the list applies at the next merge without rating the hosts again."""
    from pathlib import Path
    from .config import load_organisations
    p = Path(list_path)
    if not p.exists():
        return 0
    vis = {f"organisation:{o.id}": o.visibility for o in load_organisations(p)}
    changed = 0
    for e in result["entities"]:
        v = vis.get(e["key"])
        if e["kind"] == "organisation" and v and e.get("visibility") != v:
            e["visibility"] = v
            changed += 1
    return changed


def current_cfg(result: dict) -> dict:
    """Rating configuration from the current settings, so changed weights or
    rules apply at the next merge without measuring again."""
    from .config import load_settings
    from .registry import Registry
    cfg = {**load_settings()["trust_posture"], "eea_countries": sorted(Registry().eea)}
    result["tm_cfg"] = cfg
    return cfg


def reapply_sovereignty(result: dict) -> int:
    """Re-rate the name-server and hosting checks from the stored measurements
    with the current rule, then the scores of every resource and entity. Lets
    a rule change apply at the next merge without measuring again."""
    cfg = current_cfg(result)
    eea = set(cfg["eea_countries"])
    selfs = {e["key"]: posture.self_tokens(e["name"], e.get("domains") or []) for e in result["entities"]}
    changed: dict[tuple, dict] = {}
    for r in result["hostnames"]:
        checks = r.get("tm_checks")
        if not checks:
            continue
        st = selfs.get(r["entity"], set())
        for x in checks:
            if x["check"] == "sov.dns":
                new = posture.dns_status(posture.parse_providers(x.get("value") or ""), st, eea)
            elif x["check"] == "sov.hosting":
                new = posture.hosting_status(posture.parse_providers(x.get("value") or ""), st, eea)
            else:
                continue
            if new != x["status"]:
                x["status"] = new
                changed[(r["entity"], r["hostname"], x["check"])] = new
        # every resource is scored again with the current weights
        sc = posture.score(checks, cfg)
        if r.get("posture_knockout"):
            sc["overall"] = 0
        r["tm"] = sc
    for x in result.get("checklog", []):
        k = (x["entity"], x["hostname"], x["check"])
        if k in changed:
            x["status"] = changed[k]
    if True:
        by_entity: dict[str, list] = {}
        for r in result["hostnames"]:
            if r.get("tm"):
                by_entity.setdefault(r["entity"], []).append(r)
        for e in result["entities"]:
            e["posture"] = posture.aggregate(by_entity.get(e["key"], []), cfg)
    return len(changed)

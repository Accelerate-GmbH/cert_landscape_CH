"""Write results: full JSON, CSVs, Excel workbook, map-compatible JSON."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .registry import Registry

HOST_COLUMNS = [
    "entity", "entity_name", "hostname", "wildcard", "critical", "in_use", "excluded", "dns_state",
    "ca_id", "ca_name", "ca_owner", "attribution", "issuer_org", "issuer_cn", "operator_country",
    "control_country", "zone", "validation", "validation_basis", "not_before", "not_after", "validity_days",
    "days_left", "key_type", "key_bits", "signature_hash", "subject_org", "platform", "cnames", "ip",
    "asn", "as_name", "net_country", "ips", "hosting_as", "tld", "dnssec", "caa_found_at", "caa_issue", "ech",
    "root_name", "root_owner", "root_country", "root_zone", "endpoints_consistent",
    "posture_overall", "posture_ownership", "posture_sovereignty", "posture_security", "posture_privacy", "posture_knockout", "other_issuers", "valid_cert_count", "source", "cert_id",
    "cert_sha256", "probe_ok", "probe_verified", "probe_tls_version", "served_issuer_org",
    "served_matches_ct", "probe_error",
]

ENTITY_COLUMNS = [
    "key", "kind", "id", "name", "code", "domains", "shared_domain", "hosts_found", "hosts_in_use", "hosts_not_in_dns",
    "critical_in_use", "sovereignty_score", "critical_sovereignty_score", "assurance_score",
    "critical_assurance_score", "share_ch", "share_eea", "share_third", "share_unknown",
    "DV", "OV", "IV", "EV", "unknown_validation", "top_ca", "top_ca_share", "automated_share",
    "expiring_soon", "weak_crypto", "crypto_coverage", "multi_ca_hosts", "caa", "checks_passed",
    "checks_failed", "posture_overall", "posture_ownership", "posture_sovereignty", "posture_security", "posture_privacy",
    "posture_light", "posture_eligible", "posture_resources", "posture_knockouts", "dnssec_signed", "dns_providers",
    "ct_source", "ct_newest_entry",
]

ENDPOINT_COLUMNS = ["entity", "hostname", "ip", "family", "checked_at", "ok", "valid", "verify_error", "error",
                    "tls_version", "cipher", "group", "pq", "validation", "issuer_org", "issuer_cn", "not_after",
                    "key_type", "key_bits", "scts", "revocation", "revocation_method", "cert_sha256"]

ZONE_COMPAT = {"ch": 1, "eea": 2, "third": 3, "unknown": 3}


def _flat(v):
    if isinstance(v, (list, tuple)):
        return "; ".join(str(x) for x in v)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return "" if v is None else v


def resource_entry(r: dict) -> dict:
    """Everything the map needs to drill down from a score to its evidence."""
    eps = []
    host_by_ip = {h["ip"]: h for h in r.get("hosting") or []}
    for e in r.get("endpoints") or []:
        c, rv = e.get("cert") or {}, e.get("revocation") or {}
        hb = host_by_ip.get(e.get("ip"), {})
        eps.append({"ip": e.get("ip"), "at": e.get("checked_at"), "ok": e.get("ok"), "valid": e.get("valid"),
                    "err": e.get("verify_error") or e.get("error") or "", "tls": e.get("tls_version", ""),
                    "grp": e.get("group", ""), "pq": e.get("pq", ""), "val": c.get("validation", ""),
                    "iss": c.get("issuer_cn", ""), "sha": c.get("sha256", ""), "exp": c.get("not_after", ""),
                    "scts": len(e.get("scts") or []), "rev": rv.get("status", ""), "revm": rv.get("method", ""),
                    "revu": rv.get("url", ""), "asn": hb.get("asn", ""), "as": hb.get("as_name", ""), "cc": hb.get("country", "")})
    probed = {e["ip"] for e in eps}
    for h in r.get("hosting") or []:
        if h["ip"] not in probed:
            eps.append({"ip": h["ip"], "asn": h["asn"], "as": h["as_name"], "cc": h["country"], "ok": None})
    tm = r.get("tm") or {}
    return {
        "h": r["hostname"], "crit": r.get("critical", False), "o": tm.get("overall"), "c": tm.get("categories"),
        "ko": r.get("posture_knockout", ""),
        "cert": {"src": r.get("source", ""), "id": r.get("cert_id", ""), "sha": r.get("cert_sha256") or "",
                 "iss": r.get("issuer_cn", ""), "org": r.get("issuer_org", ""), "val": r.get("validation", ""),
                 "basis": r.get("validation_basis", ""), "exp": r.get("not_after", "")},
        "root": {"name": r.get("root_name", ""), "owner": r.get("root_owner", ""), "cc": r.get("root_country", "")},
        "caa": r.get("caa_found_at") or "", "ech": r.get("ech", ""), "plat": r.get("platform", ""),
        "chk": [[x["check"], x["status"], x["value"], x["method"], x["evidence"]] for x in r.get("tm_checks", [])],
        "ep": eps,
    }


def host_row(r: dict) -> dict:
    tm = r.get("tm") or {}
    cats = tm.get("categories") or {}
    row = {k: r.get(k) for k in HOST_COLUMNS}
    row.update({"posture_overall": tm.get("overall"), "posture_knockout": r.get("posture_knockout", ""),
                **{f"posture_{c}": cats.get(c) for c in ("ownership", "sovereignty", "security", "privacy")}})
    return row


def entity_row(e: dict) -> dict:
    caa_txt = "; ".join(f"{d}: {', '.join(c.get('issue') or []) or 'none'}" for d, c in e.get("caa", {}).items())
    disc = e.get("discovery", [])
    tm = e.get("posture") or {}
    cats = tm.get("categories") or {}
    zone = e.get("zone") or {}
    return {
        "posture_overall": tm.get("overall"), **{f"posture_{c}": cats.get(c) for c in ("ownership", "sovereignty", "security", "privacy")},
        "posture_light": (tm.get("lights") or {}).get("overall", ""), "posture_eligible": tm.get("eligible", False),
        "posture_resources": tm.get("resources", 0), "posture_knockouts": tm.get("knockouts", 0),
        "dnssec_signed": "; ".join(f"{d}: {'yes' if z.get('dnssec_signed') else 'no'}" for d, z in zone.items()),
        "dns_providers": "; ".join(sorted({f"{p['as_name']} ({p['country']})" for z in zone.values() for p in z.get("providers", [])})),
        "key": e["key"], "kind": e["kind"], "id": e["id"], "name": e["name"], "code": e.get("code", ""),
        "domains": "; ".join(e["domains"]), "shared_domain": e.get("shared_domain", False), "hosts_found": e["hosts_found"], "hosts_in_use": e["hosts_in_use"],
        "hosts_not_in_dns": e["hosts_not_in_dns"], "critical_in_use": e["critical_in_use"],
        "sovereignty_score": e["sovereignty_score"], "critical_sovereignty_score": e["critical_sovereignty_score"],
        "assurance_score": e["assurance_score"], "critical_assurance_score": e["critical_assurance_score"],
        **{f"share_{z}": e["zone_shares"][z] for z in ("ch", "eea", "third", "unknown")},
        **{k: e["validation_counts"][k] for k in ("DV", "OV", "IV", "EV")},
        "unknown_validation": e["validation_counts"]["unknown"],
        "top_ca": e["by_ca"][0]["name"] if e["by_ca"] else "", "top_ca_share": e["top_ca_share"],
        "automated_share": e["automated_share"], "expiring_soon": e["expiring_soon"],
        "weak_crypto": e["weak_crypto"], "crypto_coverage": e["crypto_coverage"],
        "multi_ca_hosts": e["multi_ca_hosts"], "caa": caa_txt,
        "checks_passed": sum(1 for c in e["checks"] if c["status"] == "pass"),
        "checks_failed": sum(1 for c in e["checks"] if c["status"] == "fail"),
        "ct_source": "; ".join(sorted({d["source"] for d in disc})),
        "ct_newest_entry": max((d["newest_not_before"] or "" for d in disc), default=""),
    }


def compat_entry(e: dict) -> dict:
    """Same shape as sslmap's data.min.json, counted per hostname in use."""
    n = e["hosts_in_use"]
    vc = e["validation_counts"]
    def nz(x):  # the existing frontends treat 0 as "no data"
        return max(1, x) if (n and x is not None) else 0
    return {
        "name": e["name"], **({"code": e["code"]} if e["kind"] == "canton" else {}),
        **({"bfs": e["id"], "canton": e["canton"]} if e["kind"] == "municipality" else {}),
        "domain": e["domains"][0] if e["domains"] else "",
        "certificates": {
            "count": n, "dvCount": vc["DV"], "ovCount": vc["OV"] + vc["IV"], "evCount": vc["EV"],
            "issuers": [{"name": c["name"], "count": c["hosts"], "country": c["control_country"],
                         "zone": ZONE_COMPAT.get(c["zone"], 3)} for c in e["by_ca"]],
        },
        "score": nz(e["sovereignty_score"]), "trustScore": nz(e["assurance_score"]),
    }


def _tm_compact(tm: dict) -> dict:
    if not tm:
        return {}
    return {"o": tm.get("overall"), "c": tm.get("categories"), "l": tm.get("lights"), "k": tm.get("checks"),
            "n": tm.get("resources"), "ko": tm.get("knockouts"), "d": tm.get("distribution"), "el": tm.get("eligible")}


def _stack(e: dict) -> dict:
    """Sovereignty stack of the entity: TLD, DNS, hosting, issuing CA, root CA."""
    zone = e.get("zone") or {}
    dns = sorted({(p["as_name"] or p["ns"], p["country"]) for z in zone.values() for p in z.get("providers", [])})
    tlds = sorted({d.rsplit(".", 1)[-1] for d in e.get("domains", [])})
    return {"tld": tlds, "dns": [list(x) for x in dns[:4]],
            "host": [[k, v] for k, v in list((e.get("network_countries") or {}).items())[:4]],
            "ca": [[c["name"], c["control_country"], c["hosts"]] for c in e.get("by_ca", [])[:4]],
            "root": [[k, v] for k, v in list((e.get("root_countries") or {}).items())[:4]],
            "dnssec": any(z.get("dnssec_signed") for z in zone.values())}


def _bfs_lookup() -> dict:
    """(place name, canton code) -> BFS number, from the municipality list."""
    from .config import CONFIG_DIR, DATA_DIR
    import tomllib
    code_of = {c["name"]: c["code"] for c in tomllib.load((CONFIG_DIR / "entities.toml").open("rb")).get("canton", [])}
    out = {}
    try:
        data = json.loads((DATA_DIR / "municipalities_ch.json").read_text())
    except FileNotFoundError:
        return out
    for m in data["municipalities"]:
        name = m["name"].lower()
        base = name.split(" (")[0]
        cc = code_of.get(m.get("region", ""), "")
        for n in {name, base}:
            out[(n, cc)] = str(m["code"])
            out.setdefault((n, ""), str(m["code"]))
    return out


DIMENSIONS = ("sektor", "teilsektor", "service_typ", "kanton")
BENCH = {"canton": "@Kantone", "municipality": "@Gemeinden", "federal": "@Bund"}


def _group_key(dim: str, r: dict, e: dict) -> str:
    if dim == "sektor":
        return r.get("sector") or e.get("sector") or "–"
    if dim == "teilsektor":
        sec = r.get("sector") or e.get("sector") or "–"
        sub = r.get("subsector") or e.get("subsector") or "–"
        return f"{sec} / {sub}"
    if dim == "service_typ":
        return r.get("service_type") or "–"
    if dim == "kanton":
        return (e.get("place") or {}).get("kanton") or e.get("code") or "–"
    return "–"


def sector_json(result: dict, dim: str = "sektor") -> dict:
    """Aggregates of the critical-services list along one dimension, split into
    critical and other services, with administrations as benchmark rows."""
    from . import posture
    from .config import load_settings
    cfg = result.get("tm_cfg") or load_settings().raw["trust_posture"]
    ents = {e["key"]: e for e in result["entities"]}
    groups: dict[tuple, list] = {}
    for r in result["hostnames"]:
        if not r.get("tm"):
            continue
        e = ents.get(r["entity"])
        if not e or (e["kind"] == "organisation" and e.get("visibility") == "intern"):
            continue
        key = _group_key(dim, r, e) if e["kind"] == "organisation" else BENCH[e["kind"]]
        groups.setdefault((key, "krit" if r["critical"] else "other"), []).append(r)
    out: dict[str, dict] = {}

    def pack(rows, weight):
        agg = posture.aggregate(rows, {**cfg, "critical_resource_weight": weight})
        conf = [x.get("confidence") for x in rows if x.get("confidence")]
        return {"o": agg["overall"], "c": agg["categories"], "k": agg["checks"], "n": agg["resources"],
                "d": agg["distribution"], "ko": agg["knockouts"],
                "tief": round(sum(1 for c in conf if c == "tief") / len(conf), 3) if conf else None}

    for (key, part), rows in groups.items():
        d = out.setdefault(key, {"orgs": set(), "hosts": 0, "linked": 0})
        d[part] = pack(rows, 1)
        d["hosts"] += len(rows)
        d["linked"] += sum(1 for r in rows if r.get("linked_to"))
        d["orgs"] |= {r["entity"] for r in rows}
    min_orgs = cfg.get("min_orgs_per_sector", 5)
    for key, d in out.items():
        rows = [r for (k2, _), rs in groups.items() if k2 == key for r in rs]
        d["all"] = pack(rows, cfg.get("critical_resource_weight", 3))
        d["orgs"] = len(d["orgs"])
        d["public"] = sum(1 for e in result["entities"] if e["kind"] == "organisation"
                          and e.get("visibility") == "oeffentlich" and e["key"] in {r["entity"] for r in rows})
        if not key.startswith("@") and d["orgs"] < min_orgs:
            for part in ("krit", "other", "all"):
                if part in d:
                    d[part] = {"n": d[part]["n"], "tief": d[part].get("tief"), "suppressed": True}
            d["suppressed"] = True
    return out


def map_json(result: dict, meta: dict) -> dict:
    """Compact per-entity data for the web map (web/)."""
    ents: dict[str, dict] = {"canton": {}, "municipality": {}, "federal": {}, "organisation": {}}
    bfs_of = _bfs_lookup()
    for e in result["entities"]:
        main = e["caa"].get(e["domains"][0]) if e["domains"] else None
        caa_state = None
        if main is not None:
            if not main.get("records"):
                caa_state = "none"
            elif main.get("issue_zones") and all(z == "ch" for z in main["issue_zones"]):
                caa_state = "swiss"
            else:
                caa_state = "other"
        checks = {c["id"]: c["status"] for c in e["checks"]}
        applicable = [s for s in checks.values() if s != "n/a"]
        ents[e["kind"]][e["id"]] = {
            "n": e["name"], "c": e.get("code", ""), "d": e["domains"], "sd": e.get("shared_domain", False),
            "hf": e["hosts_found"], "h": e["hosts_in_use"], "hc": e["critical_in_use"],
            "s": e["sovereignty_score"], "cs": e["critical_sovereignty_score"],
            "a": e["assurance_score"], "ca": e["critical_assurance_score"],
            "z": e["zone_shares"], "v": e["validation_counts"],
            "cas": [[c["name"], c["control_country"], c["zone"], c["hosts"]] for c in e["by_ca"]],
            "caa": caa_state, "caai": (main or {}).get("issue", []),
            "chk": checks,
            "gp": round(100 * sum(1 for s in applicable if s == "pass") / len(applicable)) if applicable else None,
            "auto": e["automated_share"], "plat": e["platforms"], "net": e["network_countries"],
            "tm": _tm_compact(e.get("posture") or {}),
            "stack": _stack(e),
        }
        if e["kind"] == "organisation":
            pl = e.get("place") or {}
            ents["organisation"][e["id"]].update({
                "sec": e.get("sector", ""), "sub": e.get("subsector", ""), "uid": e.get("uid", ""),
                "ort": pl.get("ort", ""), "kt": pl.get("kanton", ""),
                "bfs": bfs_of.get((pl.get("ort", "").lower(), pl.get("kanton", ""))) or bfs_of.get((pl.get("ort", "").lower(), "")),
            })
    return {"generated": result["generated"], "ct_lag_days": result.get("ct_lag_days"),
            "ccadb_fetched": result.get("ccadb_fetched"),
            "ct_sources": meta.get("ct_sources_used", {}), "entities": ents}


def is_public(e: dict) -> bool:
    return e["kind"] != "organisation" or e.get("visibility") == "oeffentlich"


def split_public(result: dict) -> dict:
    """The result restricted to what may be published: administrations and
    organisations marked 'oeffentlich'. Sector aggregates keep everything but
    'intern'."""
    pub_keys = {e["key"] for e in result["entities"] if is_public(e)}
    out = dict(result)
    out["entities"] = [e for e in result["entities"] if e["key"] in pub_keys]
    out["hostnames"] = [r for r in result["hostnames"] if r["entity"] in pub_keys]
    out["checklog"] = [x for x in result.get("checklog", []) if x["entity"] in pub_keys]
    return out


def write_all(result: dict, out_dir: Path, registry: Registry, run_meta: dict) -> dict[str, Path]:
    """Public files in out_dir; the complete set (all organisations) in out_dir/restricted."""
    from .merge import link_admin_hosts
    run_meta = dict(run_meta)
    run_meta["linked_hosts"] = link_admin_hosts(result)
    full = result
    has_restricted = any(not is_public(e) for e in full["entities"])
    paths = _write(split_public(full), out_dir, registry, run_meta, sectors_from=full)
    if has_restricted:
        _write(full, out_dir / "restricted", registry, run_meta, sectors_from=full)
    return paths


def _write(result: dict, out_dir: Path, registry: Registry, run_meta: dict, sectors_from: dict) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {}

    p = out_dir / "results.json"
    p.write_text(json.dumps({"meta": run_meta, **{k: v for k, v in result.items() if k not in ("hostnames", "checklog", "tm_cfg")}},
                            ensure_ascii=False, indent=1))
    paths["results"] = p

    p = out_dir / "hostnames.csv"
    with p.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=HOST_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in result["hostnames"]:
            w.writerow({k: _flat(v) for k, v in host_row(r).items()})
    paths["hostnames"] = p

    p = out_dir / "endpoints.csv"
    with p.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=ENDPOINT_COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in result["hostnames"]:
            for ep in r.get("endpoints") or []:
                c = ep.get("cert") or {}
                rv = ep.get("revocation") or {}
                w.writerow({k: _flat(v) for k, v in {
                    "entity": r["entity"], "hostname": r["hostname"], **{k: ep.get(k) for k in
                    ("ip", "family", "checked_at", "ok", "valid", "verify_error", "error", "tls_version", "cipher", "group", "pq")},
                    "validation": c.get("validation"), "issuer_org": c.get("issuer_org"), "issuer_cn": c.get("issuer_cn"),
                    "not_after": c.get("not_after"), "key_type": c.get("key_type"), "key_bits": c.get("key_bits"),
                    "scts": len(ep.get("scts") or []), "revocation": rv.get("status"), "revocation_method": rv.get("method"),
                    "cert_sha256": c.get("sha256")}.items()})
    paths["endpoints"] = p

    p = out_dir / "checks.jsonl"
    with p.open("w", encoding="utf-8") as fh:
        for x in result.get("checklog", []):
            fh.write(json.dumps(x, ensure_ascii=False, default=str) + "\n")
    paths["checklog"] = p

    ent_rows = [entity_row(e) for e in result["entities"]]
    p = out_dir / "entities.csv"
    with p.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=ENTITY_COLUMNS)
        w.writeheader()
        for r in ent_rows:
            w.writerow({k: _flat(r.get(k)) for k in ENTITY_COLUMNS})
    paths["entities"] = p

    compat = {"generated": result["generated"], "method": "tlsmap: hostnames in use, current certificate",
              "cantons": {}, "municipalities": {}, "federal": {}, "organisations": {}}
    for e in result["entities"]:
        bucket = {"canton": "cantons", "municipality": "municipalities", "federal": "federal",
                  "organisation": "organisations"}[e["kind"]]
        compat[bucket][e["id"]] = compat_entry(e)
    compat["totalCantons"] = len(compat["cantons"])
    compat["totalMunicipalities"] = len(compat["municipalities"])
    p = out_dir / "data.min.json"
    p.write_text(json.dumps(compat, ensure_ascii=False, separators=(",", ":")))
    paths["map"] = p

    p = out_dir / "map.json"
    mj = map_json(result, run_meta)
    mj["dims"] = {dim: sector_json(sectors_from, dim) for dim in DIMENSIONS}
    mj["sectors"] = mj["dims"]["sektor"]
    c = result.get("tm_cfg") or {}
    mj["cfg"] = {k: c.get(k) for k in ("category_weights", "checks", "points", "green", "yellow",
                                         "critical_resource_weight", "min_orgs_per_sector", "min_scts")}
    p.write_text(json.dumps(mj, ensure_ascii=False, separators=(",", ":")))
    paths["webmap"] = p

    rdir = out_dir / "resources"
    rdir.mkdir(exist_ok=True)
    by_entity: dict[str, list] = {}
    for r in result["hostnames"]:
        if r.get("tm"):
            by_entity.setdefault(r["entity"], []).append(resource_entry(r))
    for key, items in by_entity.items():
        items.sort(key=lambda x: (x["o"] if x["o"] is not None else -1))
        (rdir / (key.replace(":", "-") + ".json")).write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
    paths["resources"] = rdir

    # Search index for the map: hostnames of administrations, grouped by
    # entity. Organisations are left out unless public (aggregate-only rows
    # must not be findable by hostname).
    public_orgs = {e["key"] for e in result["entities"] if e["kind"] == "organisation" and is_public(e)}
    idx: dict[str, list] = {}
    for key, items in by_entity.items():
        if key.startswith("organisation:") and key not in public_orgs:
            continue
        idx[key] = sorted({x["h"] for x in items})
    p = out_dir / "search.json"
    p.write_text(json.dumps({"v": 1, "h": idx}, ensure_ascii=False, separators=(",", ":")))
    paths["search"] = p

    p = out_dir / "run.json"
    p.write_text(json.dumps(run_meta, ensure_ascii=False, indent=1))
    paths["run"] = p

    try:
        paths["xlsx"] = _xlsx(result, ent_rows, registry, run_meta, out_dir / "export.xlsx")
    except ImportError:
        pass
    return paths


def _xlsx(result, ent_rows, registry: Registry, meta, path: Path) -> Path:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head = Font(bold=True, color="FFFFFF")
    fill = PatternFill("solid", fgColor="1F2937")

    def sheet(ws, columns, rows):
        ws.append(columns)
        for c in ws[1]:
            c.font, c.fill = head, fill
        for r in rows:
            ws.append([_flat(r.get(k)) for k in columns])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        for i, col in enumerate(columns, 1):
            ws.column_dimensions[get_column_letter(i)].width = min(40, max(10, len(col) + 2))

    ws = wb.active
    ws.title = "Entities"
    sheet(ws, ENTITY_COLUMNS, ent_rows)

    checks = []
    for e in result["entities"]:
        for c in e["checks"]:
            checks.append({"entity": e["key"], "name": e["name"], **c})
    sheet(wb.create_sheet("Checks"), ["entity", "name", "id", "label", "status", "detail"], checks)
    sheet(wb.create_sheet("Hostnames"), HOST_COLUMNS, [host_row(r) for r in result["hostnames"]])
    sheet(wb.create_sheet("CA registry"),
          ["id", "name", "operator", "operator_country", "controller", "control_country", "zone",
           "validation", "sources", "notes"],
          [{**ca.__dict__, "sources": "; ".join(ca.sources)} for ca in registry.cas])
    ws = wb.create_sheet("Run")
    for k, v in meta.items():
        ws.append([k, _flat(v)])
    wb.save(path)
    return path

"""Command line: tlsmap run | diff | unknown-issuers."""

from __future__ import annotations

import argparse
import json
import logging
import platform
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .config import CONFIG_DIR, DATA_DIR, ROOT, file_sha256, load_entities, load_settings
from .export import write_all
from .pipeline import Pipeline
from .registry import Registry


def cmd_run(a) -> int:
    settings = load_settings(Path(a.settings) if a.settings else None)
    registry = Registry(Path(a.registry) if a.registry else None)
    kinds = [k.strip() for k in a.entities.split(",")]
    ents = load_entities(kinds, canton_filter=a.canton, hosts_path=a.hosts)
    if a.limit:
        ents = ents[: a.limit]
    if not ents:
        print("No entities selected.", file=sys.stderr)
        return 2
    started = datetime.now(timezone.utc)
    pipe = Pipeline(settings, registry, Path(a.cache), cert_detail=a.cert_detail, do_probe=a.probe)
    result = pipe.run(ents)
    if a.raw_out:
        from .merge import save_raw
        save_raw(result, Path(a.raw_out))
        print(f"raw result written to {a.raw_out}")
        return 0
    snapshot = started.strftime("%Y-%m-%d")
    out_dir = Path(a.out) / snapshot
    meta = {
        "tool": "tlsmap", "version": __version__, "started": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "finished": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "entities": dict(Counter(e.kind for e in ents)), "canton_filter": a.canton,
        "listed_hosts": sum(len(e.hosts) for e in ents),
        "ct_sources_used": dict(Counter(d["source"] for d in result["discovery"])),
        "ct_errors": sum(1 for d in result["discovery"] if d["error"]),
        "ct_lag_days": result.get("ct_lag_days"),
        "cert_detail": a.cert_detail, "probe": a.probe, "probe_note": result.get("probe"),
        "settings_sha256": file_sha256(settings.path), "registry_sha256": file_sha256(registry.path),
        "municipality_list_sha256": file_sha256(DATA_DIR / "municipalities_ch.json"),
        "ccadb_fetched": result.get("ccadb_fetched"),
        "python": platform.python_version(), "http": result["http_stats"],
    }
    paths = write_all(result, out_dir, registry, meta)
    latest = Path(a.out) / "latest"
    latest.mkdir(parents=True, exist_ok=True)
    import shutil
    for p in paths.values():
        if p.is_dir():
            shutil.rmtree(latest / p.name, ignore_errors=True)
            shutil.copytree(p, latest / p.name)
        else:
            (latest / p.name).write_bytes(p.read_bytes())
    print(json.dumps({k: str(v) for k, v in paths.items()}, indent=1))
    unknown = Counter(r["issuer_org"] for r in result["hostnames"] if r["ca_id"] == "unknown")
    if unknown:
        print("Issuers not in the CA registry (add them to config/ca_registry.toml):", file=sys.stderr)
        for org, n in unknown.most_common():
            print(f"  {n:6d}  {org or '(no O=)'}", file=sys.stderr)
    return 0


def cmd_merge(a) -> int:
    from .merge import apply_list_visibility, combine, load_raw, reapply_sovereignty
    parts = [load_raw(Path(p)) for p in a.raw]
    result = combine(parts)
    rerated = reapply_sovereignty(result)
    vis_changed = apply_list_visibility(result, a.list)
    registry = Registry()
    started = datetime.now(timezone.utc)
    snapshot = result["generated"][:10]
    meta = {
        "tool": "tlsmap", "version": __version__, "merged_at": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "batches": len(parts), "entities": dict(Counter(e["kind"] for e in result["entities"])),
        "ct_sources_used": dict(Counter(d["source"] for d in result["discovery"])),
        "ct_errors": sum(1 for d in result["discovery"] if d.get("error")),
        "ct_lag_days": result.get("ct_lag_days"), "ccadb_fetched": result.get("ccadb_fetched"),
        "probe_note": result.get("probe"), "settings_sha256": file_sha256(CONFIG_DIR / "settings.toml"),
        "registry_sha256": file_sha256(registry.path), "python": platform.python_version(),
        "http": result.get("http_stats"), "visibility_from_list": vis_changed, "sovereignty_rerated": rerated,
    }
    out_dir = Path(a.out) / snapshot
    paths = write_all(result, out_dir, registry, meta)
    import shutil
    latest = Path(a.out) / "latest"
    latest.mkdir(parents=True, exist_ok=True)
    for p in paths.values():
        if p.is_dir():
            shutil.rmtree(latest / p.name, ignore_errors=True)
            shutil.copytree(p, latest / p.name)
        else:
            (latest / p.name).write_bytes(p.read_bytes())
    print(json.dumps({k: str(v) for k, v in paths.items()}, indent=1))
    return 0


def cmd_verify_list(a) -> int:
    from .dnscheck import DoH
    from .http import Http
    from . import listcheck
    settings = load_settings()
    h = settings["http"]
    http = Http(Path(a.cache), h["user_agent"], h["timeout_seconds"], h["retries"], h.get("min_interval", {}))
    dns = DoH(http, settings["dns"]["doh"], 6)
    list_path = Path(a.list or (DATA_DIR / "critical_services" / "critical_services_ch.csv"))
    out = Path(a.out or (DATA_DIR / "critical_services" / "verification.json"))
    v = listcheck.run(list_path, out, dns)
    out.write_text(json.dumps(v, ensure_ascii=False, indent=1))
    out.with_suffix(".md").write_text(listcheck.report_md(v))
    print(json.dumps({k: (len(x) if isinstance(x, list) else x) for k, x in v["summary"].items()}, indent=1))
    return 0


def cmd_diff(a) -> int:
    old = {r["key"]: r for r in json.loads(Path(a.old).read_text())["entities"]}
    new = {r["key"]: r for r in json.loads(Path(a.new).read_text())["entities"]}
    print("key\tname\tsovereignty_old\tsovereignty_new\tassurance_old\tassurance_new\thosts_old\thosts_new")
    for k in sorted(set(old) | set(new)):
        o, n = old.get(k, {}), new.get(k, {})
        so, sn = o.get("sovereignty_score"), n.get("sovereignty_score")
        ao, an = o.get("assurance_score"), n.get("assurance_score")
        if a.changed_only and so == sn and ao == an:
            continue
        print("\t".join(str(x) for x in (k, (n or o).get("name"), so, sn, ao, an,
                                          o.get("hosts_in_use"), n.get("hosts_in_use"))))
    return 0


def cmd_unknown(a) -> int:
    import csv
    from .ccadb import CCADB
    reg = Registry(ccadb=CCADB.load(None, ROOT / ".cache" / "ccadb_index.json"))
    host_csv = Path(a.results).with_name("hostnames.csv")
    c = Counter()
    with host_csv.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if reg.match(r["issuer_org"], r["issuer_cn"]).id == "unknown":
                c[(r["issuer_org"], r["issuer_cn"])] += 1
    for (org, cn), n in c.most_common():
        print(f"{n:6d}  O={org}  CN={cn}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tlsmap", description=__doc__)
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("run", help="discover, classify, check DNS, score and export")
    r.add_argument("--entities", default="cantons,municipalities,organisations",
                   help="comma list of cantons, municipalities, organisations, federal")
    r.add_argument("--hosts", help="host list CSV for organisations (default data/hosts_ch.csv)")
    r.add_argument("--canton", help="only this canton and its municipalities (code, e.g. ZG)")
    r.add_argument("--limit", type=int, help="only the first N entities (testing)")
    r.add_argument("--cert-detail", choices=["none", "auto", "all"], default="auto",
                   help="download certificates: auto = only when DV/OV/EV can't be read from the issuer")
    r.add_argument("--probe", action="store_true", help="also connect to each hostname (live TLS)")
    r.add_argument("--out", default=str(ROOT / "output"))
    r.add_argument("--cache", default=str(ROOT / ".cache"))
    r.add_argument("--raw-out", help="write the raw result (json.gz) for a later merge instead of exporting")
    r.add_argument("--settings")
    r.add_argument("--registry")
    r.set_defaults(func=cmd_run)

    m = sub.add_parser("merge", help="combine raw batch results and write the outputs")
    m.add_argument("raw", nargs="+", help="raw result files (json.gz)")
    m.add_argument("--out", default=str(ROOT / "output"))
    m.add_argument("--list", default=str(ROOT / "data" / "critical_services" / "critical_services_ch.csv"),
                   help="host list whose visibility applies to the merged result")
    m.set_defaults(func=cmd_merge)

    v = sub.add_parser("verify-list", help="check that listed hosts still resolve, answer and are linked from their source")
    v.add_argument("--list")
    v.add_argument("--out")
    v.add_argument("--cache", default=str(ROOT / ".cache"))
    v.set_defaults(func=cmd_verify_list)

    d = sub.add_parser("diff", help="compare two results.json snapshots")
    d.add_argument("old")
    d.add_argument("new")
    d.add_argument("--changed-only", action="store_true")
    d.set_defaults(func=cmd_diff)

    u = sub.add_parser("unknown-issuers", help="list issuers missing from the CA registry")
    u.add_argument("results", help="path to results.json")
    u.set_defaults(func=cmd_unknown)

    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())

"""Regular verification of the critical-services list.

For every listed host: does it still resolve, does it still answer over
HTTPS, and does its source page still link to it? Results are compared with
the previous check, so hosts that fail repeatedly stand out as candidates for
review. The list itself is never changed automatically.
"""

from __future__ import annotations

import csv
import json
import ssl
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from .dnscheck import DoH


def _https(url: str, timeout: float = 12, read: int = 400_000) -> tuple[int | None, str, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "tlsmap list check (+https://github.com/Accelerate-GmbH/cert_landscape_CH)"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, r.geturl(), r.read(read)
    except urllib.error.HTTPError as e:
        return e.code, url, b""
    except Exception as e:  # timeouts, TLS errors, refused connections
        return None, type(e).__name__, b""


def check_row(row: dict, dns: DoH) -> dict:
    host = row["hostname"].strip().lower()
    d = dns.host(host)
    out = {"resolves": d["state"] == "resolves", "dns_state": d["state"]}
    status, final, _ = _https(f"https://{host}/") if out["resolves"] else (None, "", b"")
    out.update(https_status=status, reachable=status is not None and status < 500, final_url=final if status else "")
    src = (row.get("quelle_url") or "").strip()
    if src:
        st, _, body = _https(src)
        out["source_status"] = st
        out["source_links_host"] = host.encode() in body.lower() if body else False
    return out


def run(list_path: Path, previous_path: Path, dns: DoH, workers: int = 16) -> dict:
    rows = list(csv.DictReader(list_path.open(encoding="utf-8-sig")))
    prev = {}
    if previous_path.exists():
        prev = json.loads(previous_path.read_text()).get("hosts", {})
    with ThreadPoolExecutor(workers) as ex:
        results = list(ex.map(lambda r: check_row(r, dns), rows))
    hosts = {}
    for row, res in zip(rows, results):
        h = row["hostname"].strip().lower()
        p = prev.get(h, {})
        res["fail_streak"] = (p.get("fail_streak", 0) + 1) if not (res["resolves"] and res["reachable"]) else 0
        src_fail = bool(row.get("quelle_url")) and not res.get("source_links_host", False)
        res["source_fail_streak"] = (p.get("source_fail_streak", 0) + 1) if src_fail else 0
        res["changed"] = bool(p) and (p.get("resolves") != res["resolves"] or p.get("reachable") != res["reachable"])
        hosts[h] = res
    n = len(hosts)
    summary = {
        "hosts": n,
        "resolve": sum(1 for x in hosts.values() if x["resolves"]),
        "reachable": sum(1 for x in hosts.values() if x["reachable"]),
        "source_links_host": sum(1 for x in hosts.values() if x.get("source_links_host")),
        "with_source": sum(1 for r in rows if r.get("quelle_url")),
        "failing_twice_or_more": sorted(h for h, x in hosts.items() if x["fail_streak"] >= 2),
        "source_lost_twice_or_more": sorted(h for h, x in hosts.items() if x["source_fail_streak"] >= 2),
        "changed_since_last_check": sorted(h for h, x in hosts.items() if x["changed"]),
    }
    return {"checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "list": str(list_path), "summary": summary, "hosts": hosts}


def report_md(v: dict) -> str:
    s = v["summary"]
    lines = [
        "# Verification of the critical-services list", "",
        f"Checked: {v['checked_at']} · list: `{v['list']}`", "",
        "| | Hosts |", "|---|---|",
        f"| listed | {s['hosts']} |",
        f"| resolve in public DNS | {s['resolve']} |",
        f"| answer over HTTPS | {s['reachable']} |",
        f"| source page still links the host | {s['source_links_host']} of {s['with_source']} |", "",
        "## Failing in two or more consecutive checks (review)", "",
    ]
    lines += [f"- {h}" for h in s["failing_twice_or_more"]] or ["- none"]
    lines += ["", "## Source page no longer links the host (two or more checks)", ""]
    lines += [f"- {h}" for h in s["source_lost_twice_or_more"]] or ["- none"]
    lines += ["", "## Changed since the last check", ""]
    lines += [f"- {h}" for h in s["changed_since_last_check"]] or ["- none"]
    lines += ["", "Operator data (UID, seat) is checked separately against the UID register with",
              "`tools/critical_services/runuid.py`; this check does not change the list.", ""]
    return "\n".join(lines)

"""Public data for the web app, in one folder with a fixed schema.

Everything the browser may load comes from output/public/v2/ (schema in
docs/DATA_CONTRACT.md). It is derived from the merged output in
output/latest/, so the full data (host lists, raw results, exports) can move
to a private repository later: that repository then produces this folder and
hands only it to the public site.

    tlsmap public                       # output/latest -> output/public/v2
"""
from __future__ import annotations

import json
import math
import shutil
import tomllib
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from .config import CONFIG_DIR

SCHEMA = 2
LEVELS = ("federal", "canton", "municipality", "organisation")


def model(path: Path | None = None) -> dict:
    return tomllib.loads((path or CONFIG_DIR / "model.toml").read_text())


def _share(k: dict | None) -> float | None:
    """Share of assessed objects meeting a check: pass 1, partial 0.5."""
    if not k:
        return None
    n = k.get("assessed")
    if n is None:
        n = (k.get("pass") or 0) + (k.get("partial") or 0) + (k.get("fail") or 0)
    if not n:
        return None
    return round(100 * ((k.get("pass") or 0) + 0.5 * (k.get("partial") or 0)) / n, 1)


def _sum(ks: list[dict]) -> dict:
    out = {"pass": 0, "partial": 0, "fail": 0}
    for k in ks:
        for s in out:
            out[s] += (k or {}).get(s) or 0
    out["assessed"] = out["pass"] + out["partial"] + out["fail"]
    return out


def _ch_share(rows: list, count_index: int | None) -> float | None:
    """Share in Swiss hands of [name, country, (count)] entries."""
    tot = ch = 0
    for r in rows or []:
        w = r[count_index] if count_index is not None and len(r) > count_index else 1
        tot += w
        ch += w if r[1] == "CH" else 0
    return round(100 * ch / tot, 1) if tot else None


def block_value(block: dict, e: dict) -> dict:
    """Value of one building block for one entity: {"v": 0–100 | None, "m": method, "n": objects}."""
    tm, ml, sk = e.get("tm") or {}, e.get("ml") or {}, e.get("sk") or {}
    if block.get("none"):
        return {"v": None, "m": "none"}
    if "checks" in block:
        k = _sum([(tm.get("k") or {}).get(c) for c in block["checks"]])
        return {"v": _share(k), "m": "checks", "n": k["assessed"]}
    if "mail" in block:
        k = _sum([(ml.get("k") or {}).get(c) for c in block["mail"]])
        return {"v": _share(k), "m": "mail", "n": ml.get("n") or 0}
    dep = block.get("deps")
    if dep == "cloud":
        return {"v": _ch_share(sk.get("cloud"), 2), "m": "ch_share", "n": sum(r[2] for r in sk.get("cloud", []))}
    if dep in ("saas", "idp"):
        rows = sk.get(dep) or []
        return {"v": _ch_share(rows, None) if rows else None, "m": "ch_share", "n": len(rows)}
    if dep == "apps":
        return {"v": None, "m": "count", "n": sum((sk.get("apps") or {}).values())}
    return {"v": None, "m": "none"}


def entity_doc(kind: str, eid: str, e: dict, mdl: dict, hosts: list, mail_detail: list | None) -> dict:
    tm = e.get("tm") or {}
    return {
        "schema": SCHEMA, "key": f"{kind}:{eid}", "kind": kind, "id": eid, "name": e.get("n"),
        "canton": e.get("c") if kind != "federal" else None, "domains": e.get("d") or [],
        "uid": e.get("uid"), "uid_name": e.get("un"), "sector": e.get("sec"), "subsector": e.get("sub"), "place": e.get("ort"),
        "posture": {"overall": tm.get("o"), "categories": tm.get("c"), "lights": tm.get("l"), "checks": tm.get("k"),
                    "resources": tm.get("n"), "knockouts": tm.get("ko"), "distribution": tm.get("d")},
        "mail": {"overall": (e.get("ml") or {}).get("o"), "checks": (e.get("ml") or {}).get("k"), "domains": (e.get("ml") or {}).get("n"),
                 "detail": [{"domain": x.get("d"), "overall": x.get("o"),
                             "checks": [{"check": c[0], "status": c[1], "value": c[2]} for c in x.get("c", [])]}
                            for x in (mail_detail or [])]},
        "layers": {L["id"]: {b["id"]: block_value(b, e) for b in L["blocks"]} for L in mdl["layer"]},
        "dependencies": e.get("sk") or {}, "stack": e.get("stack") or {},
        "no_data": e.get("why"),
        "hosts": [{"host": r[0], "overall": r[2], "cats": r[3:7], "status": r[7], "critical": bool(r[8]),
                   "knockout": r[9] or None, "unreachable": bool(r[10]) if len(r) > 10 else False} for r in hosts],
    }


def benchmarks(docs: dict[str, list[dict]], mdl: dict) -> dict:
    """Per level: the value the best entities reach, per category, check, block and overall."""
    top = mdl["benchmark"]["top_share"]
    out: dict = {}
    for level, ds in docs.items():
        series: dict[str, list] = defaultdict(list)
        for d in ds:
            p = d["posture"]
            series["overall"].append((p["overall"], d["key"]))
            for c, v in (p["categories"] or {}).items():
                series["cat:" + c].append((v, d["key"]))
            for c, k in (p["checks"] or {}).items():
                series["chk:" + c].append((_share(k), d["key"]))
            series["mail"].append((d["mail"]["overall"], d["key"]))
            for lid, blocks in d["layers"].items():
                for bid, bv in blocks.items():
                    series[f"blk:{lid}.{bid}"].append((bv.get("v"), d["key"]))
        res = {}
        for name, pairs in series.items():
            pairs = [(v, k) for v, k in pairs if v is not None]
            if not pairs:
                continue
            if len(pairs) >= mdl["benchmark"]["min_group"]:
                # the best 5 % by rank: the value the last of them reaches, and their mean
                ranked = sorted(pairs, key=lambda x: (-x[0], x[1]))
                grp = ranked[: max(1, math.ceil(top * len(ranked)))]
                res[name] = {"mode": "top", "share": top, "value": grp[-1][0],
                             "mean": round(sum(v for v, _ in grp) / len(grp), 1), "group": len(grp),
                             "examples": [k for _, k in grp[:5]], "n": len(pairs)}
            else:
                v, k = max(pairs)
                res[name] = {"mode": "best", "value": v, "examples": [k], "n": len(pairs)}
        out[level] = res
    return out


def overview(docs: dict[str, list[dict]], mdl: dict) -> dict:
    """Switzerland at a glance: per level and building block the share over all entities."""
    out: dict = {}
    for level, ds in docs.items():
        cells = {}
        for L in mdl["layer"]:
            for b in L["blocks"]:
                vals = [(d["layers"][L["id"]][b["id"]].get("v"), d["layers"][L["id"]][b["id"]].get("n") or 0) for d in ds]
                vals = [(v, n) for v, n in vals if v is not None and n]
                tot = sum(n for _, n in vals)
                cells[f"{L['id']}.{b['id']}"] = {
                    "v": round(sum(v * n for v, n in vals) / tot, 1) if tot else None,
                    "entities": len(vals), "objects": tot,
                    "m": "none" if b.get("none") else ("count" if b.get("deps") == "apps" else "share")}
        ov = [d["posture"]["overall"] for d in ds if d["posture"]["overall"] is not None]
        lights = defaultdict(int)
        for d in ds:
            o = d["posture"]["overall"]
            lights["none" if o is None else ("green" if o >= 80 else "yellow" if o >= 50 else "red")] += 1
        out[level] = {"cells": cells, "entities": len(ds), "rated": len(ov),
                      "overall": round(sum(ov) / len(ov), 1) if ov else None, "lights": dict(lights)}
    return out


def build(latest: Path, out: Path) -> dict:
    mdl = model()
    m = json.loads((latest / "map.json").read_text())
    hosts = json.loads((latest / "hosts.json").read_text()) if (latest / "hosts.json").exists() else {"rows": []}
    by_key: dict[str, list] = defaultdict(list)
    for r in hosts.get("rows", []):
        by_key[r[1]].append(r)
    if out.exists():
        shutil.rmtree(out)
    (out / "entities").mkdir(parents=True)
    docs: dict[str, list[dict]] = {lv: [] for lv in LEVELS}
    index = []
    res_dir = latest / "resources"
    for kind in LEVELS:
        for eid, e in (m.get("entities", {}).get(kind) or {}).items():
            mp = res_dir / f"mail-{kind}-{eid}.json"
            md = json.loads(mp.read_text()) if mp.exists() else None
            d = entity_doc(kind, eid, e, mdl, by_key.get(f"{kind}:{eid}", []), md)
            docs[kind].append(d)
            (out / "entities" / f"{kind}-{eid}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
            index.append([d["key"], d["name"], d["canton"], d["posture"]["overall"], d["uid"], d["sector"]])
    meta = {"schema": SCHEMA, "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "data_generated": m.get("generated"), "cfg": m.get("cfg"), "check_order": m.get("chk_order"),
            "model": mdl, "counts": {k: len(v) for k, v in docs.items()}}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    (out / "index.json").write_text(json.dumps({"schema": SCHEMA, "rows": index}, ensure_ascii=False, separators=(",", ":")))
    (out / "overview.json").write_text(json.dumps(overview(docs, mdl), ensure_ascii=False, indent=1))
    (out / "benchmarks.json").write_text(json.dumps(benchmarks(docs, mdl), ensure_ascii=False, indent=1))
    return meta["counts"]

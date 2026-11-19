"""Consistency checks for the repository, run in CI on every push.

Checks that the rating, its configuration, the map and the documentation
describe the same set of checks; that all four languages carry the same
texts; that no credentials are committed; and that the published output is
complete and within GitHub's file size limit.

    python tools/check_repo.py            # exit code 1 on any problem
"""
from __future__ import annotations

import gzip
import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tlsmap import mail, posture  # noqa: E402

LANGS = ["de", "fr", "it", "en"]
problems: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def js_globals() -> dict:
    """Load web/i18n.js and web/guide.js with node and return their data."""
    code = ("global.window={};require('./web/i18n.js');require('./web/guide.js');"
            "console.log(JSON.stringify({I18N:window.I18N,GUIDE:window.GUIDE}))")
    out = subprocess.run(["node", "-e", code], cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def js_array(src: str, name: str) -> list[str]:
    m = re.search(r"const " + re.escape(name) + r"\s*=\s*\[([^\]]*)\]", src)
    return re.findall(r'"([^"]+)"', m.group(1)) if m else []


def js_object_keys(src: str, name: str) -> list[str]:
    m = re.search(r"const " + re.escape(name) + r"\s*=\s*\{(.*?)\};", src, re.S)
    return re.findall(r'"([a-z]+\.[a-z0-9]+)"\s*:', m.group(1)) if m else []


def check_rating(app: str, data: dict) -> None:
    ids = list(posture.CHECK_CATEGORY)
    settings = tomllib.loads((ROOT / "config/settings.toml").read_text())
    tp = settings["trust_posture"]
    if set(tp["checks"]) != set(ids):
        fail(f"settings [trust_posture.checks] {sorted(set(tp['checks']) ^ set(ids))} differ from posture.CHECK_CATEGORY")
    cw = tp["category_weights"]
    if set(cw) != set(posture.CATEGORIES) or abs(sum(cw.values()) - 1) > 1e-9:
        fail(f"category weights must cover {posture.CATEGORIES} and sum to 1 (sum {sum(cw.values())})")
    if js_array(app, "CHECK_IDS") != ids:
        fail("web/app.js CHECK_IDS is not in the order of posture.CHECK_CATEGORY")
    for name in ("CHECK_SHORT", "SRC"):
        missing = set(ids) - set(js_object_keys(app, name))
        if missing:
            fail(f"web/app.js {name} lacks {sorted(missing)}")
    cat_checks = re.search(r"const CAT_CHECKS = \{(.*?)\};", app, re.S).group(1)
    for cat in posture.CATEGORIES:
        listed = re.findall(r'"([a-z]+\.[a-z0-9]+)"', re.search(cat + r": \[([^\]]*)\]", cat_checks).group(1))
        expected = [c for c in ids if posture.CHECK_CATEGORY[c] == cat]
        if listed != expected:
            fail(f"web/app.js CAT_CHECKS.{cat} {listed} != {expected}")

    mail_ids = mail.CHECKS
    if js_array(app, "MAIL_CHECKS") != mail_ids:
        fail("web/app.js MAIL_CHECKS differs from mail.CHECKS")
    if set(settings.get("mail", {}).get("checks", {})) != set(mail_ids):
        fail("settings [mail.checks] differ from mail.CHECKS")

    rating_doc = (ROOT / "docs/RATING.md").read_text()
    for cid in ids + mail_ids:
        if cid not in rating_doc:
            fail(f"docs/RATING.md does not describe {cid}")

    guide, i18n = data["GUIDE"], data["I18N"]
    for lang in LANGS:
        g = guide.get(lang, {})
        for cid in ids + mail_ids:
            c = g.get("checks", {}).get(cid) or {}
            if not c.get("s") or not c.get("x"):
                fail(f"web/guide.js {lang}: check {cid} needs simple and expert text")
            if not (g.get("ui", {}).get(cid) or i18n.get(lang, {}).get(cid)):
                fail(f"{lang}: no expert label for {cid}")
            if not g.get("s", {}).get(cid):
                fail(f"web/guide.js {lang}: no simple label for {cid}")


def flat_keys(d: dict, prefix: str = "") -> set[str]:
    out = set()
    for k, v in d.items():
        if isinstance(v, dict):
            out |= flat_keys(v, prefix + k + ".")
        else:
            out.add(prefix + k)
    return out


def check_languages(data: dict) -> None:
    for name in ("I18N", "GUIDE"):
        sets = {lang: flat_keys(data[name].get(lang, {})) for lang in LANGS}
        base = sets["de"]
        for lang in LANGS[1:]:
            diff = base ^ sets[lang]
            if diff:
                fail(f"{name}: {lang} differs from de in {sorted(diff)[:8]}{' …' if len(diff) > 8 else ''}")


SECRET_PATTERNS = [
    (re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}"), "GitHub token"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{60,}"), "GitHub token"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS key"),
    (re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----"), "private key"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{20,}"), "Slack token"),
]


def check_secrets() -> None:
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    for f in files:
        p = ROOT / f
        if f.startswith("output/") or p.suffix in (".gz", ".xlsx", ".png", ".jpg") or not p.is_file():
            continue
        try:
            text = p.read_text(errors="ignore")
        except OSError:
            continue
        for rx, what in SECRET_PATTERNS:
            if rx.search(text):
                fail(f"{f}: looks like a {what}")


MAX_BYTES = 95 * 1024 * 1024   # GitHub rejects files over 100 MB


def check_output() -> None:
    latest = ROOT / "output/latest"
    if not latest.exists():
        return
    for p in (ROOT / "output").rglob("*"):
        if p.is_file() and p.stat().st_size > MAX_BYTES:
            fail(f"{p.relative_to(ROOT)} is {p.stat().st_size // 2**20} MB, close to GitHub's limit")
    for name in ("map.json", "hosts.json", "search.json", "entities.csv", "hostnames.csv", "run.json",
                 "results.json.gz", "checks.jsonl.gz"):
        if not (latest / name).exists():
            fail(f"output/latest/{name} is missing")
    for old in ("results.json", "checks.jsonl"):
        if (latest / old).exists():
            fail(f"output/latest/{old} should only exist compressed")
    for d in (ROOT / "output").iterdir():
        if d.is_dir() and d.name != "latest" and (d / "map.json").exists() and (d / "results.json.gz").exists():
            fail(f"{d.relative_to(ROOT)} keeps the full set; dated folders hold only run.json, entities.csv, results.json.gz")
    try:
        m = json.loads((latest / "map.json").read_text())
        hosts = json.loads((latest / "hosts.json").read_text())
    except (OSError, ValueError) as e:
        fail(f"output/latest map.json/hosts.json unreadable: {e}")
        return
    keys = {f"{k}:{i}" for k, v in m.get("entities", {}).items() for i in v}
    orphans = {r[1] for r in hosts.get("rows", [])} - keys
    if orphans:
        fail(f"hosts.json names {len(orphans)} entities missing in map.json, e.g. {sorted(orphans)[:3]}")
    if hosts.get("order") and hosts["order"] != list(posture.CHECK_CATEGORY):
        # an older run: fine for the data, but the map then shows checks in a different order
        print("note: hosts.json was written with an older check list", file=sys.stderr)
    res = latest / "resources"
    for kind, ents in m.get("entities", {}).items():
        for i, e in ents.items():
            if (e.get("tm") or {}).get("n") and kind != "organisation" and not (res / f"{kind}-{i}.json").exists():
                fail(f"resources/{kind}-{i}.json missing for a rated entity")
                break
    if not (latest / "checks.jsonl.gz").exists():
        return
    with gzip.open(latest / "checks.jsonl.gz", "rt", encoding="utf-8") as fh:
        first = fh.readline()
    if first and not {"entity", "hostname", "check", "status"} <= set(json.loads(first)):
        fail("checks.jsonl.gz lines lack entity/hostname/check/status")


def check_web() -> None:
    html = (ROOT / "web/index.html").read_text()
    for ref in re.findall(r'(?:src|href)="([^":#?]+)(?:\?[^"]*)?"', html):
        if not ref.startswith(("http", "data/")) and not (ROOT / "web" / ref).exists():
            fail(f"web/index.html references missing {ref}")


def main() -> int:
    app = (ROOT / "web/app.js").read_text()
    data = js_globals()
    check_rating(app, data)
    check_languages(data)
    check_secrets()
    check_output()
    check_web()
    for p in problems:
        print("✗", p)
    print(f"{len(problems)} problem(s)" if problems else "repository consistent")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

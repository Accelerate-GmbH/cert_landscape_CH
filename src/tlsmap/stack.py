"""What an entity's services rest on: mail platform, sending services, cloud
and hosting, SaaS with verified domains, login provider and type of service.

Everything is read from data the pipeline already collects (MX hosts and
their networks, SPF includes, CNAME chains, the network of each host) plus,
from runs that have them, the TXT records of the domain and the redirect of
login pages. Providers and patterns are in config/stack.toml; the country is
that of the controlling company, as elsewhere in the rating.

The result per entity:

    {"mail":  [[provider, country, n_domains], …],   MX platform or filter
     "send":  [[provider, country], …],             services allowed to send in its name (SPF)
     "saas":  [[provider, country], …],             SaaS with a verified domain or a CNAME to it
     "idp":   [[provider, country], …],             login provider seen on login pages
     "cloud": [[provider, country, n_hosts], …],    network or CNAME of hosts in use
     "apps":  {type: n_hosts}}                      type of service from the host name
"""
from __future__ import annotations

import re
import tomllib
from collections import Counter
from functools import lru_cache
from pathlib import Path

from .config import CONFIG_DIR

@lru_cache(maxsize=1)
def rules(path: str = "") -> dict:
    p = Path(path) if path else CONFIG_DIR / "stack.toml"
    return tomllib.loads(p.read_text())


def _host_match(host: str, pats: list[str]) -> bool:
    h = (host or "").lower().rstrip(".")
    return any(h == p or h.endswith("." + p) for p in pats)


def provider_for(field: str, value: str, cfg: dict | None = None) -> tuple[str, dict] | None:
    """First provider whose `field` patterns match `value` (a host name,
    SPF include, TXT record or network name)."""
    cfg = cfg or rules()
    v = (value or "").strip()
    if not v:
        return None
    for key, p in cfg.get("providers", {}).items():
        pats = p.get(field) or []
        if not pats:
            continue
        if field == "txt":
            if any(v.lower().startswith(x.lower()) for x in pats):
                return key, p
        elif field == "asn":
            if any(x in v.lower() for x in pats):
                return key, p
        elif _host_match(v, [x.lower() for x in pats]):
            return key, p
    return None


def app_type(hostname: str, cfg: dict | None = None) -> str:
    cfg = cfg or rules()
    labels = [x for x in (hostname or "").lower().lstrip("*.").split(".") if x]
    if len(labels) <= 2:
        return "website"
    first = labels[0]
    for kind, words in cfg.get("apps", {}).items():
        if first in words or re.sub(r"\d+$", "", first) in words:
            return kind
    if first in ("www", "www2", "m", "web"):
        return "website"
    return "other"


def spf_includes(spf: str) -> list[str]:
    return [i.lower().rstrip(".") for i in re.findall(r"(?:include|redirect)[:=](\S+)", spf or "", re.I)]


def entity_stack(entity: dict, rows: list[dict], cfg: dict | None = None) -> dict:
    cfg = cfg or rules()
    mail: Counter = Counter()
    send: dict = {}
    saas: dict = {}
    idp: dict = {}
    cloud: Counter = Counter()
    apps: Counter = Counter()

    def name(p):
        return p["name"], p.get("country", "")

    for dm in (entity.get("mail") or {}).get("domains", []):
        mx_hit = None
        for m in dm.get("mx", []):
            hit = provider_for("mx", m.get("host", ""), cfg)
            if hit:
                mx_hit = name(hit[1])
                break
        if not mx_hit:  # no known platform: the network that answers for the first MX host
            nets = [n for m in dm.get("mx", []) for n in (m.get("nets") or []) if n and n[0]]
            if nets:
                hit = provider_for("asn", nets[0][0], cfg)
                mx_hit = name(hit[1]) if hit else (nets[0][0], nets[0][1])
        if mx_hit:
            mail[mx_hit] += 1
        spf = next((c.get("value") for c in dm.get("checks", []) if c.get("check") == "mail.spf"), "") or dm.get("spf", "")
        for inc in spf_includes(spf):
            hit = provider_for("spf", inc, cfg)
            if hit:
                (saas if hit[1].get("kind") == "saas" else send)[name(hit[1])] = 1
        for t in dm.get("txt", []) or []:
            hit = provider_for("txt", t, cfg)
            if hit:
                saas[name(hit[1])] = 1

    for r in rows:
        if not r.get("in_use"):
            continue
        apps[app_type(r.get("hostname", ""), cfg)] += 1
        hit = None
        for c in r.get("cnames") or []:
            hit = provider_for("cname", c, cfg)
            if hit:
                break
        if hit and hit[1].get("kind") in ("saas", "sending"):
            saas[name(hit[1])] = 1
            hit_cloud = None
        elif hit and hit[1].get("kind") == "idp":
            idp[name(hit[1])] = 1
            hit_cloud = None
        else:
            hit_cloud = hit
        if not hit_cloud and r.get("as_name"):
            h2 = provider_for("asn", r["as_name"], cfg)
            hit_cloud = h2 if h2 else None
            if not h2:
                cloud[(r["as_name"], r.get("net_country", ""))] += 1
        if hit_cloud:
            p = hit_cloud[1]
            cloud[(p["name"], p.get("country") or r.get("net_country", ""))] += 1
        red = (r.get("http_sec") or {}).get("location_host")
        if red:
            h3 = provider_for("redirect", red, cfg)
            if h3:
                idp[name(h3[1])] = 1

    return {
        "mail": [[n, c, k] for (n, c), k in mail.most_common()],
        "send": [[n, c] for (n, c) in send],
        "saas": [[n, c] for (n, c) in saas],
        "idp": [[n, c] for (n, c) in idp],
        "cloud": [[n, c, k] for (n, c), k in cloud.most_common(12)],
        "apps": dict(apps.most_common()),
    }

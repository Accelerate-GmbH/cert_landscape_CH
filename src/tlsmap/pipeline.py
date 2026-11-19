"""Run the stages: discover -> classify -> DNS -> (probe) -> score."""

from __future__ import annotations

import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from . import probe as probe_mod
from .ccadb import CCADB
from .certs import describe, load_cert
from .config import Entity, Settings
from .ct import CTClient, current_certs, _parse_iso
from .dnscheck import CAA_DOMAINS, DoH, platform_for
from .http import Http
from .registry import Registry
from . import posture
from .scoring import compile_critical, is_critical, score_entity

log = logging.getLogger("tlsmap")


class Pipeline:
    def __init__(self, settings: Settings, registry: Registry, cache_dir: Path,
                 cert_detail: str = "auto", do_probe: bool = False, now: datetime | None = None):
        self.s = settings
        self.reg = registry
        self.now = now or datetime.now(timezone.utc)
        h = settings["http"]
        self.http = Http(cache_dir, h["user_agent"], h["timeout_seconds"], h["retries"], h.get("min_interval", {}))
        ttl = h.get("cache_ttl_hours", {})
        self.cert_ttl = ttl.get("cert")
        self.ct = CTClient(self.http, settings["sources"]["order"], ttl.get("ct", 72),
                           settings["sources"].get("certspotter_requires_key", True))
        self.dns = DoH(self.http, settings["dns"]["doh"], ttl.get("dns", 24))
        # CCADB: who owns each issuing CA (falls back to the last cached copy)
        if registry.ccadb is None:
            registry.ccadb = CCADB.load(self.http, Path(cache_dir) / "ccadb_index.json", ttl.get("ccadb", 168))
            if registry.ccadb is None:
                log.warning("CCADB unavailable; attributing CAs by issuer organisation only")
        self.cert_detail = cert_detail          # none | auto | all
        self.do_probe = do_probe
        self.critical = compile_critical(settings["critical"]["label_patterns"])
        self.platforms = dict(settings.get("platforms", {}))
        self.conc = settings["concurrency"]
        self.discovery_log: list[dict] = []
        self.probe_caps: dict = {}

    # -- stage 1: CT discovery ---------------------------------------------------
    def discover(self, entities: list[Entity]) -> dict[str, list]:
        # administrations: every name under their domains; organisations: only the listed hosts
        domains = sorted({d for e in entities if e.kind != "organisation" for d in e.domains})
        hosts = sorted({h for e in entities if e.kind == "organisation" for h in e.hosts} - set(domains))
        jobs = [(d, False) for d in domains] + [(h, True) for h in hosts]
        log.info("CT discovery for %d domains and %d listed hosts via %s", len(domains), len(hosts), "/".join(self.ct.order))
        results = {}
        with ThreadPoolExecutor(self.conc["ct"]) as ex:
            for (d, _), res in zip(jobs, ex.map(lambda j: self.ct.discover(j[0], j[1]), jobs)):
                results[d] = res
                self.discovery_log.append({"domain": d, "source": res.source, "records": len(res.records),
                                           "newest_not_before": res.newest_not_before, "error": res.error})
                if res.error:
                    log.warning("CT %s: %s", d, res.error)
        return results

    # -- stage 2: classify current certificate per hostname ---------------------
    def _classify(self, hc) -> dict:
        rec = hc.record
        ca = self.reg.match(rec.issuer_org, rec.issuer_cn)
        validation = self.reg.validation_from_name(ca, rec.issuer_cn)
        basis = "registry" if validation else None
        detail: dict = {}
        need_der = self.cert_detail == "all" or (self.cert_detail == "auto" and validation is None)
        if need_der or rec.der_b64:
            raw = self.ct.fetch_der(rec)
            if raw:
                try:
                    data = base64.b64decode(raw) if isinstance(raw, str) else raw
                    detail = describe(load_cert(data))
                    if detail["validation"] != "unknown":
                        validation, basis = detail["validation"], "certificate"
                except Exception as e:  # malformed or unsupported cert
                    log.debug("parse %s: %s", rec.id, e)
        nb, na = _parse_iso(rec.not_before), _parse_iso(rec.not_after)
        return {
            "ca_id": ca.id, "ca_name": ca.name, "issuer_org": rec.issuer_org, "issuer_cn": rec.issuer_cn,
            "operator_country": ca.operator_country, "control_country": ca.control_country, "zone": ca.zone,
            "ca_owner": ca.operator, "attribution": ca.attribution,
            "validation": validation or "unknown", "validation_basis": basis or "unknown",
            "not_before": rec.not_before, "not_after": rec.not_after,
            "validity_days": round((na - nb).total_seconds() / 86400, 1),
            "days_left": round((na - self.now).total_seconds() / 86400, 1),
            "key_type": detail.get("key_type"), "key_bits": detail.get("key_bits"),
            "signature_hash": detail.get("signature_hash"), "subject_org": detail.get("subject_org"),
            "source": rec.source, "cert_id": rec.id, "cert_sha256": rec.sha256 or detail.get("sha256"),
            "revoked": rec.revoked,
            "other_issuers": hc.other_issuers, "valid_cert_count": hc.valid_cert_count,
        }

    # -- full run -----------------------------------------------------------------
    def run(self, entities: list[Entity]) -> dict:
        disc = self.discover(entities)

        # hostname table per entity
        rows: list[dict] = []
        tasks = []
        blanks = []
        for e in entities:
            if e.kind == "organisation":
                recs = [r for h in e.hosts for r in disc[h].records]
                cur = {n: hc for n, hc in current_certs(recs, list(e.hosts), self.now).items() if n in e.hosts}
                blanks += [(e, h) for h in sorted(e.hosts) if h not in cur]
            else:
                recs = [r for d in e.domains for r in disc[d].records]
                cur = current_certs(recs, e.domains, self.now)
            for name, hc in sorted(cur.items()):
                tasks.append((e, name, hc))
        log.info("Classifying %d hostname certificates", len(tasks))
        with ThreadPoolExecutor(self.conc["ct"] * 2) as ex:
            classified = list(ex.map(lambda t: self._classify(t[2]), tasks))
        blank = {"ca_id": "unknown", "ca_name": "", "ca_owner": "", "attribution": "none", "issuer_org": "",
                 "issuer_cn": "", "operator_country": "", "control_country": "", "zone": "unknown",
                 "validation": "unknown", "validation_basis": "none", "not_before": "", "not_after": "",
                 "validity_days": None, "days_left": None, "source": "", "cert_id": "", "cert_sha256": None,
                 "other_issuers": [], "valid_cert_count": 0}
        for (e, name, hc), c in list(zip(tasks, classified)) + [((e, h, None), dict(blank)) for e, h in blanks]:
            meta = e.hosts.get(name, {})
            crit = meta.get("critical")
            row = {"entity": e.key, "entity_name": e.name, "hostname": name, "wildcard": name.startswith("*."),
                   "critical": crit if crit is not None else is_critical(name, e.domains, self.critical)}
            if meta:
                row.update({"service_type": meta.get("service_type", ""), "sector": meta.get("sector", ""),
                            "subsector": meta.get("subsector", ""), "reason": meta.get("reason", ""),
                            "source_url": meta.get("source_url", "")})
            row.update(c)
            if name in e.excluded_hosts:
                row["excluded"] = e.excluded_hosts[name]
            rows.append(row)

        # DNS: addresses, DNSSEC, platform, hosting network of every address
        names = sorted({r["hostname"] for r in rows if not r["wildcard"]}
                       | {r["hostname"][2:] for r in rows if r["wildcard"]})
        log.info("DNS checks for %d names", len(names))
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            dns_res = dict(zip(names, ex.map(self.dns.host, names)))
        req_dns = self.s["scoring"].get("require_dns", True)
        count_wc = self.s["scoring"].get("count_wildcards", True)
        for r in rows:
            target = r["hostname"][2:] if r["wildcard"] else r["hostname"]
            d = dns_res.get(target, {"state": "error", "cnames": [], "ips": [], "dnssec": False})
            r["dns_state"] = d["state"]
            r["cnames"] = d["cnames"]
            r["ips"] = d["ips"]
            r["dnssec"] = d.get("dnssec", False)
            r["platform"] = platform_for(d["cnames"], self.platforms)
            r["tld"] = target.rsplit(".", 1)[-1]
            if r.get("excluded"):
                r["in_use"] = False
            elif r["wildcard"]:
                r["in_use"] = count_wc
            else:
                r["in_use"] = (d["state"] == "resolves") or not req_dns
        resources = [r for r in rows if r["in_use"] and not r["wildcard"]]

        ips = sorted({ip for r in resources for ip in r["ips"]})
        log.info("Network origin for %d addresses", len(ips))
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            asn_res = dict(zip(ips, ex.map(self.dns.asn, ips)))
        for r in rows:
            first = asn_res.get(r["ips"][0], {}) if r.get("ips") else {}
            r["ip"] = r["ips"][0] if r.get("ips") else ""
            r["asn"], r["as_name"], r["net_country"] = first.get("asn", ""), first.get("as_name", ""), first.get("country", "")
            hz = [asn_res.get(ip, {}) for ip in r.get("ips", [])]
            r["hosting_zones"] = [self.reg.zone_for(a.get("country", "")) for a in hz if a]
            r["hosting_as"] = [f"{a.get('as_name', '')} ({a.get('country', '')})".strip() for a in hz if a]
            r["hosting"] = [{"ip": ip, "asn": asn_res.get(ip, {}).get("asn", ""), "as_name": asn_res.get(ip, {}).get("as_name", ""),
                             "country": asn_res.get(ip, {}).get("country", "")} for ip in r.get("ips", [])]

        # ECH (HTTPS record) and CAA per resource
        log.info("ECH and CAA checks for %d hostnames", len(resources))
        dom_of = {}
        for e in entities:
            for r in rows:
                if r["entity"] == e.key:
                    h = r["hostname"][2:] if r["wildcard"] else r["hostname"]
                    dom_of[(e.key, r["hostname"])] = next((d for d in e.domains if h == d or h.endswith("." + d)), "")
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            ech_res = list(ex.map(lambda r: self.dns.ech(r["hostname"]), resources))
            caa_res = list(ex.map(lambda r: self.dns.caa(r["hostname"], stop_at=dom_of.get((r["entity"], r["hostname"]))), resources))
        for r, ech, c in zip(resources, ech_res, caa_res):
            r["ech"] = ech["ech"]
            r["caa_found_at"] = c["found_at"]
            r["caa_issue"] = c["issue"]

        # CAA and zone (DNSSEC signing, name servers) per entity domain
        caa: dict[str, dict] = {}
        zones: dict[str, dict] = {}
        all_domains = sorted({d for e in entities for d in e.domains})
        zone_by_id = {c.id: c.zone for c in self.reg.cas}
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            for d, res in zip(all_domains, ex.map(self.dns.caa, all_domains)):
                res["issue_ca_ids"] = [CAA_DOMAINS.get(v, f"unknown:{v}") for v in res["issue"]]
                res["issue_zones"] = [zone_by_id.get(i, "unknown") for i in res["issue_ca_ids"]]
                caa[d] = res
            for d, z in zip(all_domains, ex.map(self.dns.zone, all_domains)):
                zones[d] = z
        ns_names = sorted({n for z in zones.values() for n in z["ns"]})
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            ns_dns = dict(zip(ns_names, ex.map(self.dns.host, ns_names)))
        ns_ips = sorted({d["ips"][0] for d in ns_dns.values() if d["ips"]} - set(asn_res))
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            asn_res.update(dict(zip(ns_ips, ex.map(self.dns.asn, ns_ips))))
        for d, z in zones.items():
            prov = []
            for n in z["ns"]:
                ip = (ns_dns.get(n) or {}).get("ips", [""])[:1]
                a = asn_res.get(ip[0], {}) if ip and ip[0] else {}
                prov.append({"ns": n, "asn": a.get("asn", ""), "as_name": a.get("as_name", ""), "country": a.get("country", ""),
                             "zone": self.reg.zone_for(a.get("country", ""))})
            z["providers"] = prov

        # root CA (from CT issuer; replaced by the served chain when probed)
        for r in rows:
            r.update(self.reg.root_info(r.get("issuer_cn", "")))

        # live probe of every endpoint
        probe_note = None
        if self.do_probe:
            ok, probe_note = probe_mod.check_network(self.s["probe"]["canaries"], self.reg,
                                                     self.s["probe"]["timeout_seconds"])
            if ok:
                self._probe(resources)
            else:
                log.warning(probe_note)

        # Trust Posture rating per resource
        tm_cfg = self.s["trust_posture"]
        checklog = []
        for r in resources:
            dom = dom_of.get((r["entity"], r["hostname"]), "")
            z = zones.get(dom, {})
            ctx = {"ns_zones": [p["zone"] for p in z.get("providers", [])], "ns_domain": dom,
                   "ns": [[p["ns"], p.get("asn", ""), p["as_name"], p["country"]] for p in z.get("providers", [])],
                   "ns_providers": sorted({f"{p['as_name']} ({p['country']})" for p in z.get("providers", [])})}
            results = posture.evaluate(r, ctx, tm_cfg)
            ko = posture.knockout(r)
            sc = posture.score(results, tm_cfg)
            if ko:
                sc["overall"] = 0
            r["tm"], r["tm_checks"], r["posture_knockout"] = sc, results, ko
            ts = max((e.get("checked_at", "") for e in r.get("endpoints") or []), default="") or self.now.strftime("%Y-%m-%dT%H:%M:%SZ")
            for x in results:
                checklog.append({"ts": ts, "entity": r["entity"], "hostname": r["hostname"], **x})

        # how far behind the logs is the CT source?
        newest = max((d["newest_not_before"] for d in self.discovery_log if d["newest_not_before"]), default=None)
        self.ct_lag_days = round((self.now - _parse_iso(newest)).total_seconds() / 86400, 1) if newest else None

        # entity scores
        entities_out = []
        for e in entities:
            hosts = [r for r in rows if r["entity"] == e.key]
            ecaa = caa.get(e.domains[0]) if e.domains else None
            metrics = score_entity(hosts, ecaa, self.s.raw, self.now, self.ct_lag_days)
            res_e = [r for r in hosts if r.get("tm")]
            metrics["posture"] = posture.aggregate(res_e, self.s["trust_posture"])
            metrics["zone"] = {d: zones.get(d, {}) for d in e.domains}
            disc_info = [x for x in self.discovery_log if x["domain"] in e.domains]
            entities_out.append({
                "key": e.key, "kind": e.kind, "id": e.id, "name": e.name, "canton": e.canton,
                "code": e.code, "domains": e.domains, "shared_domain": e.shared_domain,
                **({"sector": e.sector, "subsector": e.subsector, "uid": e.uid, "place": e.place,
                    "visibility": e.visibility, "hosts_listed": len(e.hosts)} if e.kind == "organisation" else {}),
                "caa": {d: caa[d] for d in e.domains if d in caa},
                "discovery": disc_info, **metrics,
            })
        return {"generated": self.now.strftime("%Y-%m-%dT%H:%M:%SZ"), "entities": entities_out,
                "hostnames": rows, "discovery": self.discovery_log, "probe": probe_note,
                "checklog": checklog, "probe_caps": self.probe_caps, "tm_cfg": dict(self.s["trust_posture"]),
                "ct_lag_days": self.ct_lag_days,
                "http_stats": self.http.stats,
                "ccadb_fetched": self.reg.ccadb.fetched if self.reg.ccadb else None}

    def _probe(self, resources: list[dict]) -> None:
        t = self.s["probe"]["timeout_seconds"]
        pq = probe_mod.pq_method()
        v6 = probe_mod.ipv6_works()
        self.probe_caps = {"pq_method": pq or "unavailable", "ipv6": v6}
        log.info("Probing %d hostnames (PQ test: %s, IPv6: %s)", len(resources), pq or "unavailable", v6)
        jobs = []
        for r in resources:
            addrs = [ip for ip in r["ips"] if v6 or ":" not in ip][:6]
            r["endpoints_untested_v6"] = 0 if v6 else sum(1 for ip in r["ips"] if ":" in ip)
            jobs += [(r, ip) for ip in addrs]
        with ThreadPoolExecutor(self.conc["probe"]) as ex:
            eps = list(ex.map(lambda j: probe_mod.endpoint(j[0]["hostname"], j[1], t, pq), jobs))
        # revocation once per certificate
        by_cert = {}
        for ep in eps:
            if ep.get("cert") and ep.get("_chain"):
                by_cert.setdefault(ep["cert"]["sha256"], ep["_chain"])
        log.info("Revocation checks for %d certificates", len(by_cert))
        with ThreadPoolExecutor(self.conc["probe"]) as ex:
            revs = dict(zip(by_cert, ex.map(lambda ch: probe_mod.revocation(ch, self.http), by_cert.values())))
        for (r, _), ep in zip(jobs, eps):
            ep.pop("_chain", None)
            if ep.get("cert"):
                ep["revocation"] = revs.get(ep["cert"]["sha256"], {"status": "unknown"})
            r.setdefault("endpoints", []).append(ep)
        for r in resources:
            ok = [e for e in r.get("endpoints", []) if e.get("cert")]
            r["probe_ok"] = bool(ok)
            if not ok:
                r["probe_error"] = "; ".join(sorted({e.get("error", "") for e in r.get("endpoints", [])}))[:200]
                continue
            cert = ok[0]["cert"]
            r["probe_verified"] = all(e.get("valid") for e in ok)
            r["probe_tls_version"] = "/".join(sorted({e.get("tls_version", "") for e in ok}))
            r["served_issuer_org"] = cert["issuer_org"]
            r["served_matches_ct"] = bool(r.get("cert_sha256") and cert["sha256"] == r["cert_sha256"])
            r["endpoints_consistent"] = len({e["cert"]["sha256"] for e in ok}) == 1
            ca = self.reg.match(cert["issuer_org"], cert["issuer_cn"])
            # What is served is what users rely on: it overrides the CT view.
            r.update({"ca_id": ca.id, "ca_name": ca.name, "ca_owner": ca.operator, "attribution": ca.attribution,
                      "operator_country": ca.operator_country, "control_country": ca.control_country,
                      "zone": ca.zone, "issuer_cn": cert["issuer_cn"], "issuer_org": cert["issuer_org"],
                      "validation": cert["validation"], "validation_basis": "served",
                      "key_type": cert["key_type"], "key_bits": cert["key_bits"],
                      "signature_hash": cert["signature_hash"],
                      "days_left": round((_parse_iso(cert["not_after"]) - self.now).total_seconds() / 86400, 1),
                      "validity_days": cert["validity_days"]})
            r.update(self.reg.root_info(cert["issuer_cn"]))

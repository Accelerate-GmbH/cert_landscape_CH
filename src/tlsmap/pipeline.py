"""Run the stages: discover -> classify -> DNS -> (probe) -> score."""

from __future__ import annotations

import base64
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from . import probe as probe_mod
from .certs import describe, load_cert
from .config import Entity, Settings
from .ct import CTClient, current_certs, _parse_iso
from .dnscheck import CAA_DOMAINS, DoH, platform_for
from .http import Http
from .registry import Registry
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
        self.cert_detail = cert_detail          # none | auto | all
        self.do_probe = do_probe
        self.critical = compile_critical(settings["critical"]["label_patterns"])
        self.platforms = dict(settings.get("platforms", {}))
        self.conc = settings["concurrency"]
        self.discovery_log: list[dict] = []

    # -- stage 1: CT discovery ---------------------------------------------------
    def discover(self, entities: list[Entity]) -> dict[str, list]:
        domains = sorted({d for e in entities for d in e.domains})
        log.info("CT discovery for %d domains via %s", len(domains), "/".join(self.ct.order))
        results = {}
        with ThreadPoolExecutor(self.conc["ct"]) as ex:
            for d, res in zip(domains, ex.map(self.ct.discover, domains)):
                results[d] = res
                self.discovery_log.append({"domain": d, "source": res.source, "records": len(res.records),
                                           "newest_not_before": res.newest_not_before, "error": res.error})
                if res.error:
                    log.warning("CT %s: %s", d, res.error)
        return results

    # -- stage 2: classify current certificate per hostname ---------------------
    def _classify(self, hc) -> dict:
        rec = hc.record
        ca = self.reg.match(rec.issuer_org)
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
            "registry_verified": ca.verified,
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
        for e in entities:
            recs = [r for d in e.domains for r in disc[d].records]
            cur = current_certs(recs, e.domains, self.now)
            for name, hc in sorted(cur.items()):
                tasks.append((e, name, hc))
        log.info("Classifying %d hostname certificates", len(tasks))
        with ThreadPoolExecutor(self.conc["ct"] * 2) as ex:
            classified = list(ex.map(lambda t: self._classify(t[2]), tasks))
        for (e, name, hc), c in zip(tasks, classified):
            row = {"entity": e.key, "entity_name": e.name, "hostname": name,
                   "wildcard": name.startswith("*."), "critical": is_critical(name, e.domains, self.critical)}
            row.update(c)
            if name in e.excluded_hosts:
                row["excluded"] = e.excluded_hosts[name]
            rows.append(row)

        # DNS
        names = sorted({r["hostname"] for r in rows if not r["wildcard"]}
                       | {r["hostname"][2:] for r in rows if r["wildcard"]})
        log.info("DNS checks for %d names", len(names))
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            dns_res = dict(zip(names, ex.map(self.dns.host, names)))
        ips = sorted({ip for d in dns_res.values() for ip in d["ips"][:1]})
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            asn_res = dict(zip(ips, ex.map(self.dns.asn, ips)))
        req_dns = self.s["scoring"].get("require_dns", True)
        count_wc = self.s["scoring"].get("count_wildcards", True)
        for r in rows:
            target = r["hostname"][2:] if r["wildcard"] else r["hostname"]
            d = dns_res.get(target, {"state": "error", "cnames": [], "ips": []})
            r["dns_state"] = d["state"]
            r["cnames"] = d["cnames"]
            r["platform"] = platform_for(d["cnames"], self.platforms)
            ip = d["ips"][0] if d["ips"] else ""
            a = asn_res.get(ip, {})
            r["ip"], r["asn"], r["as_name"], r["net_country"] = ip, a.get("asn", ""), a.get("as_name", ""), a.get("country", "")
            if r.get("excluded"):
                r["in_use"] = False
            elif r["wildcard"]:
                r["in_use"] = count_wc
            else:
                r["in_use"] = (d["state"] == "resolves") or not req_dns

        # CAA per entity domain
        caa: dict[str, dict] = {}
        all_domains = sorted({d for e in entities for d in e.domains})
        with ThreadPoolExecutor(self.conc["dns"]) as ex:
            for d, res in zip(all_domains, ex.map(self.dns.caa, all_domains)):
                ids = []
                for v in res["issue"]:
                    ids.append(CAA_DOMAINS.get(v, f"unknown:{v}"))
                res["issue_ca_ids"] = ids
                zone_by_id = {c.id: c.zone for c in self.reg.cas}
                res["issue_zones"] = [zone_by_id.get(i, "unknown") for i in ids]
                caa[d] = res

        # optional live probe
        probe_note = None
        if self.do_probe:
            ok, probe_note = probe_mod.check_network(self.s["probe"]["canaries"], self.reg,
                                                     self.s["probe"]["timeout_seconds"])
            if ok:
                targets = [r for r in rows if r["in_use"] and not r["wildcard"]]
                log.info("Probing %d hostnames", len(targets))
                with ThreadPoolExecutor(self.conc["probe"]) as ex:
                    res = list(ex.map(lambda r: probe_mod.fetch(r["hostname"], timeout=self.s["probe"]["timeout_seconds"]), targets))
                for r, p in zip(targets, res):
                    self._apply_probe(r, p)
            else:
                log.warning(probe_note)

        # how far behind the logs is the CT source?
        newest = max((d["newest_not_before"] for d in self.discovery_log if d["newest_not_before"]), default=None)
        self.ct_lag_days = round((self.now - _parse_iso(newest)).total_seconds() / 86400, 1) if newest else None

        # entity scores
        entities_out = []
        for e in entities:
            hosts = [r for r in rows if r["entity"] == e.key]
            ecaa = caa.get(e.domains[0]) if e.domains else None
            metrics = score_entity(hosts, ecaa, self.s.raw, self.now, self.ct_lag_days)
            disc_info = [x for x in self.discovery_log if x["domain"] in e.domains]
            entities_out.append({
                "key": e.key, "kind": e.kind, "id": e.id, "name": e.name, "canton": e.canton,
                "code": e.code, "domains": e.domains, "shared_domain": e.shared_domain,
                "caa": {d: caa[d] for d in e.domains if d in caa},
                "discovery": disc_info, **metrics,
            })
        return {"generated": self.now.strftime("%Y-%m-%dT%H:%M:%SZ"), "entities": entities_out,
                "hostnames": rows, "discovery": self.discovery_log, "probe": probe_note,
                "ct_lag_days": self.ct_lag_days,
                "http_stats": self.http.stats}

    def _apply_probe(self, r: dict, p: dict) -> None:
        r["probe_ok"] = bool(p.get("ok"))
        r["probe_error"] = p.get("error", "")
        r["probe_verified"] = p.get("verified")
        r["probe_tls_version"] = p.get("tls_version", "")
        cert = p.get("cert")
        if not cert:
            return
        ca = self.reg.match(cert["issuer_org"])
        r["served_issuer_org"] = cert["issuer_org"]
        r["served_matches_ct"] = bool(r.get("cert_sha256") and cert["sha256"] == r["cert_sha256"])
        # What is served is what users rely on: it overrides the CT view.
        r.update({"ca_id": ca.id, "ca_name": ca.name, "operator_country": ca.operator_country,
                  "control_country": ca.control_country, "zone": ca.zone,
                  "validation": cert["validation"], "validation_basis": "served",
                  "key_type": cert["key_type"], "key_bits": cert["key_bits"],
                  "signature_hash": cert["signature_hash"],
                  "days_left": round((_parse_iso(cert["not_after"]) - self.now).total_seconds() / 86400, 1),
                  "validity_days": cert["validity_days"]})

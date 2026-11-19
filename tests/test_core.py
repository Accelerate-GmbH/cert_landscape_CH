import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from tlsmap.ccadb import CCADB
from tlsmap.certs import describe, load_cert
from tlsmap.config import load_entities, load_settings
from tlsmap.ct import CertRecord, current_certs, in_scope
from tlsmap.dnscheck import parse_caa, platform_for
from tlsmap.registry import Registry, parse_dn
from tlsmap.scoring import compile_critical, is_critical, score_entity

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
CCA = CCADB.load(None, FIX / "ccadb_index_sample.json")
REG = Registry(ccadb=CCA)
SETTINGS = load_settings().raw


# -- certificates --------------------------------------------------------------
def test_real_certs_validation_levels():
    le = describe(load_cert((FIX / "crtsh_29970766484.pem").read_bytes()))
    dv = describe(load_cert((FIX / "crtsh_30066694226.pem").read_bytes()))
    ov = describe(load_cert((FIX / "crtsh_28621180031.pem").read_bytes()))
    assert le["validation"] == "DV" and le["issuer_org"] == "Let's Encrypt"
    assert dv["validation"] == "DV" and dv["issuer_org"] == "SwissSign AG"
    assert ov["validation"] == "OV" and ov["subject_org"]
    assert ov["key_type"] == "RSA" and ov["key_bits"] == 4096


def _synthetic(policy_oid=None, bits=2048, algo=hashes.SHA256(), org=None):
    key = rsa.generate_private_key(public_exponent=65537, key_size=bits)
    attrs = [x509.NameAttribute(NameOID.COMMON_NAME, "test.example.ch")]
    if org:
        attrs.append(x509.NameAttribute(NameOID.ORGANIZATION_NAME, org))
    b = (x509.CertificateBuilder().subject_name(x509.Name(attrs))
         .issuer_name(x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Test CA")]))
         .public_key(key.public_key()).serial_number(1)
         .not_valid_before(NOW - timedelta(days=1)).not_valid_after(NOW + timedelta(days=89)))
    if policy_oid:
        b = b.add_extension(x509.CertificatePolicies([x509.PolicyInformation(x509.ObjectIdentifier(policy_oid), None)]), False)
    return b.sign(key, algo)


def test_ev_policy_and_fallbacks():
    assert describe(_synthetic("2.23.140.1.1"))["validation"] == "EV"
    assert describe(_synthetic(None, org="Gemeinde Test"))["validation"] == "OV"
    d = describe(_synthetic(None, bits=1024))
    assert d["key_bits"] == 1024 and d["validity_days"] == 90.0


# -- registry --------------------------------------------------------------------
def test_ccadb_attribution_ignores_brand():
    # brand in the certificate -> CA owner per CCADB
    z = REG.match("ZeroSSL GmbH", "ZeroSSL RSA Domain Secure Site CA")
    assert z.id == "sectigo" and z.attribution == "ccadb" and z.zone == "third"
    t = REG.match("Trust Provider B.V.", "Trust Provider B.V. TLS RSA CA G1")
    assert t.id == "digicert"
    ie = REG.match("DigiCert Ireland Limited", "DigiCert G2 TLS EU RSA4096 SHA384 2022 CA1")
    assert ie.id == "digicert" and ie.control_country == "US"
    tr = REG.match("The Trustico Group Ltd", "Trustico ECC DV SSL CA 2")
    assert tr.id == "sectigo"


def test_parents_and_countries():
    sw = REG.match("SwissSign AG", "SwissSign RSA TLS DV ICA 2022 - 1")
    assert sw.zone == "ch" and sw.operator_country == "CH" and sw.attribution == "ccadb"
    sec = REG.match("Sectigo Limited", "")          # no CCADB hit -> registry fallback
    assert sec.operator_country == "GB" and sec.control_country == "US" and sec.attribution == "registry"
    gs = REG.match("GlobalSign nv-sa", "GlobalSign GCC R3 DV TLS CA 2020")
    assert gs.operator_country == "BE" and gs.control_country == "JP"
    assert REG.match("Buypass AS-983163327").zone == "eea"
    assert REG.match("Nobody Ltd", "Nobody CA").id == "unknown"


def test_validation_from_issuer_name():
    sw = REG.match("SwissSign AG", "SwissSign RSA TLS DV ICA 2022 - 1")
    assert Registry.validation_from_name(sw, "SwissSign RSA TLS DV ICA 2022 - 1") == "DV"
    assert Registry.validation_from_name(sw, "SwissSign RSA TLS OV ICA 2022 - 1") == "OV"
    assert Registry.validation_from_name(REG.match("Let's Encrypt", "YR1"), "YR1") == "DV"
    assert Registry.validation_from_name(REG.match("DigiCert Inc"), "DigiCert Global G2 TLS RSA SHA256 2020 CA1") is None


def test_parse_dn():
    assert parse_dn("C=US, O=Let's Encrypt, CN=YR1") == {"C": "US", "O": "Let's Encrypt", "CN": "YR1"}
    assert parse_dn('C=US, O="DigiCert, Inc.", CN=X')["O"] == "DigiCert, Inc."


# -- current certificate per hostname --------------------------------------------
def _rec(i, names, nb, na, org="Let's Encrypt"):
    return CertRecord("test", str(i), f"C=US, O={org}, CN=R1", nb, na, names)


def test_renewals_count_once():
    recs = [
        _rec(1, ["ottenbach.ch", "www.ottenbach.ch"], "2026-09-20T00:00:00Z", "2026-12-19T00:00:00Z"),
        _rec(2, ["ottenbach.ch", "www.ottenbach.ch"], "2026-10-20T00:00:00Z", "2027-01-18T00:00:00Z"),
        _rec(3, ["*.ottenbach.ch", "ottenbach.ch"], "2026-10-12T00:00:00Z", "2027-01-10T00:00:00Z", "Google Trust Services"),
        _rec(4, ["access.ottenbach.ch"], "2026-06-01T00:00:00Z", "2026-08-30T00:00:00Z"),  # expired
        _rec(5, ["evil.example.com", "ottenbach.ch.evil.com"], "2026-10-01T00:00:00Z", "2027-01-01T00:00:00Z"),
    ]
    cur = current_certs(recs, ["ottenbach.ch"], NOW)
    assert set(cur) == {"ottenbach.ch", "www.ottenbach.ch", "*.ottenbach.ch"}
    assert cur["ottenbach.ch"].record.id == "2"
    assert cur["ottenbach.ch"].valid_cert_count == 3
    assert cur["ottenbach.ch"].other_issuers == ["Google Trust Services"]


def test_crtsh_fixture_zug():
    rows = json.loads((FIX / "crtsh_zg.ch.json").read_text())
    recs = [CertRecord("crtsh", str(r["id"]), r["issuer_name"], r["not_before"] + "Z", r["not_after"] + "Z",
                       r["name_value"].split("\n")) for r in rows]
    cur = current_certs(recs, ["zg.ch"], datetime(2026, 10, 15, tzinfo=timezone.utc))
    used = {hc.record.id for hc in cur.values()}
    assert 0 < len(used) < len(recs)          # renewed certificates drop out
    assert all(in_scope(h, ["zg.ch"]) for h in cur)


# -- DNS helpers -------------------------------------------------------------------
def test_caa_and_platform():
    p = parse_caa(['0 issue "swisssign.com"', '0 issuewild ";"', '0 iodef "mailto:sec@zg.ch"'])
    assert p["issue"] == ["swisssign.com"] and p["issuewild"] == [""]
    plats = SETTINGS["platforms"]
    assert platform_for(["foo.azurewebsites.net"], plats) == "Microsoft Azure"
    assert platform_for(["web.example.ch"], plats) == ""


# -- scoring -----------------------------------------------------------------------
def test_critical_labels():
    pats = compile_critical(SETTINGS["critical"]["label_patterns"])
    assert is_critical("login.zg.ch", ["zg.ch"], pats)
    assert is_critical("webmail.gemeinde.ch", ["gemeinde.ch"], pats)
    assert not is_critical("www.zg.ch", ["zg.ch"], pats)
    assert not is_critical("zg.ch", ["zg.ch"], pats)


def _host(zone, val, critical=False, ca=("x", "X", "US"), in_use=True, validity=90):
    return {"in_use": in_use, "zone": zone, "validation": val, "critical": critical, "ca_id": ca[0],
            "ca_name": ca[1], "control_country": ca[2], "validity_days": validity, "days_left": 40}


def test_scores_are_shares_of_hostnames():
    hosts = [_host("ch", "OV", True, ("swisssign", "SwissSign", "CH"), validity=365),
             _host("ch", "DV", ca=("swisssign", "SwissSign", "CH"), validity=198),
             _host("third", "DV"), _host("third", "DV"), _host("third", "DV", in_use=False)]
    m = score_entity(hosts, None, SETTINGS, NOW)
    assert m["hosts_in_use"] == 4
    assert m["sovereignty_score"] == 50
    assert m["assurance_score"] == 25
    assert m["critical_assurance_score"] == 100
    assert m["automated_share"] == 0.5
    chk = {c["id"]: c["status"] for c in m["checks"]}
    assert chk["critical_identity_validated"] == "pass"


def test_entities_load_zug():
    ents = load_entities(["cantons", "municipalities"], canton_filter="ZG")
    kinds = {e.kind for e in ents}
    assert kinds == {"canton", "municipality"}
    assert any(e.name == "Kanton Zug" and e.domains == ["zg.ch"] for e in ents)
    assert len([e for e in ents if e.kind == "municipality"]) == 11


def test_map_json_shape():
    from tlsmap.export import map_json
    e = {"key": "canton:9", "kind": "canton", "id": "9", "name": "Kanton Zug", "code": "ZG",
         "domains": ["zg.ch"], "shared_domain": False,
         "caa": {"zg.ch": {"records": ['0 issue "swisssign.com"'], "issue": ["swisssign.com"], "issue_zones": ["ch"]}},
         "hosts_found": 3, "hosts_in_use": 2, "critical_in_use": 1, "sovereignty_score": 100,
         "critical_sovereignty_score": 100, "assurance_score": 50, "critical_assurance_score": 100,
         "zone_shares": {"ch": 1.0, "eea": 0, "third": 0, "unknown": 0},
         "validation_counts": {"DV": 1, "OV": 1, "IV": 0, "EV": 0, "unknown": 0},
         "by_ca": [{"name": "SwissSign", "control_country": "CH", "zone": "ch", "hosts": 2}],
         "checks": [{"id": "caa_present", "status": "pass"}, {"id": "no_weak_crypto", "status": "n/a"}],
         "automated_share": 0.0, "platforms": {}, "network_countries": {"CH": 2}}
    m = map_json({"generated": "2026-11-19T00:00:00Z", "entities": [e]}, {})
    z = m["entities"]["canton"]["9"]
    assert z["caa"] == "swiss" and z["gp"] == 100 and z["cas"][0] == ["SwissSign", "CH", "ch", 2]


def test_host_list_organisations(tmp_path):
    from tlsmap.config import load_organisations
    csv_path = tmp_path / "hosts.csv"
    csv_path.write_text(
        "hostname,begruendung,organisation,uid,sektor,teilsektor,service_typ,kritisch,plz,ort,kanton,quelle_url,sichtbarkeit,sicherheit,bemerkung\n"
        "ebanking.beispielbank.ch,x,Beispielbank AG,CHE-000.000.001,Finanzen,Banken,login,ja,8000,Zürich,ZH,,aggregat,hoch,\n"
        "www.beispielbank.ch,x,Beispielbank AG,CHE-000.000.001,Finanzen,Banken,website,,8000,Zürich,ZH,,aggregat,hoch,\n"
        "www.example-energie.ch,x,Energie Beispiel AG,,Energie,Strom,website,nein,6300,Zug,ZG,,oeffentlich,hoch,\n", encoding="utf-8")
    orgs = load_organisations(csv_path)
    assert len(orgs) == 2
    bank = next(o for o in orgs if o.name == "Beispielbank AG")
    assert bank.kind == "organisation" and bank.domains == ["beispielbank.ch"] and bank.visibility == "aggregat"
    assert bank.hosts["ebanking.beispielbank.ch"]["critical"] is True
    assert bank.hosts["www.beispielbank.ch"]["critical"] is None      # derived later
    assert load_organisations(csv_path, canton_filter="ZG")[0].name == "Energie Beispiel AG"


def test_public_split_hides_aggregate_organisations():
    from tlsmap.export import split_public
    res = {"entities": [{"key": "canton:9", "kind": "canton"},
                        {"key": "organisation:a", "kind": "organisation", "visibility": "oeffentlich"},
                        {"key": "organisation:b", "kind": "organisation", "visibility": "aggregat"}],
           "hostnames": [{"entity": "organisation:b", "hostname": "x"}, {"entity": "canton:9", "hostname": "y"}],
           "checklog": [{"entity": "organisation:b"}]}
    pub = split_public(res)
    assert [e["key"] for e in pub["entities"]] == ["canton:9", "organisation:a"]
    assert [r["hostname"] for r in pub["hostnames"]] == ["y"] and pub["checklog"] == []


def test_listed_host_links_to_administration():
    from tlsmap.merge import combine, link_admin_hosts
    admin = {"entities": [{"key": "canton:1", "kind": "canton"}],
             "hostnames": [{"entity": "canton:1", "hostname": "www.zh.ch", "tm": {"overall": 70}, "critical": False,
                            "validation": "OV"}],
             "generated": "2026-11-19T00:00:00Z", "discovery": [], "checklog": [
                 {"entity": "canton:1", "hostname": "www.zh.ch", "check": "own.identity", "status": "pass"}]}
    org = {"entities": [{"key": "organisation:kt-zh", "kind": "organisation", "visibility": "aggregat"}],
           "hostnames": [{"entity": "organisation:kt-zh", "hostname": "www.zh.ch", "tm": {"overall": 10}, "critical": True,
                          "sector": "Behörden", "service_type": "website", "confidence": "hoch"}],
           "generated": "2026-11-19T01:00:00Z", "discovery": [], "checklog": [
               {"entity": "organisation:kt-zh", "hostname": "www.zh.ch", "check": "own.identity", "status": "fail"}]}
    res = combine([admin, org])
    assert link_admin_hosts(res) == 1
    r = next(x for x in res["hostnames"] if x["entity"] == "organisation:kt-zh")
    assert r["tm"]["overall"] == 70 and r["validation"] == "OV"          # measurement from the canton
    assert r["critical"] is True and r["sector"] == "Behörden"         # list attributes kept
    assert r["linked_to"] == "canton:1"
    assert [x["status"] for x in res["checklog"] if x["entity"] == "organisation:kt-zh"] == ["pass"]


def test_no_data_reason():
    from tlsmap.export import no_data_reason
    base = {"posture": {}, "domains": ["x.ch"], "discovery": [{"domain": "x.ch", "error": None}],
            "hosts_found": 0, "hosts_in_use": 0, "shared_domain": False}
    assert no_data_reason({**base, "posture": {"overall": 40}}) is None
    assert no_data_reason({**base, "domains": []}) == "no_domain"
    assert no_data_reason({**base, "discovery": [{"domain": "x.ch", "error": "HTTP 502"}]}) == "ct_error"
    assert no_data_reason(base) == "no_certs"
    assert no_data_reason({**base, "shared_domain": True}) == "shared"
    assert no_data_reason({**base, "hosts_found": 3}) == "not_resolving"
    assert no_data_reason({**base, "hosts_found": 3, "hosts_in_use": 2}) == "not_assessed"


def test_list_visibility_applies_at_merge(tmp_path):
    from tlsmap.merge import apply_list_visibility
    p = tmp_path / "list.csv"
    p.write_text("hostname,organisation,uid,sichtbarkeit\nwww.bank.ch,Bank AG,CHE-1,oeffentlich\n", encoding="utf-8")
    from tlsmap.config import load_organisations
    oid = load_organisations(p)[0].id
    res = {"entities": [{"key": f"organisation:{oid}", "kind": "organisation", "visibility": "aggregat"}]}
    assert apply_list_visibility(res, p) == 1 and res["entities"][0]["visibility"] == "oeffentlich"


def test_dns_provider_rule():
    from tlsmap.posture import dns_status, hosting_status, operator_key, parse_providers, self_tokens
    eea = {"DE", "NL", "FR"}
    ubs = parse_providers("Akamai International B.V. (NL), Akamai International B.V. (US), UBS AG (CH), "
                          "UBS AG (US), UBS Group AG (CH), Vercara, LLC (US)")
    assert ("Vercara, LLC", "US") in ubs and len(ubs) == 6
    assert operator_key("Akamai Technologies, Inc.") == operator_key("Akamai International B.V.") == "akamai"
    assert operator_key("UBS Group AG") == "ubs" and operator_key("Amazon.com, Inc.") == "amazon"
    me = self_tokens("UBS AG", ["ubs.com", "credit-suisse.com"])
    assert dns_status(ubs, me, eea) == "pass"                                   # own servers plus independent providers
    assert dns_status([("Swisscom (Schweiz) AG", "CH")], set(), eea) == "pass"
    assert dns_status([("Cloudflare, Inc.", "US")], set(), eea) == "fail"       # one foreign operator alone
    assert dns_status([("Cloudflare, Inc.", "US"), ("Amazon.com, Inc.", "US")], set(), eea) == "partial"
    assert dns_status([("Cloudflare, Inc.", "US"), ("Alibaba Cloud", "SG")], set(), eea) == "pass"   # two jurisdictions
    assert dns_status([("Akamai International B.V.", "NL"), ("Akamai Technologies", "US")], set(), eea) == "fail"  # one operator
    assert dns_status([("Hetzner Online GmbH", "DE"), ("OVH SAS", "NL")], set(), eea) == "partial"  # EEA counts as one
    assert dns_status([("Hetzner Online GmbH", "DE")], set(), eea) == "partial"
    assert hosting_status([("UBS AG", "US")], me, eea) == "pass"                # own network counts with the seat
    assert hosting_status([("Akamai International B.V.", "US")], me, eea) == "fail"


def test_reapply_sovereignty():
    from tlsmap.merge import reapply_sovereignty
    from tlsmap.config import load_settings
    cfg = {**load_settings()["trust_posture"], "eea_countries": ["NL"]}
    checks = [{"check": "sov.dns", "category": "sovereignty", "status": "fail", "value": "UBS AG (CH), Vercara, LLC (US)"},
              {"check": "sov.tld", "category": "sovereignty", "status": "fail", "value": "com"}]
    res = {"tm_cfg": cfg, "entities": [{"key": "organisation:ubs", "kind": "organisation", "name": "UBS AG", "domains": ["ubs.com"]}],
           "hostnames": [{"entity": "organisation:ubs", "hostname": "www.ubs.com", "critical": False, "tm": {}, "tm_checks": checks}],
           "checklog": [{"entity": "organisation:ubs", "hostname": "www.ubs.com", "check": "sov.dns", "status": "fail"}]}
    assert reapply_sovereignty(res) == 1
    assert checks[0]["status"] == "pass" and res["checklog"][0]["status"] == "pass"
    assert res["entities"][0]["posture"]["overall"] is not None

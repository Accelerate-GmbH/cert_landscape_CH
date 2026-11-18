import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from tlsmap.certs import describe, load_cert
from tlsmap.config import load_entities, load_settings
from tlsmap.ct import CertRecord, current_certs, in_scope
from tlsmap.dnscheck import parse_caa, platform_for
from tlsmap.registry import Registry, parse_dn
from tlsmap.scoring import compile_critical, is_critical, score_entity

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=timezone.utc)
REG = Registry()
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
def test_registry_ownership_not_brand():
    assert REG.match("SwissSign AG").zone == "ch"
    assert REG.match("WISeKey").zone == "ch"
    assert REG.match("DigiCert Ireland Limited").zone == "third"   # control in US
    assert REG.match("ZeroSSL GmbH").zone == "third"              # HID Global
    assert REG.match("GlobalSign nv-sa").operator_country == "BE"
    assert REG.match("Buypass AS-983163327").zone == "eea"
    assert REG.match("Nobody Ltd").id == "unknown"


def test_validation_from_issuer_name():
    sw = REG.match("SwissSign AG")
    assert Registry.validation_from_name(sw, "SwissSign RSA TLS DV ICA 2022 - 1") == "DV"
    assert Registry.validation_from_name(sw, "SwissSign RSA TLS OV ICA 2022 - 1") == "OV"
    assert Registry.validation_from_name(REG.match("Let's Encrypt"), "R11") == "DV"
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

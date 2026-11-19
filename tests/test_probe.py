"""Live-check logic against local TLS servers (no network needed)."""

import socket
import ssl
import subprocess
import threading

import pytest

from tlsmap import posture, probe
from tlsmap.config import load_settings

PQ = probe.pq_method() == "python"


@pytest.fixture(scope="module")
def certfile(tmp_path_factory):
    d = tmp_path_factory.mktemp("tls")
    key, crt = d / "k.pem", d / "c.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key),
                    "-out", str(crt), "-days", "1", "-subj", "/CN=localhost"], check=True, capture_output=True)
    return str(crt), str(key)


def _serve(certfile, groups=None, max_version=None):
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(*certfile)
    if groups:
        ctx.set_groups(groups)
    if max_version:
        ctx.maximum_version = max_version
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    s.listen(16)

    def run():
        while True:
            c, _ = s.accept()
            try:
                t = ctx.wrap_socket(c, server_side=True)
                t.recv(1)
                t.close()
            except (OSError, ssl.SSLError):
                pass

    threading.Thread(target=run, daemon=True).start()
    return s.getsockname()[1]


def _endpoint(port, pq=""):
    orig = socket.create_connection
    socket.create_connection = lambda addr, timeout=None: orig(("127.0.0.1", port), timeout=timeout)
    try:
        return probe.endpoint("localhost", "127.0.0.1", 3, pq)
    finally:
        socket.create_connection = orig


def test_untrusted_certificate_is_read_and_flagged(certfile):
    ep = _endpoint(_serve(certfile))
    assert ep["ok"] and ep["valid"] is False and ep["cert"]["subject_cn"] == "localhost"
    assert ep["tls_version"] == "TLSv1.3"
    assert posture.knockout({"endpoints": [ep]}).startswith("invalid certificate")


def test_tls12_only(certfile):
    ep = _endpoint(_serve(certfile, max_version=ssl.TLSVersion.TLSv1_2))
    assert ep["tls_version"] == "TLSv1.2"


@pytest.mark.skipif(not PQ, reason="TLS group selection needs Python >= 3.15 with OpenSSL >= 3.5")
@pytest.mark.parametrize("groups,expected", [
    ("X25519MLKEM768:X25519", "preferred"),
    ("X25519:X25519MLKEM768", "enabled"),
    ("X25519", "no"),
])
def test_post_quantum_preference(certfile, groups, expected):
    ep = _endpoint(_serve(certfile, groups=groups), pq="python")
    assert ep["pq"] == expected


def test_resource_rating_from_endpoints():
    cfg = load_settings().raw["trust_posture"]
    ep = {"ok": True, "valid": True, "tls_version": "TLSv1.3", "pq": "enabled", "scts": ["a", "b"],
          "cert": {"validation": "OV"}, "revocation": {"status": "good", "method": "ocsp"}}
    r = {"endpoints": [ep], "dnssec": True, "caa_found_at": "zg.ch", "caa_issue": ["swisssign.com"],
         "root_zone": "ch", "root_owner": "SwissSign AG", "root_country": "CH", "hosting_zones": ["ch"],
         "tld": "ch", "ech": "none"}
    res = posture.evaluate(r, {"ns_zones": ["ch"], "ns_providers": ["Swisscom (CH)"]}, cfg)
    sc = posture.score(res, cfg)
    assert sc["categories"] == {"ownership": 100, "sovereignty": 100, "security": 75, "privacy": 0}
    assert sc["overall"] == 82  # the worked example in docs/RATING.md


def test_endpoint_never_raises_on_bad_chain(monkeypatch):
    from tlsmap import probe
    monkeypatch.setattr(probe, "_handshake", lambda *a, **k: {"tls_version": "TLSv1.3", "cipher": "x", "group": "", "chain": [b"not a cert"]})
    monkeypatch.setattr(probe, "pq_test", lambda *a, **k: {"pq": "no"})
    out = probe.endpoint("example.ch", "192.0.2.1")
    assert out["ok"] and out["chain_error"] and "cert" not in out

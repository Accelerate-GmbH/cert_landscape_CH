"""Live checks against each endpoint (every A and AAAA address, with SNI).

Per endpoint: TLS version, certificate served (with chain), whether it
validates, post-quantum key exchange, and embedded SCTs. Per certificate:
revocation status via OCSP or CRL.

Run this from a network without a TLS-inspecting proxy. `check_network`
detects interception with canary hosts and refuses to continue.
"""

from __future__ import annotations

import re
import shutil
import socket
import binascii
import ssl
import subprocess
from datetime import datetime, timezone

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509 import ocsp
from cryptography.x509.oid import AuthorityInformationAccessOID, ExtensionOID

from .certs import describe, load_cert
from .http import Http, HttpError
from .registry import UNKNOWN, Registry

PQ_GROUP = "X25519MLKEM768"
DER = getattr(ssl, "_ssl", None)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# -- capabilities ----------------------------------------------------------------
def pq_method() -> str:
    """How post-quantum key exchange can be tested here: 'python', 'openssl' or ''."""
    if hasattr(ssl.SSLContext, "set_groups") and hasattr(ssl.SSLSocket, "group"):
        try:
            ssl.create_default_context().set_groups(PQ_GROUP)
            return "python"
        except (ssl.SSLError, ValueError):
            pass
    exe = shutil.which("openssl")
    if exe:
        out = subprocess.run([exe, "version"], capture_output=True, text=True).stdout
        m = re.search(r"OpenSSL (\d+)\.(\d+)", out)
        if m and (int(m.group(1)), int(m.group(2))) >= (3, 5):
            return "openssl"
    return ""


def ipv6_works(timeout: float = 4) -> bool:
    try:
        with socket.create_connection(("2606:4700:4700::1111", 443), timeout=timeout):
            return True
    except OSError:
        return False


# -- one handshake ---------------------------------------------------------------
def _cert_der(c) -> bytes:
    if isinstance(c, (bytes, bytearray)):
        return bytes(c)
    return c.public_bytes(ssl._ssl.ENCODING_DER)  # Python >= 3.13 Certificate objects


def _handshake(ip: str, hostname: str, timeout: float, verify: bool, groups: str | None = None) -> dict:
    ctx = ssl.create_default_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    if groups:
        ctx.set_groups(groups)
    with socket.create_connection((ip, 443), timeout=timeout) as s:
        with ctx.wrap_socket(s, server_hostname=hostname) as t:
            chain = []
            getter = "get_verified_chain" if verify else "get_unverified_chain"
            if hasattr(t, getter):
                chain = [_cert_der(c) for c in getattr(t, getter)() or []]
            if not chain:
                der = t.getpeercert(binary_form=True)
                chain = [der] if der else []
            return {"tls_version": t.version(), "cipher": (t.cipher() or [""])[0],
                    "group": t.group() if hasattr(t, "group") else "", "chain": chain}


def _pq_openssl(ip: str, hostname: str, groups: str, timeout: float) -> str | None:
    host = f"[{ip}]" if ":" in ip else ip
    try:
        r = subprocess.run(["openssl", "s_client", "-connect", f"{host}:443", "-servername", hostname,
                            "-groups", groups, "-brief"], input="", capture_output=True, text=True,
                           timeout=timeout + 2)
    except subprocess.TimeoutExpired:
        return None
    m = re.search(r"(?:Negotiated TLS1\.3 group|Server Temp Key|Peer Temp Key):\s*([A-Za-z0-9_-]+)", r.stdout + r.stderr)
    return m.group(1) if m else None


def pq_test(ip: str, hostname: str, method: str, timeout: float) -> dict:
    """enabled: server accepts the hybrid PQ group. preferred: server picks it
    when the client offers key shares for X25519 first and the PQ group second."""
    if not method:
        return {"pq": "untested"}
    if method == "python":
        try:
            _handshake(ip, hostname, timeout, False, PQ_GROUP)
            enabled = True
        except (OSError, ssl.SSLError):
            enabled = False
        preferred = False
        if enabled:
            try:
                r = _handshake(ip, hostname, timeout, False, f"*X25519:*{PQ_GROUP}")
                preferred = (r.get("group") or "").lower() == PQ_GROUP.lower()
            except (OSError, ssl.SSLError):
                pass
    else:
        enabled = (_pq_openssl(ip, hostname, PQ_GROUP, timeout) or "").lower() == PQ_GROUP.lower()
        preferred = enabled and (_pq_openssl(ip, hostname, f"*X25519:*{PQ_GROUP}", timeout) or "").lower() == PQ_GROUP.lower()
    return {"pq": "preferred" if preferred else ("enabled" if enabled else "no")}


def scts(cert: x509.Certificate) -> list[str]:
    try:
        ext = cert.extensions.get_extension_for_oid(ExtensionOID.PRECERT_SIGNED_CERTIFICATE_TIMESTAMPS)
        return [s.log_id.hex()[:16] for s in ext.value]
    except x509.ExtensionNotFound:
        return []


def _safe_cert(data):
    """Parse a certificate a server sent; None if it is malformed."""
    try:
        return load_cert(data)
    except (ValueError, TypeError, binascii.Error):
        return None


def endpoint(hostname: str, ip: str, timeout: float = 8, pq: str = "") -> dict:
    """All live checks for one address of one hostname. Never raises: a
    server sending something unexpected is recorded, not fatal for the run."""
    try:
        return _endpoint(hostname, ip, timeout, pq)
    except Exception as e:  # noqa: BLE001
        return {"ip": ip, "family": 6 if ":" in ip else 4, "checked_at": _now(), "ok": False,
                "error": f"{type(e).__name__}: {str(e)[:160]}"}


def _endpoint(hostname: str, ip: str, timeout: float, pq: str) -> dict:
    out: dict = {"ip": ip, "family": 6 if ":" in ip else 4, "checked_at": _now(), "ok": False}
    try:
        r = _handshake(ip, hostname, timeout, True)
        out.update(ok=True, valid=True)
    except ssl.SSLCertVerificationError as e:
        out.update(valid=False, verify_error=(e.verify_message or str(e))[:200])
        try:
            r = _handshake(ip, hostname, timeout, False)
            out["ok"] = True
        except (OSError, ssl.SSLError) as e2:
            out["error"] = f"{type(e2).__name__}: {str(e2)[:160]}"
            return out
    except (OSError, ssl.SSLError) as e:
        out["error"] = f"{type(e).__name__}: {str(e)[:160]}"
        return out
    out.update(tls_version=r["tls_version"], cipher=r["cipher"], group=r["group"])
    certs = [_safe_cert(c) for c in r["chain"]]
    if certs and certs[0] is not None:
        leaf = certs[0]
        out["cert"] = describe(leaf)
        out["scts"] = scts(leaf)
        out["chain_issuers"] = [describe(c)["subject_cn"] for c in certs[1:] if c is not None]
        if any(c is None for c in certs[1:]):
            out["chain_error"] = "malformed certificate in chain"
        out["_chain"] = [d for d, c in zip(r["chain"], certs) if c is not None]   # for revocation, not exported
    elif certs:
        out["chain_error"] = "malformed leaf certificate"
    out.update(pq_test(ip, hostname, pq, timeout))
    return out


# -- revocation ------------------------------------------------------------------
def revocation(chain: list[bytes], http: Http, timeout: float = 10) -> dict:
    """OCSP if the certificate names a responder, otherwise its CRL."""
    if not chain:
        return {"status": "unknown", "method": "none"}
    leaf = _safe_cert(chain[0])
    if leaf is None:
        return {"status": "unknown", "method": "none"}
    issuer = _safe_cert(chain[1]) if len(chain) > 1 else None
    try:
        aia = leaf.extensions.get_extension_for_oid(ExtensionOID.AUTHORITY_INFORMATION_ACCESS).value
        ocsp_urls = [d.access_location.value for d in aia if d.access_method == AuthorityInformationAccessOID.OCSP]
    except x509.ExtensionNotFound:
        ocsp_urls = []
    if ocsp_urls and issuer is not None:
        try:
            req = ocsp.OCSPRequestBuilder().add_certificate(leaf, issuer, hashes.SHA1()).build()
            body = http.post(ocsp_urls[0], req.public_bytes(serialization.Encoding.DER),
                             {"Content-Type": "application/ocsp-request", "Accept": "application/ocsp-response"})
            resp = ocsp.load_der_ocsp_response(body)
            if resp.response_status == ocsp.OCSPResponseStatus.SUCCESSFUL:
                st = resp.certificate_status
                return {"status": {ocsp.OCSPCertStatus.GOOD: "good", ocsp.OCSPCertStatus.REVOKED: "revoked"}.get(st, "unknown"),
                        "method": "ocsp", "url": ocsp_urls[0]}
        except (HttpError, ValueError) as e:
            last = str(e)[:120]
        else:
            last = "ocsp response not successful"
    else:
        last = "no ocsp responder"
    try:
        cdp = leaf.extensions.get_extension_for_oid(ExtensionOID.CRL_DISTRIBUTION_POINTS).value
        urls = [n.value for dp in cdp for n in (dp.full_name or []) if isinstance(n, x509.UniformResourceIdentifier)]
    except x509.ExtensionNotFound:
        urls = []
    for url in urls:
        try:
            crl = x509.load_der_x509_crl(http.get(url, namespace="crl", ttl_hours=12, headers={"Accept": "*/*"}))
            hit = crl.get_revoked_certificate_by_serial_number(leaf.serial_number)
            return {"status": "revoked" if hit else "good", "method": "crl", "url": url}
        except (HttpError, ValueError) as e:
            last = str(e)[:120]
    return {"status": "unknown", "method": "none", "error": last}


# -- interception guard ----------------------------------------------------------
def check_network(canaries: list[str], registry: Registry, timeout: float = 8) -> tuple[bool, str]:
    """True if served canary certificates come from known public CAs."""
    seen = []
    for host in canaries:
        try:
            ip = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)[0][4][0]
        except OSError:
            continue
        r = endpoint(host, ip, timeout)
        if not r.get("cert"):
            continue
        org, cn = r["cert"]["issuer_org"], r["cert"]["issuer_cn"]
        seen.append(f"{host}: {org}")
        if registry.match(org, cn) is UNKNOWN:
            return False, (f"TLS interception suspected: {host} is served with a certificate from "
                           f"'{org}', which is not a public CA. Run the probe from a network "
                           f"without a TLS-inspecting proxy.")
    if not seen:
        return False, "No canary host reachable on port 443; probe skipped."
    return True, "; ".join(seen)

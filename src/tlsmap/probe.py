"""Optional live TLS probe: which certificate does a hostname actually serve?

Run this from a normal network connection. Corporate proxies and some cloud
sandboxes intercept TLS and present their own certificate; `check_network`
detects that with canary hosts and refuses to continue.
"""

from __future__ import annotations

import socket
import ssl

from .certs import describe, load_cert
from .registry import UNKNOWN, Registry


def fetch(hostname: str, port: int = 443, timeout: float = 8) -> dict:
    out: dict = {"hostname": hostname, "ok": False}
    # 1) verified handshake: tells us whether browsers would accept it
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, port), timeout=timeout) as s:
            with ctx.wrap_socket(s, server_hostname=hostname) as t:
                der = t.getpeercert(binary_form=True)
                out.update(ok=True, verified=True, tls_version=t.version(), cipher=t.cipher()[0])
    except ssl.SSLCertVerificationError as e:
        out.update(verified=False, verify_error=e.verify_message or str(e))
        der = None
    except (OSError, ssl.SSLError) as e:
        out.update(error=type(e).__name__ + ": " + str(e)[:200])
        return out
    # 2) unverified handshake to read the certificate even when it is invalid
    if der is None:
        try:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with socket.create_connection((hostname, port), timeout=timeout) as s:
                with ctx.wrap_socket(s, server_hostname=hostname) as t:
                    der = t.getpeercert(binary_form=True)
                    out.update(ok=True, tls_version=t.version(), cipher=t.cipher()[0])
        except (OSError, ssl.SSLError) as e:
            out.update(error=type(e).__name__ + ": " + str(e)[:200])
            return out
    if der:
        out["cert"] = describe(load_cert(der))
    return out


def check_network(canaries: list[str], registry: Registry, timeout: float = 8) -> tuple[bool, str]:
    """True if served canary certificates come from known public CAs."""
    seen = []
    for host in canaries:
        r = fetch(host, timeout=timeout)
        if not r.get("cert"):
            continue
        org = r["cert"]["issuer_org"]
        seen.append(f"{host}: {org}")
        if registry.match(org, r["cert"]["issuer_cn"]) is UNKNOWN:
            return False, (f"TLS interception suspected: {host} is served with a certificate from "
                           f"'{org}', which is not a public CA in the registry. Run the probe from "
                           f"a network without a TLS-inspecting proxy.")
    if not seen:
        return False, "No canary host reachable on port 443; probe skipped."
    return True, "; ".join(seen)

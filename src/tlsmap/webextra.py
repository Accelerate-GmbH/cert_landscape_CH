"""Web checks beyond the TLS handshake: security.txt (RFC 9116) per domain,
HSTS and the redirect from HTTP to HTTPS per host."""
from __future__ import annotations

import re
import socket
import ssl
from datetime import datetime, timezone

from .http import HttpError


def parse_security_txt(text: str) -> dict:
    contact = re.findall(r"(?im)^\s*contact\s*:\s*(\S+)", text)
    exp = re.search(r"(?im)^\s*expires\s*:\s*(\S+)", text)
    return {"contact": contact[:3], "expires": exp.group(1)[:25] if exp else ""}


def security_txt(http, domain: str, now: datetime | None = None) -> dict:
    """Look for /.well-known/security.txt on the domain and on www.<domain>."""
    now = now or datetime.now(timezone.utc)
    for host in (domain, "www." + domain):
        url = f"https://{host}/.well-known/security.txt"
        try:
            body = http.get(url, headers={"Accept": "text/plain, */*"}, namespace="sectxt", ttl_hours=72)
        except Exception:  # noqa: BLE001 - missing, blocked or broken: try the next host
            continue
        text = body[:65536].decode("utf-8", "replace")
        if "<html" in text.lower()[:500] or not re.search(r"(?im)^\s*contact\s*:", text):
            continue  # soft 404 or not a security.txt
        info = parse_security_txt(text)
        status = "no_expires"
        if info["expires"]:
            try:
                exp = datetime.fromisoformat(info["expires"].replace("Z", "+00:00"))
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                status = "valid" if exp > now else "expired"
            except ValueError:
                status = "no_expires"
        return {"url": url, "status": status, **info}
    return {"status": "none"}


def _raw_request(ip: str, port: int, host: str, timeout: float, tls: bool) -> str:
    sock = socket.create_connection((ip, port), timeout=timeout)
    try:
        if tls:
            ctx = ssl.create_default_context()
            ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
            sock = ctx.wrap_socket(sock, server_hostname=host)
        sock.sendall(f"GET / HTTP/1.1\r\nHost: {host}\r\nUser-Agent: tlsmap\r\nConnection: close\r\n\r\n".encode())
        data = b""
        while b"\r\n\r\n" not in data and len(data) < 65536:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
        return data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    finally:
        sock.close()


def http_security(host: str, ip: str, timeout: float = 8) -> dict:
    """HSTS header on HTTPS and what plain HTTP on port 80 does."""
    out: dict = {}
    try:
        head = _raw_request(ip, 443, host, timeout, True)
        m = re.search(r"(?im)^strict-transport-security\s*:\s*(.+)$", head)
        if m:
            age = re.search(r"max-age\s*=\s*\"?(\d+)", m.group(1), re.I)
            out["hsts"] = int(age.group(1)) if age else 0
            out["hsts_sub"] = "includesubdomains" in m.group(1).lower()
            out["hsts_preload"] = "preload" in m.group(1).lower()
        else:
            out["hsts"] = None
    except Exception as e:  # noqa: BLE001 - a broken server must not stop the batch
        out["https_error"] = f"{type(e).__name__}"
    try:
        head = _raw_request(ip, 80, host, timeout, False)
        status = re.match(r"HTTP/\d\.?\d?\s+(\d{3})", head)
        loc = re.search(r"(?im)^location\s*:\s*(\S+)", head)
        code = int(status.group(1)) if status else 0
        out["http_status"] = code
        out["http_redirect_https"] = bool(code in (301, 302, 303, 307, 308) and loc and loc.group(1).lower().startswith("https://"))
    except Exception:  # noqa: BLE001
        out["http_status"] = None          # port 80 closed: no plain-text access
        out["http_redirect_https"] = None
    return out

"""Small HTTP client: disk cache, per-host rate limit, retries with backoff.

Standard library only, so it honours HTTPS_PROXY / SSL_CERT_FILE like any
Python program and runs unchanged on a laptop, a VM or in GitHub Actions.
"""

from __future__ import annotations

import hashlib
import json
import os
import ssl
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class HttpError(Exception):
    def __init__(self, url: str, status: int | None, msg: str):
        super().__init__(f"{status} {msg} for {url}")
        self.url = url
        self.status = status


class Http:
    def __init__(self, cache_dir: Path, user_agent: str, timeout: float = 60,
                 retries: int = 4, min_interval: dict[str, float] | None = None):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.user_agent = user_agent
        self.timeout = timeout
        self.retries = retries
        self.min_interval = min_interval or {}
        self._last: dict[str, float] = {}
        self._locks: dict[str, threading.Lock] = {}
        self._glock = threading.Lock()
        cafile = os.environ.get("SSL_CERT_FILE") or os.environ.get("REQUESTS_CA_BUNDLE")
        self._ctx = ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()
        self.stats = {"requests": 0, "cache_hits": 0, "errors": 0}

    # -- cache ---------------------------------------------------------------
    def _cache_path(self, namespace: str, key: str) -> Path:
        h = hashlib.sha256(key.encode()).hexdigest()
        return self.cache_dir / namespace / h[:2] / f"{h}.bin"

    def _cache_get(self, namespace: str, key: str, ttl_hours: float | None) -> bytes | None:
        p = self._cache_path(namespace, key)
        if not p.exists():
            return None
        if ttl_hours is not None and (time.time() - p.stat().st_mtime) > ttl_hours * 3600:
            return None
        return p.read_bytes()

    def _cache_put(self, namespace: str, key: str, body: bytes) -> None:
        p = self._cache_path(namespace, key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(body)
        tmp.replace(p)

    # -- rate limit ----------------------------------------------------------
    def _wait_turn(self, host: str) -> None:
        interval = self.min_interval.get(host, 0.0)
        if interval <= 0:
            return
        with self._glock:
            lock = self._locks.setdefault(host, threading.Lock())
        with lock:
            now = time.monotonic()
            wait = self._last.get(host, 0) + interval - now
            if wait > 0:
                time.sleep(wait)
            self._last[host] = time.monotonic()

    # -- public --------------------------------------------------------------
    def get(self, url: str, headers: dict[str, str] | None = None, namespace: str = "misc",
            ttl_hours: float | None = 24, cache: bool = True) -> bytes:
        key = url + "|" + json.dumps(sorted((headers or {}).items()))
        if cache:
            hit = self._cache_get(namespace, key, ttl_hours)
            if hit is not None:
                self.stats["cache_hits"] += 1
                return hit
        host = urllib.parse.urlsplit(url).hostname or ""
        hdrs = {"User-Agent": self.user_agent, "Accept": "application/json"}
        hdrs.update(headers or {})
        delay = 2.0
        last_err: Exception | None = None
        for attempt in range(self.retries + 1):
            self._wait_turn(host)
            req = urllib.request.Request(url, headers=hdrs)
            try:
                self.stats["requests"] += 1
                with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as resp:
                    body = resp.read()
                if cache:
                    self._cache_put(namespace, key, body)
                return body
            except urllib.error.HTTPError as e:
                last_err = HttpError(url, e.code, e.reason)
                if e.code in (429, 500, 502, 503, 504) and attempt < self.retries:
                    retry_after = e.headers.get("Retry-After") if e.headers else None
                    sleep = float(retry_after) if retry_after and retry_after.isdigit() else delay
                    time.sleep(min(sleep, 300))
                    delay *= 2
                    continue
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last_err = HttpError(url, None, str(e))
                if attempt < self.retries:
                    time.sleep(delay)
                    delay *= 2
                    continue
                break
        self.stats["errors"] += 1
        assert last_err is not None
        raise last_err

    def post(self, url: str, data: bytes, headers: dict[str, str] | None = None, timeout: float | None = None) -> bytes:
        """Uncached POST (used for OCSP)."""
        host = urllib.parse.urlsplit(url).hostname or ""
        hdrs = {"User-Agent": self.user_agent}
        hdrs.update(headers or {})
        self._wait_turn(host)
        req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
        try:
            self.stats["requests"] += 1
            with urllib.request.urlopen(req, timeout=timeout or min(self.timeout, 15), context=self._ctx) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            self.stats["errors"] += 1
            raise HttpError(url, e.code, e.reason) from None
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            self.stats["errors"] += 1
            raise HttpError(url, None, str(e)) from None

    def get_json(self, url: str, **kw):
        return json.loads(self.get(url, **kw).decode("utf-8"))

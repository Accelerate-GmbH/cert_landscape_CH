"""Read what a certificate itself says: validation level, key, signature."""

from __future__ import annotations

import base64
import hashlib
from datetime import timezone

from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import dsa, ec, ed448, ed25519, rsa
from cryptography.hazmat.primitives.serialization import Encoding
from cryptography.x509.oid import ExtensionOID, NameOID

# CA/Browser Forum reserved policy identifiers
POLICY_LEVELS = {
    "2.23.140.1.1": "EV",
    "2.23.140.1.2.1": "DV",
    "2.23.140.1.2.2": "OV",
    "2.23.140.1.2.3": "IV",
}
# Older CA-specific EV OIDs still seen in the wild (subset; the CABF OID is
# required in EV certificates today, so this is a fallback only).
LEGACY_EV_OIDS = {
    "2.16.756.1.89.1.2.1.1": "SwissSign EV",
    "2.16.840.1.114412.2.1": "DigiCert EV",
    "1.3.6.1.4.1.6449.1.2.1.5.1": "Sectigo EV",
    "1.3.6.1.4.1.4146.1.1": "GlobalSign EV",
}


def load_cert(data: bytes | str) -> x509.Certificate:
    if isinstance(data, str):
        data = data.encode()
    if b"-----BEGIN CERTIFICATE-----" in data:
        return x509.load_pem_x509_certificate(data)
    try:
        return x509.load_der_x509_certificate(data)
    except ValueError:
        return x509.load_der_x509_certificate(base64.b64decode(data))


def _name_attr(name: x509.Name, oid) -> str:
    vals = name.get_attributes_for_oid(oid)
    return vals[0].value if vals else ""


def describe(cert: x509.Certificate) -> dict:
    policies: list[str] = []
    try:
        ext = cert.extensions.get_extension_for_oid(ExtensionOID.CERTIFICATE_POLICIES)
        policies = [p.policy_identifier.dotted_string for p in ext.value]
    except x509.ExtensionNotFound:
        pass
    level = "unknown"
    for oid in policies:
        if oid in POLICY_LEVELS:
            level = POLICY_LEVELS[oid]
            break
    if level == "unknown":
        if any(o in LEGACY_EV_OIDS for o in policies):
            level = "EV"
        elif _name_attr(cert.subject, NameOID.ORGANIZATION_NAME):
            level = "OV"
        elif policies:
            level = "DV"

    sans: list[str] = []
    try:
        san = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        sans = [n.lower() for n in san.value.get_values_for_type(x509.DNSName)]
    except x509.ExtensionNotFound:
        pass

    pub = cert.public_key()
    if isinstance(pub, rsa.RSAPublicKey):
        key_type, key_bits = "RSA", pub.key_size
    elif isinstance(pub, ec.EllipticCurvePublicKey):
        key_type, key_bits = f"EC-{pub.curve.name}", pub.curve.key_size
    elif isinstance(pub, ed25519.Ed25519PublicKey):
        key_type, key_bits = "Ed25519", 256
    elif isinstance(pub, ed448.Ed448PublicKey):
        key_type, key_bits = "Ed448", 448
    elif isinstance(pub, dsa.DSAPublicKey):
        key_type, key_bits = "DSA", pub.key_size
    else:
        key_type, key_bits = type(pub).__name__, 0

    try:
        sig = cert.signature_hash_algorithm.name if cert.signature_hash_algorithm else "none"
    except Exception:  # unsupported algorithm
        sig = "unknown"

    nb = cert.not_valid_before_utc.astimezone(timezone.utc)
    na = cert.not_valid_after_utc.astimezone(timezone.utc)
    der = cert.public_bytes(Encoding.DER)
    return {
        "sha256": hashlib.sha256(der).hexdigest(),
        "validation": level,
        "policies": policies,
        "subject_org": _name_attr(cert.subject, NameOID.ORGANIZATION_NAME),
        "subject_cn": _name_attr(cert.subject, NameOID.COMMON_NAME),
        "issuer_org": _name_attr(cert.issuer, NameOID.ORGANIZATION_NAME),
        "issuer_cn": _name_attr(cert.issuer, NameOID.COMMON_NAME),
        "issuer_country": _name_attr(cert.issuer, NameOID.COUNTRY_NAME),
        "not_before": nb.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "not_after": na.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "validity_days": round((na - nb).total_seconds() / 86400, 1),
        "key_type": key_type,
        "key_bits": key_bits,
        "signature_hash": sig,
        "sans": sans,
    }

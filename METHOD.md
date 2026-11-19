# Method

This file describes data collection and the certificate-landscape scores.
The Trust Posture rating built on top of it is in [docs/RATING.md](docs/RATING.md).
The list of critical services beyond public administrations, with sectors
under the national CIP strategy, is described in
[docs/CRITICAL_SERVICES.md](docs/CRITICAL_SERVICES.md).

Every rule below is implemented in `src/tlsmap/` and every number is set in
`config/settings.toml` or `config/ca_registry.toml`. Results can be
recomputed from the published `hostnames.csv`.

## 1. Entities and domains

- **Cantons**: `config/entities.toml`, one or more domains each.
- **Municipalities**: `data/municipalities_ch.json` (2,110 municipalities with
  website and e-mail domains, from the MXmap project, see NOTICE). Website and
  e-mail domains are both used.
- A municipality domain is dropped if it belongs to a canton, is used by
  another municipality, or is a public mail provider, provided the
  municipality has another domain. Example: several Zug municipalities list
  `zg.ch` as e-mail domain; counting it would give them the canton's
  certificates. If no own domain remains, the entity is kept and marked
  `shared_domain`.
- Additions and corrections: `data/overrides.json`.

## 2. Certificate discovery

For each domain, all unexpired certificates for the domain and its subdomains
are read from Certificate Transparency, via Cert Spotter (preferred, needs an
API key) or crt.sh. The source and the date of its newest entry are recorded
per domain; `ct_lag_days` in `run.json` is the gap between the run and the
newest entry seen.

## 3. One current certificate per hostname

The unit of measurement is the **hostname**, not the certificate. For each
name in the certificates' SAN lists that falls under the entity's domains:

1. keep certificates valid at run time;
2. drop duplicates (precertificate and final certificate);
3. take the most recently issued one as the current certificate.

Renewals therefore count once. Other CAs that also have a valid certificate
for the same name are listed in `other_issuers` (typical for CDNs).

Wildcard names (`*.example.ch`) are one hostname each.

## 4. Hostnames in use

A hostname is **in use** when it resolves to an address in public DNS
(DNS-over-HTTPS, Google with Cloudflare as fallback). Hostnames that do not
resolve (internal systems, retired services) are reported but not scored;
`require_dns = false` scores them too. Wildcard names count as in use.

With `--probe`, the pipeline connects to each hostname in use and the
certificate actually served replaces the CT view for scoring
(`validation_basis = served`).

## 5. Who controls the CA

Attribution has two layers.

**CA owner, from the CCADB.** The issuing CA named in each certificate is
looked up in the Common CA Database (CCADB), which the browser root programs
(Mozilla, Chrome, Microsoft, Apple) use to record which organisation is
accountable for every trusted CA certificate. This gives the CA owner and
its country regardless of the brand printed in the certificate. In the Swiss
data this matters: ZeroSSL, Trustico, GoGetSSL, Gandi and Network Solutions
intermediates belong to Sectigo; QuoVadis, Thawte, GeoTrust, DigiCert Ireland
and Trust Provider B.V. intermediates belong to DigiCert. The CCADB export is
downloaded once a week; its date is recorded in `run.json`
(`ccadb_fetched`). `attribution = ccadb` marks hostnames attributed this way.

**Parent company, from `config/ca_registry.toml`.** Where a CA owner is
controlled by a company in another country, the registry records the
controller with sources:

| CA owner (CCADB) | CCADB country | Controller | Control country | Source |
|---|---|---|---|---|
| SwissSign AG | CH | Swiss Post | CH | Swiss Post press release, 4.10.2021 |
| Sectigo | GB | Sectigo HQ Scottsdale, owned by GI Partners | US | Sectigo, GI Partners |
| GlobalSign nv-sa | BE | GMO GlobalSign Holdings K.K. | JP | BSI audit attestation ETS 081 |

All other CA owners are taken as controlled from their CCADB country. If the
CCADB has no record for an issuing CA, the issuer's O= field is matched
against the registry (`attribution = registry`); if that fails too, the CA
is `unknown` and listed after the run.

The sovereignty zone follows the control country (switch to the CCADB
country with `zone_basis = "operator_country"`): `ch`, `eea` (EU, Iceland,
Liechtenstein, Norway), `third`, or `unknown`. The UK and Japan are `third`.

## 6. Validation level

DV, OV, IV or EV is taken from the CA/Browser Forum policy OID in the
certificate (2.23.140.1.2.1 DV, .2.2 OV, .2.3 IV, .1 EV). To avoid downloading
every certificate, it is read from the registry when a CA only issues DV, or
from the issuing CA's name when that name states the level (for example
"SwissSign RSA TLS OV ICA 2022 - 1"). Otherwise the certificate is downloaded
and parsed. `validation_basis` records which way was used. `--cert-detail all`
downloads every certificate, which also fills key size and signature
algorithm for all hostnames.

## 7. Critical hostnames

A hostname is critical when one of its DNS labels matches a pattern in
`[critical]` (login, SSO, portals, e-services, mail, VPN, payment, tax,
e-voting and similar). The list is a heuristic and part of the published
method; correct it rather than trusting it blindly.

## 8. Scores

Over hostnames in use:

- `sovereignty_score` = 100 × mean zone weight (ch 1.0, eea 0.5, third 0,
  unknown 0).
- `assurance_score` = 100 × mean validation weight (OV, IV, EV 1.0; DV 0).
- `critical_sovereignty_score`, `critical_assurance_score`: the same over
  critical hostnames.

Scores are shares, so 77 means 77% of the hostnames in use. For the
map-compatible `data.min.json`, a score of 0 is written as 1 because the
existing frontends treat 0 as "no data".

## 9. Good-practice checks

| Check | Passes when |
|---|---|
| `caa_present` | the entity's main domain (or a parent) has a CAA record |
| `caa_swiss_only` | every CA allowed by CAA is in zone `ch` |
| `critical_identity_validated` | all critical hostnames in use have OV/EV |
| `no_foreign_concentration` | no non-Swiss CA holds more than 80% (from 5 hostnames) |
| `no_expiring` | no current certificate expires within 14 days; skipped when the CT source lags more than 7 days |
| `no_weak_crypto` | no RSA key under 2048 bits and no SHA-1 signature, among certificates parsed |

## 10. Context fields

- `automated_share`: certificates valid for 100 days or less (ACME-style).
- `platform`: CNAME target on a known third-party platform (`[platforms]`).
- `net_country`, `asn`: registration country and network of the first
  address, from Team Cymru's IP-to-ASN service. This is where the network is
  registered, not necessarily where the server stands.

## Known limits

- CT shows certificates that were issued, not necessarily deployed; DNS
  resolution narrows this, the live probe settles it.
- Certificates for internal names that do not resolve publicly are out of the
  scores but listed in `hostnames.csv`; they still show which CA an
  administration buys from.
- Parent companies are recorded only where sourced. A CA owner controlled
  by an undisclosed parent elsewhere would be attributed to its CCADB country.

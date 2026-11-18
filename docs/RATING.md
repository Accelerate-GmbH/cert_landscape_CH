# TrustMark CH rating – proposal v0.1 (draft for discussion)

This document proposes how the TrustMark CH checks are combined into a
rating. It implements the four check categories of the TrustMark CH concept
(V 0.3, August 2026) and the requirements stated there: checks are automated,
run by a party external to the checked resource, combine into a weighted
compound score, and every check execution is logged.

All weights and thresholds below are parameters in `config/settings.toml`
(`[trustmark]`). They are proposals for the body that will own the standard
to confirm or change.

## 1. What is rated

A **resource** is a hostname under an entity's domain that resolves in public
DNS (for example `www.zg.ch`, `login.stadtzug.ch`). Hostnames come from
Certificate Transparency; see [METHOD.md](../METHOD.md) for discovery.

An **endpoint** is one address (A or AAAA record) of a resource. Live checks
connect to every endpoint with the resource's name as SNI, because a resource
is only as trustworthy as its weakest address.

A resource is **critical** when its name indicates login, portals, e-services,
mail, VPN, payment, tax or voting (`[critical]` in the settings).

## 2. Checks

Each check gives **pass** (1 point), **partial** (0.5), **fail** (0) or
**n/a** (not assessable; excluded from the score).

### A. Ownership visibility and protection

| ID | Check | Pass | Partial | Fail | Weight |
|---|---|---|---|---|---|
| own.identity | Identity-validated certificate on every endpoint | all endpoints serve OV or EV | some do | none (DV only) | 3 |
| own.revocation | Live revocation status, checked by the auditor (browsers mostly don't) | OCSP or CRL says good for all | – | – (revoked is a knock-out) | 2 |
| own.dnssec | DNSSEC validates the A/AAAA answer | validated | – | not signed or not validating | 2 |
| own.caa | CAA record restricts which CAs may issue | CAA found for the name or a parent up to the entity domain | – | none | 1 |
| own.ct | Certificate is logged in Certificate Transparency | at least 2 embedded SCTs on every endpoint | 1 SCT | none | 1 |

### B. Technology sovereignty

Domicile means the country of the company that controls the service. Swiss
earns a pass; EU/EEA earns a partial; any other country a fail.

| ID | Check | Basis | Weight |
|---|---|---|---|
| sov.ca | Domicile of the issuing CA, defined by the root of the chain | CA owner of the root certificate in the CCADB, plus sourced parent companies | 3 |
| sov.dns | Domicile of the DNS provider | network (AS) of the entity domain's authoritative name servers | 2 |
| sov.hosting | Domicile of the hosting provider | network (AS) of every endpoint address | 2 |
| sov.tld | Swiss top-level domain | `.ch` or `.swiss` pass, anything else fails | 1 |

Network domicile comes from the registration country of the autonomous
system (Team Cymru IP-to-ASN). A hyperscaler region in Zurich still belongs
to a US-registered network and counts as US: the check measures who controls
the infrastructure, not where the server stands.

### C. Connection security

| ID | Check | Pass | Partial | Fail | Weight |
|---|---|---|---|---|---|
| sec.tls13 | TLS 1.3 | every endpoint negotiates TLS 1.3 | some do | none | 1 |
| sec.pqc | Post-quantum key exchange enabled and preferred | every endpoint accepts X25519MLKEM768 and chooses it when the client offers X25519 first | accepted but not preferred, or not on all endpoints | not accepted | 1 |

### D. Connection privacy

| ID | Check | Pass | Fail | Weight |
|---|---|---|---|---|
| prv.ech | Encrypted Client Hello configured in DNS | HTTPS record with a structurally valid ECHConfigList (version 0xfe0d) | no HTTPS record, no `ech`, or invalid config | 1 |

### Knock-outs

A resource scores **0 overall** (category scores are still shown) when any
endpoint serves a certificate that does not validate (expired, wrong name,
untrusted chain) or one that is revoked. Users are exposed to these failures
directly, so no other strength should compensate for them.

## 3. From checks to scores

**Category score** of a resource (0–100): the weighted share of points in
that category, over the checks that could be assessed.

**Overall score** of a resource (0–100): the weighted mean of its category
scores.

| Category | Weight | Reasoning |
|---|---|---|
| Ownership visibility and protection | 30% | who stands behind the resource, and whether that can be verified |
| Technology sovereignty | 30% | the campaign's core question: who controls the stack |
| Connection security | 25% | baseline protection of every connection |
| Connection privacy | 15% | ECH is still early; lower weight until it is widely deployable |

Categories that could not be assessed (for example connection security
without a live probe) are left out and the remaining weights are
normalised. The rating shows which categories were assessed.

**Traffic light**, per category and overall: **green** from 80, **yellow**
from 50, **red** below 50.

## 4. From resources to cantons and municipalities

An entity's scores are the weighted mean over its resources, with critical
resources counting **three times**. The rating also reports, per check, how
many resources passed, partly passed and failed, the distribution of green,
yellow and red resources, and the number of knock-outs.

**TrustMark eligible** (proposal for the later signal): no knock-out and all
four categories green.

## 5. Logging

Every check execution is written to `checks.jsonl`, one line per resource and
check: time of the check, entity, hostname, check ID, category, result,
measured value, method (for example `tls`, `ocsp`, `dns-ad`, `ccadb-root`)
and evidence. Endpoint-level details (address, TLS version, group, SCTs,
revocation method, certificate fingerprint) are in `endpoints.csv`. Together
they let anyone retrace a score and are the basis for signed measurements
later.

## 6. Examples

| Resource | Situation | Result |
|---|---|---|
| A canton login portal | SwissSign OV, DNSSEC, CAA, 2 SCTs; Swiss DNS and hosting; TLS 1.3; PQ enabled but not preferred; no ECH | ownership 100, sovereignty 100, security 75, privacy 0 → overall 79, yellow |
| A municipal website | Let's Encrypt DV, no DNSSEC, no CAA, 2 SCTs; Swiss DNS, hosting on a US CDN; TLS 1.3, PQ preferred; no ECH | ownership 33, sovereignty 38, security 100, privacy 0 → overall 46, red |
| Any resource with an expired certificate | – | knock-out, overall 0, red |

## 7. Open questions for the standard's owners

1. **Weights.** Should sovereignty weigh as much as ownership, and privacy less while ECH is rare?
2. **EEA partial credit.** Is an EU/EEA provider half as good as a Swiss one, or should only Swiss count?
3. **DV with automation.** Should automated short-lived DV certificates earn partial identity credit?
4. **Hyperscaler regions.** Should Swiss regions of foreign clouds count as Swiss for hosting, given contractual or legal assurances?
5. **TLD.** Should `.li` (Liechtenstein, same registry operator) count?
6. **Revocation unknown.** When no OCSP responder or CRL is reachable, is that n/a (current proposal) or a fail?
7. **PQ "preferred".** The test requires the server to choose the hybrid group when the client lists X25519 first. Is "enabled" enough for v1?
8. **Thresholds.** Green from 80 or from 90?

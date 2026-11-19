# Trust Posture rating – proposal v0.1 (draft for discussion)

This document proposes how the Trust Posture checks are combined into a
rating. It implements the four check categories of the Trust Posture concept
(V 0.3, August 2026) and the requirements stated there: checks are automated,
run by a party external to the checked resource, combine into a weighted
compound score, and every check execution is logged.

All weights and thresholds below are parameters in `config/settings.toml`
(`[trust_posture]`). They are proposals for the body that will own the standard
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
earns a pass; EU/EEA earns a partial; any other country a fail. The DNS
check also counts how the zone is spread over independent operators (rule
below).

| ID | Check | Basis | Weight |
|---|---|---|---|
| sov.ca | Domicile of the issuing CA, defined by the root of the chain | CA owner of the root certificate in the CCADB, plus sourced parent companies | 3 |
| sov.dns | Control and spread of the DNS operation (rule below) | operator and network (AS) of the entity domain's authoritative name servers | 2 |
| sov.hosting | Domicile of the hosting provider; the organisation's own network counts with its seat | network (AS) of every endpoint address | 2 |
| sov.registrar | Domicile of the registrar (from 19 November 2026) | RDAP of the registry (rdap.nic.ch for .ch/.li, IANA bootstrap otherwise); for gTLDs the country from the registrar's RDAP or `config/registrars.json`. CH pass, EU/EEA partial, otherwise fail, unknown not assessed | 1 |
| sov.tld | Swiss top-level domain | `.ch` or `.swiss` pass, anything else fails | 1 |

Network domicile comes from the registration country of the autonomous
system (Team Cymru IP-to-ASN). A hyperscaler region in Zurich still belongs
to a US-registered network and counts as US: the check measures who controls
the infrastructure, not where the server stands.

A network that belongs to the rated organisation itself (its name in the AS
name, for example `UBS AG` for ubs.com) counts with the organisation's seat,
whatever country the network is registered in.

Name servers (sov.dns), from 19 November 2026:

| Status | Rule |
|---|---|
| pass | all name servers at the organisation itself or with Swiss operators, **or** the zone is spread over at least two independent operators, one of them local (own or Swiss), **or** over independent operators in at least two jurisdictions (for example USA and Asia; the EU/EEA counts as one) |
| partial | several independent operators within one foreign jurisdiction; or all within the EU/EEA |
| fail | a single foreign operator outside the EU/EEA serves the zone alone |

Independent operators are told apart by the operator in the AS name
(`Akamai International B.V.` and `Akamai Technologies, Inc.` are one
operator). Spreading a zone over independent operators means no single
provider can answer for it alone; together with a local operator the
organisation keeps control. Example: ubs.com is served by UBS's own name
servers, Akamai and Vercara, which is a pass.

Hosting (sov.hosting) keeps the domicile rule (all local = pass, local or
EU/EEA = partial, otherwise fail), with the organisation's own network
counted as local.

The rule is applied again at every merge from the stored name-server and
network data (`tlsmap merge`), so a change takes effect without measuring
again.

### C. Connection security

| ID | Check | Pass | Partial | Fail | Weight |
|---|---|---|---|---|---|
| sec.tls13 | TLS 1.3 | every endpoint negotiates TLS 1.3 | some do | none | 1 |
| sec.hsts | HSTS and no plain-text access (from 19 November 2026) | HSTS max-age of at least 180 days, and port 80 redirects to https:// or is closed | one of the two | neither | 1 |
| sec.pqc | Post-quantum key exchange offered and preferred | every endpoint accepts X25519MLKEM768 and chooses it when the client offers X25519 first (preferred) | accepted when offered alone but not chosen over X25519 (offered), or not on all endpoints | not accepted | 1 |

Why "offered" only earns a partial: Chrome, Edge, Firefox, Safari and
OpenSSL 3.5 put X25519MLKEM768 first, so a server that merely accepts it
already protects those connections. Clients that list the classical group
first (older libraries, apps, APIs, server-to-server connections) only get
post-quantum protection from a server that prefers it. The draft therefore
keeps "offered and preferred" as the requirement from the Trust Posture
fundamentals, and gives half the points for "offered" (decided
19 November 2026).

### Hosts that do not answer

A host that resolves in DNS but answers over HTTPS on none of its addresses
keeps its rating, which then rests on the DNS checks only; the connection
checks are not assessed. Such hosts are marked "not reachable" on the map
and in `hostnames.csv` (`unreachable`), so the score is not mistaken for a
rated live service (decided 19 November 2026; 1,392 hosts in the first full
run).

### D. Connection privacy

| ID | Check | Pass | Fail | Weight |
|---|---|---|---|---|
| prv.ech | Encrypted Client Hello configured in DNS | HTTPS record with a structurally valid ECHConfigList (version 0xfe0d) | no HTTPS record, no `ech`, or invalid config | 1 |

### Knock-outs

A resource scores **0 overall** (category scores are still shown) when any
endpoint serves a certificate that does not validate (expired, wrong name,
untrusted chain) or one that is revoked. Users are exposed to these failures
directly, so no other strength should compensate for them.

An incomplete chain (the server does not send its intermediate certificate)
is not a knock-out: most browsers repair it on their own. It is reported per
endpoint in `endpoints.csv` (`verify_error`).

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

**Trust Posture eligible** (proposal for the later signal): no knock-out and all
four categories green.

## 5. Sectors and critical services

Organisations from the host list are grouped by the sectors and sub-sectors
of the national strategy for the protection of critical infrastructures
(SKI, BABS). Each host has a service type; criticality follows from sector
and service type (proposal, can be overridden per host):

| Sector | Critical service types |
|---|---|
| Finance | login, transaction, API |
| Health | customer portal (patient portal, EPD, referrers), login |
| Energy | customer portal, remote access |
| Information and communication | login, customer portal |
| Transport | transaction (ticketing), API |
| Authorities | customer portal (e-government), login, API (e-ID/swiyu) |
| Other sectors | login, customer portal, remote access |

The sector view groups the list by sector, sub-sector, service type or
canton of the operator's seat, each split into critical and other services,
with cantons and municipalities as benchmark rows. A group is only shown
with at least five organisations, and the share of low-confidence rows is
shown next to it. Organisations appear by name only if they are marked
public in the list; at present all rows are public, and each group lists
its hosts with a drill-down to every check.

## 6. Logging

Every check execution is written to `checks.jsonl`, one line per resource and
check: time of the check, entity, hostname, check ID, category, result,
measured value, method (for example `tls`, `ocsp`, `dns-ad`, `ccadb-root`)
and evidence. Endpoint-level details (address, TLS version, group, SCTs,
revocation method, certificate fingerprint) are in `endpoints.csv`. Together
they let anyone retrace a score and are the basis for signed measurements
later.

## 7. Examples

| Resource | Situation | Result |
|---|---|---|
| A canton login portal | SwissSign OV, DNSSEC, CAA, 2 SCTs; Swiss DNS and hosting; TLS 1.3; PQ enabled but not preferred; no ECH | ownership 100, sovereignty 100, security 75, privacy 0 → overall 79, yellow |
| A municipal website | Let's Encrypt DV, no DNSSEC, no CAA, 2 SCTs; Swiss DNS, hosting on a US CDN; TLS 1.3, PQ preferred; no ECH | ownership 33, sovereignty 38, security 100, privacy 0 → overall 46, red |
| Any resource with an expired certificate | – | knock-out, overall 0, red |

## 8. Open questions for the standard's owners

1. **Weights.** Should sovereignty weigh as much as ownership, and privacy less while ECH is rare?
2. **EEA partial credit.** Is an EU/EEA provider half as good as a Swiss one, or should only Swiss count?
3. **DV with automation.** Should automated short-lived DV certificates earn partial identity credit?
4. **Hyperscaler regions.** Should Swiss regions of foreign clouds count as Swiss for hosting, given contractual or legal assurances?
5. **TLD.** Should `.li` (Liechtenstein, same registry operator) count?
6. **Revocation unknown.** When no OCSP responder or CRL is reachable, is that n/a (current proposal) or a fail?
7. **PQ "preferred".** The test requires the server to choose the hybrid group when the client lists X25519 first. Is "enabled" enough for v1?
8. **Thresholds.** Green from 80 or from 90?
9. **Incomplete chains.** In the first Zug run, 15 of 313 endpoints did not send their intermediate certificate. Knock-out, a failed check, or report only (current proposal)?
10. **Critical services.** Should DV on a critical service turn the ownership category red regardless of the other checks?


## Mail (from November 2026)

Mail is rated per domain with its own checks and reported next to the web
Trust Posture (map metric "Mail"); it does not change the web rating.
Domains without MX are not rated; municipalities that only share another
domain are left out.

| ID | Check | Pass | Partial | Fail | Weight |
|---|---|---|---|---|---|
| mail.mx | Domicile of the mail servers' networks (own network counts with the seat) | all local | local or EU/EEA | otherwise | 2 |
| mail.starttls | STARTTLS on port 25 with a certificate valid for the server | all TLS 1.3 | TLS 1.2, or only some servers | no STARTTLS | 2 |
| mail.transport | Encrypted delivery enforced | DANE (TLSA, DNSSEC-validated) on all MX, or MTA-STS mode enforce | MTA-STS testing, or DANE on some MX | none | 2 |
| mail.tlsrpt | TLS reporting configured | `_smtp._tls` TXT `v=TLSRPTv1` | | missing | 1 |
| mail.dmarc | DMARC policy | `p=reject` | `p=quarantine` | `p=none` or missing | 2 |
| mail.spf | SPF policy (redirects followed) | `-all` | `~all` | `?all`, `+all` or missing | 1 |

STARTTLS is tested once per mail server from the GitHub runner (port 25 is
reachable there, tested 19 November 2026); a server that does not answer is
not assessed. An entity's mail value is the mean of its rated mail domains.


## security.txt (own.sectxt, from 19 November 2026)

Category ownership & protection, weight 1. `/.well-known/security.txt` on
the entity domain or `www.<domain>` with a `Contact:` line (RFC 9116): with a
valid `Expires:` pass, expired or without `Expires:` partial, missing fail.
Checked per domain and applied to the domain's hosts, like CAA and DNSSEC.

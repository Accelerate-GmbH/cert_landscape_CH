# cert_landscape_CH

Which certificate authorities do Swiss public administrations depend on, and
how well are their online services protected?

**Map: https://accelerate-gmbh.github.io/cert_landscape_CH/** (German, French,
Italian, English)

`tlsmap` is an open pipeline that answers this for all 26 cantons and about
2,100 municipalities and the federal administration (per department). It reads
Certificate Transparency logs, works out which certificate each hostname uses
today, checks the hostname in DNS, and attributes every certificate to the
company that controls the issuing CA. All rules and weights are in
`config/` and documented in [METHOD.md](METHOD.md).

## Trust Posture checks

The pipeline runs the checks of the Trust Posture concept for every hostname
in use, against every address (A and AAAA) with SNI:

| Category | Checks |
|---|---|
| Ownership visibility and protection | OV/EV certificate on all endpoints, live revocation (OCSP/CRL), DNSSEC, CAA, CT (embedded SCTs) |
| Technology sovereignty | domicile of the CA (by its root), DNS provider, hosting network; Swiss TLD |
| Connection security | TLS 1.3, post-quantum key exchange (X25519MLKEM768) enabled and preferred |
| Connection privacy | Encrypted Client Hello configured in DNS |

How the results become scores, traffic lights and a rating per canton and
municipality is proposed in [docs/RATING.md](docs/RATING.md) (draft v0.1, for
discussion). Every check execution is logged in `checks.jsonl`.

## What it measures

Per canton and municipality:

- **Sovereignty score**: share of hostnames in use whose CA is controlled from
  Switzerland (EEA counts half, everything else zero; editable).
- **Assurance score**: share of hostnames with identity-validated certificates
  (OV or EV) instead of domain-validated (DV), overall and for critical
  services (login, portals, mail, VPN, e-government).
- **Good-practice checks**: CAA record present and restricted to Swiss CAs,
  critical services on OV/EV, no foreign CA above 80%, no expiring
  certificates, no weak keys.
- **Context**: CA mix, automation share (short-lived ACME certificates),
  third-party platforms (via CNAME), network country of the hosting.

## Critical services beyond public administrations (draft)

A list of the 1,000 most important Swiss hostnames across public,
semi-public and private operators (banks, insurers, hospitals, energy,
telecoms, transport, food supply, media), each with its operator and UID from
the UID register, its sector and sub-sector under the national CIP strategy
(SKI) of 16 June 2023, its service type and whether it counts as critical, is
in `data/critical_services/`. How it was built and enriched is documented in
[docs/CRITICAL_SERVICES.md](docs/CRITICAL_SERVICES.md).

The list is part of every run:

- **Hosts, not whole domains.** Each listed host is rated as a service with
  the twelve Trust Posture checks. Facts that belong to the domain (DNSSEC
  signing of the zone, name servers, CAA) are read from the host's
  registrable domain. Other subdomains of an operator are not rated, so the
  results stay limited to the services judged critical.
- **No double measurement.** 77 listed hosts belong to cantons or
  municipalities (for example `www.zh.ch`). They are measured there and
  linked; the list keeps its own sector, service type and criticality.
- **Aggregates only.** All rows are `sichtbarkeit = aggregat`: the map shows
  results per sector, sub-sector, service type and canton of the operator's
  seat, never per host, and only from five organisations per group. The
  share of rows with low confidence (`sicherheit = tief`) is shown next to
  each aggregate.
- **Verified every month.** `tlsmap verify-list` checks that each host still
  resolves and answers over HTTPS and that its source page still links it.
  Results are in `data/critical_services/verification.md`; hosts failing
  twice in a row are listed for review. The list itself is only changed by
  hand.

## How it differs from a count of certificates

| | Count of CT entries | tlsmap |
|---|---|---|
| Unit | every certificate ever logged in the window | one hostname, its current certificate |
| Renewals | each 90-day renewal counts again | counted once |
| Hostnames that no longer exist | counted | reported separately, not scored |
| CA country | country printed in the certificate | CA owner from the CCADB (the browsers' CA database), plus sourced parent companies |
| DV / OV / EV | inferred | read from the certificate policy OIDs |
| Domains per municipality | one | website and e-mail domains, shared domains removed |
| Freshness | not stated | source and lag of the CT data recorded per run |

## Quick start

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e .
tlsmap run --canton ZG                  # one canton and its municipalities
tlsmap run --probe                      # all cantons and municipalities, with live TLS check
tlsmap diff output/2026-10-01/results.json output/2026-11-01/results.json --changed-only
```

Hostnames are discovered via crt.sh, which is free but slow (about 25 seconds
per domain) and in November 2026 lagged the logs by about five weeks. The
live probe (`--probe`) then reads the certificate each hostname serves today,
so the scores are current even when crt.sh is behind; only hostnames created
in the last weeks can be missing. The lag is recorded in `run.json`. With a
paid Cert Spotter API key (`CERTSPOTTER_API_KEY`) discovery is current too.

`--probe` must run from a network without a TLS-inspecting proxy. The
pipeline tests canary hosts first and refuses to probe if certificates are
being replaced.

## Critical infrastructure host list

Besides administrations, the pipeline rates organisations from a host list
(`data/hosts_ch.csv`, format in `data/hosts_ch.template.csv`): one row per
host with organisation, UID, sector and sub-sector (SKI strategy, BABS),
service type (`login`, `kundenportal`, `transaktion`, `api`, `fernzugriff`,
`email`, `website`), criticality, seat and visibility. Only the listed hosts
are rated, not every subdomain of the organisation.

Visibility per organisation:

| `sichtbarkeit` | Map and public files | Sector aggregates |
|---|---|---|
| `oeffentlich` | name, results and drill-down | included |
| `aggregat` (default) | not shown | included |
| `intern` | not shown | not included |

Sector values are only published from five organisations per sector on
(`min_orgs_per_sector`), so no single result can be read from them. Complete
results, including non-public organisations, are written to
`output/<date>/restricted/`; that folder is never committed and the
workflow keeps it as a 90-day artifact. While the host list itself sits in
this repository, the repository must stay private.

## Output

Each run writes `output/<date>/` and copies it to `output/latest/`:

| File | Content |
|---|---|
| `entities.csv` | one row per canton / municipality with scores and checks |
| `hostnames.csv` | one row per hostname: certificate, CA, owner, DNS, platform |
| `results.json` | everything above plus CAA records, zones, Trust Posture ratings |
| `endpoints.csv` | one row per address probed: TLS version, group, PQ, certificate, SCTs, revocation |
| `checks.jsonl` | log of every check execution: time, resource, check, result, method, evidence |
| `export.xlsx` | the same as a workbook, including the CA registry and run metadata |
| `data.min.json` | same shape as the existing map frontends (mxmap / sslmap), counted per hostname |
| `run.json` | sources, CT lag, config hashes, versions |

A sample run for canton Zug is in `samples/zug/`.

## Map

`web/` is a static map (Leaflet, no tracking, no tile server) in German,
French, Italian and English. It has two views, switched at the top right
(`?view=simple` or `?view=expert` in the link):

- **Simple** for readers without background: the Trust Posture and its four
  areas in plain words, a verdict per traffic light, the three checks most
  often missing with why they matter, and where certificates, servers and DNS
  sit.
- **Expert** with all indicators (including the certificate metrics of the
  original model: sovereignty, identity validation, CAA, good practice),
  formulas, weights, raw values and all twelve checks in the sector matrix.

The **Explanations** panel describes what the map shows, the traffic light,
the four areas, the twelve checks (why they matter, how they are measured,
weight and source), the critical-services layer, data and updates, and what
the rating does not say, at the depth of the chosen view.

Levels are cantons, municipalities and sectors. The federal administration
has no area of its own: a box at the top right of the map shows its overall
value and opens a list of departments (plus Federal Chancellery, and courts
and parliament), each with the same drill-down as a canton. The search
suggests cantons, municipalities, departments, domains and single hostnames
while typing (`search.json`, administrations only; hosts of the
critical-services list are not searchable). The sector view compares
sectors, sub-sectors, service types or cantons of seat (critical and other
services) with cantons and municipalities; organisations appear as grouped
symbols per canton or place and can be searched by name. Every traffic light
can be clicked and traced down to the single hostname, its measured values
and links to verify them independently (crt.sh, SSL Labs, dns.google,
DNSViz, bgp.he.net). The footer links to the method, the rating, the data of
the latest run (`output/latest/` on GitHub: `entities.csv`, `hostnames.csv`,
`results.json`, `endpoints.csv`, `checks.jsonl`, `export.xlsx`) and the
critical-services list (`data/critical_services/`, method in
[docs/CRITICAL_SERVICES.md](docs/CRITICAL_SERVICES.md)). The `publish map`
workflow deploys it to GitHub Pages with the latest `output/latest/map.json`.
Local preview:

```bash
cp output/latest/map.json web/data/map.json
cd web && python -m http.server 8000      # then open http://localhost:8000
```

## Corrections

- CA owners come from the CCADB. A parent company in another country goes in
  `config/ca_registry.toml`, with a source.
- Missing domains for an entity (schools, portals): `data/overrides.json`.
- Hostname operated by someone else under the entity's name: `exclude_hosts`
  in `data/overrides.json`, with a reason.
- What counts as critical, scoring weights, thresholds: `config/settings.toml`.

Issues and pull requests are welcome.

## Credits

This project builds on the work and data of others:

- **MXmap** by David Huser and the MXmap project
  ([mxmap-ch](https://github.com/mxmap/mxmap-ch),
  [secassure2026](https://github.com/mxmap/secassure2026), MIT): the list of
  Swiss municipalities with their website and e-mail domains, and the idea of
  mapping municipal infrastructure dependencies. The map's data format follows
  mxmap-ch.
- **sslmap.nbrt.ch**, the first map of Swiss public-sector TLS certificates,
  which prompted this pipeline.
- **Common CA Database** ([CCADB](https://www.ccadb.org)), run by the browser
  root programs: who owns each certificate authority.
- **Certificate Transparency** logs, queried through
  [crt.sh](https://crt.sh) (Sectigo) and
  [Cert Spotter](https://sslmate.com/ct_search_api/) (SSLMate).
- **DNS-over-HTTPS** from [Google Public DNS](https://developers.google.com/speed/public-dns)
  and [Cloudflare](https://developers.cloudflare.com/1.1.1.1/).
- **UID register** of the Federal Statistical Office, public web service
  ([uid.admin.ch](https://www.uid.admin.ch)): operator names, UIDs and seats
  for the critical-services list.
- **National CIP strategy** (BBl 2023 1659) and the sector list of the
  Federal Office for Civil Protection
  ([babs.admin.ch](https://www.babs.admin.ch/de/die-kritischen-infrastrukturen)).
- **IP-to-ASN mapping** from [Team Cymru](https://www.team-cymru.com/ip-asn-mapping).
- **Verification links** in the map point to [crt.sh](https://crt.sh),
  [Qualys SSL Labs](https://www.ssllabs.com/ssltest/),
  [dns.google](https://dns.google), [DNSViz](https://dnsviz.net) and
  [Hurricane Electric BGP Toolkit](https://bgp.he.net).
- **Boundaries** from [swiss-maps](https://github.com/interactivethings/swiss-maps)
  (Interactive Things), based on swisstopo data.
- **Software**: [Leaflet](https://leafletjs.com) (BSD-2-Clause),
  [topojson-client](https://github.com/topojson/topojson-client) (ISC),
  [cryptography](https://cryptography.io) (Apache-2.0/BSD),
  [openpyxl](https://openpyxl.readthedocs.io) (MIT), Python and OpenSSL.

Details and licence texts: [NOTICE](NOTICE).

## Licence

MIT, see [LICENSE](LICENSE). Third-party data and code: see [NOTICE](NOTICE).

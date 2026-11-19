# Critical digital services in Switzerland (draft v0.1)

Cantons and municipalities cover only part of what Switzerland depends on.
This document describes how a list of the **1,000 most important Swiss
hostnames** across public, semi-public and private operators was built and
enriched, so that the pipeline can later show the certificate landscape per
sector and per critical service.

The list is a first version. Selection and weighting are judgement calls; they
are written down here so they can be challenged and corrected.

## Files

| File | Content |
|---|---|
| `data/critical_services/critical_services_ch.csv` | the 1,000 hostnames with operator, UID, SKI sector, service type, criticality and quality flag |
| `data/critical_services/hosts_top1000.csv` | the selection step's output: rank, hostname, operator label, tier, host type, justification |
| `data/critical_services/orgs.txt` | about 470 organisations with domain, sector, ownership, tier (1–4) and justification |
| `data/critical_services/admin_hosts.txt` | curated hostnames of the federal administration (`admin.ch`) |
| `data/critical_services/orgmap.txt` | operator label → name searched in the UID register, SKI sector and sub-sector, note |
| `data/critical_services/quality_by_block.json` | rows with low confidence per block of 100, with the main reasons |
| `tools/critical_services/` | the scripts for both steps |

Column values in `critical_services_ch.csv` are in German, as delivered to the
Swiss stakeholders.

## Step 1: selecting the 1,000 hostnames

1. **Organisations.** About 470 organisations were listed by hand across the
   sectors of the national CIP strategy (see step 2): federal offices, all 26
   cantons, the larger cities, all 24 cantonal banks and the systemically
   important banks, financial market infrastructure, insurers and health
   insurers, hospitals, energy utilities and grid operators, telecoms and
   trust service providers, public transport, airports and logistics, food
   retail and wholesale, media, universities, and international organisations
   based in Switzerland. Each got a **tier** from 1 (failure affects the whole
   country) to 4 (supporting role) and a one-line justification. Tiers are a
   judgement, not an official classification; the federal CIP inventory is
   not public.
2. **Hostnames per organisation.** The main website (`www.` or the bare
   domain) plus 20 common service labels were looked up in DNS: `login`,
   `auth`, `id`, `sso`, `account`, `ebanking`, `e-banking`, `netbanking`,
   `banking`, `online`, `portal`, `my`, `mein`, `kunden`, `customer`, `app`,
   `api`, `shop`, `secure`, `webmail`. A random label was resolved first; where
   it resolved too (wildcard DNS, 14 domains), only the main website was kept,
   because any label would have matched.
3. **Federal administration.** Hostnames under `admin.ch` (AGOV, eIAM,
   swiyu registers, ePortal, Passar, VAT filing, sedex and others) were taken
   from a Certificate Transparency export of `admin.ch`, without test,
   integration and internal names, and given their own justification.
4. **Ranking.** Score = 10 × tier + weight of the host type (website and
   login 0, portals 2, API/app/shop 5, webmail 25). Ties are broken by
   ownership (public before semi-public before private), then sector. The
   first 1,000 hostnames that resolve in public DNS (four attempts) form the
   list; ten `admin.ch` names that do not resolve publicly were dropped.

Scripts: `probe.py` (DNS), `assemble.py` (candidates and justifications),
`finalize.py` (ranking, DNS check, `hosts_top1000.csv`).

## Step 2: enrichment

Hostnames and justifications are not changed; no rows are added or removed.

### Organisation, UID and seat

The operator of each hostname is searched by name in the **UID register** of
the Federal Statistical Office, through its public web service
(`https://www.uid-wse.admin.ch/V5.0/PublicServices.svc`, operation
`Search`). A match is accepted when exactly one active entry carries the
searched name (optionally followed by an abbreviation in brackets), branch
offices (legal form 0151) and VAT groups (0302) excluded. Where several
active entries share the name, the entry with a legal form is preferred over
one without, and a public-law form (0220, 0221, 0223, 0224) with the
abbreviation in brackets over other variants. If that still leaves more than
one entry, the UID stays empty.

For about 80 operator labels the match was set by hand from the search results;
`OVR` in `enrich.py` lists them. Examples: register names that differ from
the brand ("SKYGUIDE, Société Anonyme Suisse pour les Services de la
Navigation Aérienne civils et militaires"), units without their own entry
(SRF, RTS, RSI and swissinfo.ch use the UID of the SRG; the Armed Forces use
the UID of the DDPS), and VRSG, whose register entry is deleted and whose
portal redirects to Abraxas.

`organisation` is the name as registered. Without a UID it is the name
searched for, and the row is flagged; where the operator itself could not be
established (`polizei.ch`, `144.ch`) it stays empty. Postcode, place and canton are the
legal address in the UID register. All hosts of one operator carry identical
`organisation`, `uid`, `plz`, `ort` and `kanton`.

### Sector and sub-sector

Source: **Nationale Strategie zum Schutz kritischer Infrastrukturen vom
16. Juni 2023**, BBl 2023 1659
(<https://www.fedlex.admin.ch/eli/fga/2023/1659/de>), with the sectors and
sub-sectors as listed by the Federal Office for Civil Protection on
<https://www.babs.admin.ch/de/die-kritischen-infrastrukturen> (9 sectors,
27 sub-sectors). Names are used verbatim:

| Sektor | Teilsektoren |
|---|---|
| Behörden | Forschung und Lehre; Kulturgüter; Parlament, Regierung, Justiz, Verwaltung |
| Energie | Erdgasversorgung; Erdölversorgung; Fern- und Prozesswärme; Stromversorgung |
| Entsorgung | Abfälle; Abwasser |
| Finanzen | Finanzdienstleistungen; Versicherungsdienstleistungen |
| Gesundheit | Chemie und Heilmittel; Labordienstleistungen; Medizinische Versorgung |
| Information und Kommunikation | IT-Dienstleistungen; Medien; Postdienste; Telekommunikation |
| Nahrung | Lebensmittelversorgung; Wasserversorgung |
| Öffentliche Sicherheit | Armee; Blaulichtorganisationen; Zivilschutz |
| Verkehr | Luftverkehr; Schienenverkehr; Schiffsverkehr; Strassenverkehr |

Assignment is per operator (`orgmap.txt`). Choices worth knowing:

- Federal offices, regulators (FINMA, ENSI, ElCom), cantons and cities are
  *Behörden / Parlament, Regierung, Justiz, Verwaltung*. Universities and
  research institutes are *Forschung und Lehre*.
- Health insurers and Suva are *Finanzen / Versicherungsdienstleistungen*,
  following the strategy, not *Gesundheit*.
- Tram and bus operators and transport associations are put under
  *Schienenverkehr*; this is noted per row.
- The 2023 strategy no longer lists diplomatic missions and international
  organisations as a sub-sector. ICRC, WHO, ITU, WIPO, WTO and UN Geneva
  therefore have no sector; CERN is put under *Forschung und Lehre*, the BIS
  under *Finanzdienstleistungen*.
- Online and electronics retailers without food supply (Digitec Galaxus,
  Brack, Interdiscount, Ricardo, Manor) have no matching sub-sector and stay
  empty.

### Service type

One of `login`, `kundenportal`, `transaktion`, `api`, `fernzugriff`,
`email`, `website`. A first guess comes from the hostname (label conventions
and a list of known `admin.ch` services). Each host was then requested once
over HTTPS (redirects followed, first 400 kB read), and the guess is
confirmed or corrected:

| Type | Accepted as shown when |
|---|---|
| website | the page answers with status below 400 |
| login | final URL, title or page text show a login (log in, anmelden, password, OAuth/SAML/OpenID, Keycloak, F5 `my.policy`, …) |
| kundenportal | as login, or the title/path names a portal, account or customer area |
| transaktion | e-banking, shop or filing features on the entry page, or a login in front of them |
| api | JSON/XML response, an API or developer page, or an empty 401/403/404/405 answer at the root |
| email | Outlook Web, OWA, Roundcube, Zimbra, SOGo or Open-Xchange |
| fernzugriff | Citrix/NetScaler Gateway (`/logon/LogonPoint/`), Horizon, GlobalProtect, Fortinet, Pulse/Ivanti, AnyConnect or similar |

Corrections applied: a host that is a remote-access gateway becomes
`fernzugriff` whatever its name (11 hosts, mostly `portal.*` in front of
Citrix); a host that only redirects to the organisation's main website
becomes `website`; for financial institutions, a login or portal that opens
the e-banking becomes `transaktion`. Where the host did not answer (timeout,
TLS error) or showed no matching features, the type from the hostname is
kept and the row is flagged.

### Critical

`kritisch = ja` for these combinations of sector and service type:

| Sector | Service types |
|---|---|
| Finanzen | login, transaktion, api |
| Gesundheit | kundenportal, login |
| Energie | kundenportal, fernzugriff |
| Information und Kommunikation | login, kundenportal |
| Verkehr | transaktion, api |
| Behörden | kundenportal, login, api |
| all other sectors and rows without a sector | login, kundenportal, fernzugriff |

Deviations, each explained in `bemerkung`:

- `www.alert.swiss` is critical as the official alerting channel, although
  it is a website.
- Remote-access gateways are critical in every sector.
- Mandatory filings of the federal administration (VAT, customs, e-vignette,
  radio/TV levy) are critical as `transaktion`.

### Source URL

`quelle_url` is the organisation's page that links to or names the host.
Only the main website (and, for nested names, each parent domain's website)
was searched for a link to the hostname; pages further down and content
loaded by JavaScript were not. A website that names itself (canonical link,
navigation) counts as its own source. Empty means no link was found this way,
not that none exists.

### Visibility, confidence, remarks

- `sichtbarkeit` is `aggregat` for all rows for now: results are to be
  published per sector and type, not per hostname.
- `sicherheit = hoch` when operator (with UID), sector and service type are
  all established as described above; otherwise `tief`. A missing source URL
  does not lower confidence.
- `bemerkung` is filled only for deviations and uncertainties: no unique UID,
  operator assumed, service type not confirmed, host not reachable,
  reclassification, choice of sub-sector.

## Result (19 November 2026)

| | Rows |
|---|---|
| UID found | 906 |
| sicherheit hoch / tief | 659 / 341 |
| kritisch = ja | 415 |
| quelle_url found | 374 |

Service types: website 419, login 183, kundenportal 171, transaktion 104,
api 102, fernzugriff 11, email 10.

Sectors: Behörden 294, Finanzen 228, Information und Kommunikation 131,
Gesundheit 100, Energie 93, Verkehr 66, Nahrung 39, Öffentliche Sicherheit 20,
none 29.

Low confidence per block of 100 rows (`quality_by_block.json`):

| Rows | tief | Main reasons |
|---|---|---|
| 1–100 | 22 | service type not confirmed (7), host not reachable (7), UID not unique (6) |
| 101–200 | 35 | host not reachable (20), service type not confirmed (9), UID not unique (4) |
| 201–300 | 23 | UID not unique (12), service type not confirmed (6), operator assumed (2) |
| 301–400 | 37 | service type not confirmed (14), UID not unique (12), host not reachable (12) |
| 401–500 | 50 | service type not confirmed (25), host not reachable (18), UID not unique (8) |
| 501–600 | 35 | host not reachable (16), UID not unique (13), service type not confirmed (7) |
| 601–700 | 16 | host not reachable (5), UID not unique (5), no CIP sector (4) |
| 701–800 | 46 | host not reachable (21), UID not unique (14), service type not confirmed (12) |
| 801–900 | 41 | host not reachable (26), service type not confirmed (12), UID not unique (6) |
| 901–1000 | 36 | UID not unique (14), host not reachable (12), service type not confirmed (6) |

## Known limits

- The selection reflects one person's judgement of importance. Tiers and the
  organisation list should be reviewed with the sector bodies.
- Hostnames come from common labels; services on other names (for example
  `ebanking.example-bank.ch` versus `onlinebanking.example-bank.ch`) are
  missed unless listed by hand. Certificate Transparency per domain, as the
  pipeline already does for cantons, would find them.
- Several federal offices have more than one active UID entry with the same
  name (ESTV, SECO, swisstopo, BAKOM, MeteoSchweiz, BFS); the UID stays empty
  rather than guessed.
- Hosts that block automated requests or restrict access by network show up
  as not reachable, which lowers their confidence without saying anything
  about the service.
- The HTTPS check reads only the entry page. A login behind a JavaScript
  application, or an API that answers at a path other than `/`, is not seen.

## Reproduce

Run the scripts from one working directory that contains the files from
`data/critical_services/`:

```bash
python tools/critical_services/probe.py        # DNS lookups      -> dns.json
python tools/critical_services/assemble.py     # candidates       -> rows.json
python tools/critical_services/finalize.py     # top 1,000        -> kritische_digitale_services_ch_top1000.csv
python tools/critical_services/runuid.py       # UID register     -> uidcache.json
python tools/critical_services/uid_extra.py    # alternative names-> uidextra.json
python tools/critical_services/httpprobe.py    # HTTPS check      -> http.json
python tools/critical_services/enrich.py       # enrichment       -> kritische_services_ch_angereichert.csv
```

The UID web service is public and needs no key; send requests one at a
time. DNS answers, register entries and websites change, so a later run will
differ in detail. The intermediate files are not committed because the
search results of the UID register also list sole proprietorships under
personal names.

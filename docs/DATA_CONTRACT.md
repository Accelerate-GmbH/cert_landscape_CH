# Public data for the web app (schema 2)

The new frontend (`app/`, published under `/v2`) reads **only** this data.
This document is the same in both repositories. The pipeline repository
(`cert_landscape_CH_data`, not public) writes the data to its
`output/public/v2/` (`tlsmap public`, also at the end of every merge). The
workflow `publish map` of the public repository (`cert_landscape_CH`) reads it
from there at build time, together with the files of the current map, and
deploys it with the site; nothing is committed to the public repository.

| In the pipeline repository | Served as | Read by |
| --- | --- | --- |
| `output/public/v2/` | `/v2/data/` | `app/` (`app/js/data.js`, `BASE = "data"`) |
| `output/latest/map.json`, `hosts.json`, `search.json`, `resources/` | `/data/` | `web/` (current map) |
| (none: built by `publish map` from swiss-maps 4.7.0 with `tools/build_map.mjs`) | `/v2/map-ch.json` | `app/` (map as a lens: SVG paths of cantons, municipalities and lakes) |

Rule for anything added: a file the browser needs goes into the public folder
with an entry below and into the list of files `publish map` reads. Raw
results, CSV and Excel exports stay in the pipeline repository.

## Files

`meta.json`
: `schema`, `built`, `data_generated`, `cfg` (rating weights and thresholds),
  `check_order`, `model` (layers and benchmark from `config/model.toml`; levers, implementations and aspects only in `infrastructure.json`, after approval and with sources), `counts`
  per level, `months` (the months with a run, `YYYY-MM`, oldest first),
  `mail_weights` (weight per mail check), `sources` (from
  `config/sources.toml`: `checked`, `rating` `{"title", "url"}`, `checks`
  `{check: [{"title", "url"}]}` the standard or rule each check applies,
  `data` `[{"title", "url", "use", "blocks"}]` the data sources and the
  building blocks they feed). Translations: any object with a German text
  can carry `i18n` `{lang: {field: text}}` for `fr`, `it`, `en` (here
  `title`, `use`; from `config/sources.i18n.toml`); the frontend shows
  `i18n[lang][field]`, else the German field.

`uids.json`
: `{"schema": 2, "uids": ["105956490", …]}`: the UIDs (digits only) that
  have a page; the frontend links a UID only when it is listed here.

`uid/<digits>.json`
: one organisation with a UID and all its roles (docs/PRODUCT.md, section
  8.1): `uid` (`CHE-…`), `name`, `town`, `canton`, `bfs` (seat
  municipality, BFS number), `lei`, `hr` (commercial register number),
  `checked` (date of the register lookup, `null` for the administration),
  `src` (entry in the UID register), `measured` (true when a role is a
  measured entity), `roles`: `{"kind": "entity", "key", "name", "level",
  "value"}`, `{"kind": "provider", "id", "name", "provider_kind"}` (matched
  by LEI), `{"kind": "zertes" | "delivery", "block", "name", "services":
  [{"name", "kind", "since"}]}`, `{"kind": "swiyu", "block", "name", "env",
  "did", "src", "state_actor"}`. Seat, legal form and LEI come from the UID
  register (`data/uid/details.json`, `tlsmap uiddetails`). No page for a
  sole proprietorship (legal form 0101) or an entry the register does not
  publish; the administration (cantons, municipalities, federal
  departments) needs no register lookup.

`places.json`
: `{"schema": 2, "places": {key: bfs}}`: seat municipality (BFS number)
  of organisations and educational institutions from the UID register,
  for the points on the map of users. Missing where the UID has no page.

`index.json`
: `{"schema": 2, "rows": [[key, name, canton, overall, uid, sector(, parent)], …]}` for
  the search. `key` = `<level>:<id>`, levels `federal`, `office`, `canton`,
  `municipality`, `organisation`, `education` (schools and education
  agencies from `data/education/institutions.csv`, measured like an
  administration: every name under their domains; `sector` is the type
  `hochschule`, `sek2`, `volksschule` or `agentur`, the entity's `subsector`
  the kind of Hochschule `uh`, `fh` or `ph`; `canton` and `uid` from the UID
  register where it has a clear match, else null). `office`: an office
  of a department as its own entity, id `<department>-<abbreviation>`
  (e.g. `EFD-ESTV`), derived when the runs are merged from the hosts and
  mail domains of the department that fall under the office's domains (a
  host counts for the longest matching domain); no measurement of its own,
  same rules as every entity. Only domains with a unit from Annex 1 of the
  RVOV (see `parts`), not the department's own domain. Its row carries the
  department's key as `parent`. Offices repeat the hosts of their
  department: `providers.json` and the sector aggregates count them once,
  with the department.

`overview.json`
: per level: `entities`, `rated`, `overall` (mean), `lights` (count per
  colour) and `cells` per building block `"<layer>.<block>"`:
  `{"v": 0–100 | null, "entities": n, "objects": n, "m": "share" | "count" | "none"}`.
  `v` is weighted by the number of objects (hosts or mail domains).

`scores.json`
: values per entity for the ranking in the view «Vergleich», loaded only
  there: `{"schema": 2, "series": [...], "rows": {key: [value | null, …]}}`.
  `series` in this order: `overall`, `cat:<category>` (ownership,
  sovereignty, security, privacy), `mail`, then `blk:<layer>.<block>` for
  every measured building block of `model` (not `none`, not the count of
  service types).

`history/<level>-<id>.json`
: the time series of one entity, one point per month:
  `{"schema": 2, "key", "points": [point, …], "predecessors": [{"key", "name", "merged", "points": [point, …]}, …]}`.
  A point: `{"month": "YYYY-MM", "run": "YYYY-MM-DD", "overall", "categories": {ownership, sovereignty, security, privacy}, "light", "knockouts", "mail", "hosts", "checks"}`,
  `hosts` the number of rated hosts, `checks` `{check: 0–100}` the share per
  check (pass 1, partial ½, over the assessed hosts; missing where no host
  was assessed); both from the run's `results.json.gz`, `null`/`{}` where it
  is missing,
  values 0–100 with one decimal or `null`. Read from the dated run folders of
  the pipeline (`output/YYYY-MM-DD/entities.csv`); within a month the latest
  run that contains the entity counts. `predecessors`: municipalities merged
  into this one (BFS register of municipalities, `data/municipalities/mutations.json`
  in the pipeline repository), each with its own series up to the merge;
  `merged` is the date of the merge. Every entity of `index.json` has a file,
  also with no point yet.

`providers.json`
: the provider directory for the view «Abhängigkeiten»:
  `{"schema": 2, "functions": {function: {"model", "swap"}}, "rows": [row, …]}`.
  `function` is one of `mail`, `send`, `saas`, `idp`, `cloud`, `ca`, `dns`.
  A row: `{"id", "name", "country", "operator", "parent", "parent_country", "parent_source", "kind",
  "counts": {level: {function: n_entities}}, "hosts": {level: {function: n_hosts}}}`.
  `id` is the key in `config/stack.toml` where the provider is listed there,
  else `x-<slug of the name>` (networks, CAs and DNS operators by name);
  `operator`: the company operating the product, where `config/stack.toml`
  assigns its LEI (assignment by the radar, only where the product carries
  the company's name): `{"lei", "name", "country", "src", "parent",
  "parent_reason", "fetched"}` from GLEIF (`data/gleif/providers.json`),
  `parent` the ultimate parent GLEIF reports (`{"lei", "name", "country",
  "src"}`) or `null`, then `parent_reason` the reporting exception GLEIF
  records (e.g. `NON_CONSOLIDATING`), not interpreted. `parent`,
  `parent_country` and `parent_source` of the row repeat the ultimate parent
  from GLEIF with the link to its record, else `null`. `hosts` only for `cloud` and `ca`. Rows sorted by the
  number of dependent entities, most first. `functions`: whether the function
  runs over an open protocol or a platform (`model`: `protocol` | `platform`),
  and, once approved, how replaceable a provider is: `swap` (`easy` |
  `effort` | `hard`), `data` (which data lie with the provider), `export` (how
  they can be taken out and stay reusable), `costs` (what a switch costs
  beyond the work), `sources` (`[{"title", "url"}]`, links to the exact place
  that supports the facts in the texts), `checked` (date of the check) and
  `assessment` (`true`: the texts are an assessment, shown as such). Only
  entries approved and checked are published. From `[functions]` in
  `config/stack.toml`; texts in German.

`providers/<id>.json`
: one provider: the row above plus `"entities": {function: [key, …]}`, the
  entities of all levels that depend on it for that function.

`infrastructure.json`
: the digital public infrastructure (layers with `"group": "dpi"` in `model`:
  trust infrastructure; identity, authentication, data exchange, value
  exchange; identity as digital capacity to act and authentication as proof
  at access are separate blocks `dpi.identity` and `dpi.authentication`):
  `{"schema": 2, "source": {"title", "url"}, "blocks": {"<layer>.<block>": {"implementations": [...], "alternatives": [...]}}, "control": [...]}`.
  `aspects`: labels of the aspects of the identity block (identity,
  authority, agency), `aspects_i18n` `{lang: {aspect: label}}`,
  `aspect_sources` the sources for this distinction; `source` carries
  `i18n` for its `title`; each implementation carries `i18n` for `operator`
  and `role` (from `config/model.i18n.toml`). An implementation: `id` (stable key of the service, `id` in `config/model.toml` or the name in lower case with `-`; the same in every block it appears in; equal to a provider key where the service is also recognised as provider, e.g. `agov`; page `#/dienst/<id>`), `name`, `aspect` (identity block only),
  `environment` (`production`, `sandbox` or `null`; swiyu: the sandbox or
  public beta and the announced production are separate implementations),
  `environment_assessment` (true where the assignment of hosts to the
  environment is an assessment, not documented by the operator),
  `operator`, `role`, `sources` (`[{"title", "url"}]`),
  `checked`, `providers` (keys in `config/stack.toml` through which use is
  recognised), `hosts` (number of its measured hosts that run the service
  itself), `host_roles` (`{"service", "info", "test", "other"}`: how many
  of all its hosts run the service, an information site, a test
  environment, or are not sorted; `null` while unclassified), `classified`
  (date the hosts were sorted by their start page, `null` while
  unclassified), `overall` (mean value of the service hosts), `rests_on` (per check `sov.ca`, `sov.dns`, `sov.hosting`,
  `sov.registrar`: `[{"value", "hosts", "status", "evidence"}]`, what its hosts
  rest on, with the evidence of the check), `examples` (up to 12 host names),
  `users` (`{level: n_entities}` seen to use it). Posture and use are kept
  apart (docs/PRODUCT.md, section 5.1): `hosts`, `overall` and `rests_on`
  are the posture of the service itself, part of the supply chain of its
  users; `users_list` names the entities that use it,
  `[{"key", "name", "role", "env", "evidence": [{"kind", "where", "what", "src"}]}]`,
  `role` `login` (recognised as login provider, also further along a
  redirect chain across hosts: `what` is the chain, e.g. `login.kanton.ch →
  idp.agov.admin.ch`), `hint` (the service is named in the
  Content-Security-Policy of a page, kind `csp`; listed, not counted in
  `users` and not on the map of users), `law` (a cantonal enactment names
  the service, from `legal` in `config/model.toml`: evidence kind `law` with
  `where` = reference and article, `what` = quote, `src` = the enactment,
  `title`; the entry carries `scope`; a legal basis, not detected use, so not
  counted in `users` and shown apart on the map), `participant` or
  `verifier` (swiyu Trust Registry, matched by UID), `kind` of evidence
  `registry`, `law`, `path`, `redirect`, `csp`, `spf`, `txt`, `dkim`, `cname` or `mx`. An implementation can
  appear in more than one block (swiyu: trust infrastructure and identity). `alternatives` (authentication
  only): foreign login providers used instead, `{"id", "name", "country",
  "users"}`. Only implementations with sources and a check date appear.
  `register`: an official list of recognised providers for the block,
  `kind` `zertes` (seal and time stamp blocks, from the Swiss Trusted List of
  the SAS) or `delivery` (data exchange: delivery platforms recognised by the
  EJPD, list of the BJ, kept by hand in `config/model.toml` with `checked`)
  or `vlei` (identity: qualified vLEI issuers from the GLEIF API,
  `data/gleif/vlei_issuers.json`; per provider also `lei`, `country`, `src`
  (GLEIF record), the service `since` is the qualification date; the register
  carries `api` and `checked`, `issued` is null; whether an entity holds a vLEI
  is not published and not measured),
  or `swiyu` (trust infrastructure: participants of the swiyu Trust Registry,
  `data/swiyu/trust_registry.json`, read from the public API of production
  and sandbox; per provider also `env` (`production` | `sandbox`), `did`,
  `state_actor` and `src` (the API query returning the statement); the
  service `since` is the date of the statement. Every name the registry
  publishes is shown, names of persons included; the register's
  `envs` gives per environment `api`, `participants` (all), `unnamed`
  (entries without a name) and `verifiers` `[{"did", "name" (null when not
  published), "statements", "purposes": [{"scope", "name", "description"}],
  "src"}]` with names and descriptions per language `de`, `fr`, `rm`, `en`),
  `{"kind", "source", "rules",
  "issued", "sequence", "next_update", "providers": [{"name", "uid",
  "trade_names", "services": [{"name", "kind", "for", "since"}], "withdrawn"}]}`;
  `kind` `certificates` (qualified certificates, `for` `signatures` and/or
  `seals`), `remote_qscd` or `timestamp`; only granted services, `withdrawn`
  counts the withdrawn ones. A provider or participant with a UID that has a
  page also carries `seat` `{"bfs", "canton", "town"}` from the UID register
  (for the map of the users of swiyu).
  `control`: the lever per building block of the control layer, a view
  across all layers (`blocks`, `lever`, `checks`, `sources`, `checked`,
  `assessment`: true when the lever is the radar's assessment and the
  sources state the mechanism only); only approved entries with sources appear.

`governance.json`
: the legal bases of the governance view, from `config/governance.toml`:
  `{"schema": 2, "checked", "laws": [law, …]}`. A law: `id`, `level`
  (`federal` | `canton`), `canton` (code, cantonal law only), `abbr`,
  `name`, `ref` (SR, BBl or cantonal systematic number), `url`, `status` (`in_force` |
  `angenommen` | …), `status_text`, `status_sources` (`[{"title", "url"}]`),
  `scope` (who it applies to), `languages` (languages in which the act is officially published; cantonal acts are not translated into other languages), `provisions` (`[{"art", "text", "url",
  "blocks"}]`: article, short summary close to its wording, link to the
  article, building blocks of `model` it concerns, `i18n` `{fr, it, en}` the
  summary in other languages), `blocks` (union of the provisions' blocks),
  `i18n` (`{lang: {"abbr", "name", "status_text", "scope", "status_sources"}}`,
  `status_sources` a list of titles in the order of `status_sources`, from
  `config/governance.i18n.toml`; not official translations, French and
  Italian follow the official texts). Only laws whose provisions all carry a
  link appear.

`evidence/<level>-<id>.json`
: the evidence behind the values of one entity, loaded only when a host is
  opened: `{"schema": 2, "key", "hosts": {host: {"at", "ips", "cert",
  "chk"}}}`, only for hosts listed in its entity file. `at` the time of the
  first live measurement (UTC), `ips` `[[ip, asn, as_name, country], …]`,
  `cert` `{"src" (crtsh | certspotter), "id", "iss", "org", "val", "exp"}`,
  `chk` `[[check, status, value, method, detail], …]` with `method` how the
  value was obtained (e.g. `dns-ns-asn`, `rdap`, `tls`) and `detail` the zone,
  register entry or URL it refers to.

`rss/<level>-<id>.xml`
: RSS 2.0 feed of one entity, one item per month (newest first): value,
  change to the previous month, categories, mail; link to the report page
  `#/org/<key>/bericht?m=YYYY-MM` under `[public] site` of
  `config/settings.toml`. German only.

`benchmarks.json`. Values 0–100 with
  one decimal.

`benchmarks.json`
: per level and series (`overall`, `cat:<category>`, `chk:<check>`, `mail`,
  `blk:<layer>.<block>`): with at least 40 entities the best 5 % by rank,
  `{"mode": "top", "share": 0.05, "value": <lowest in the group>, "mean": …, "group": n, "examples": [keys]}`;
  otherwise the single best, `{"mode": "best", "value": …, "examples": [key]}`.

`entities/<level>-<id>.json`
: one entity: `key`, `kind`, `id`, `name`, `canton`, `domains`, `uid`,
  `uid_name`, `sector`, `subsector`, `place`;
  `posture` (`overall`, `categories`, `lights`, `checks` with
  pass/partial/fail/assessed, `resources`, `knockouts`, `distribution`);
  `mail` (`overall`, `checks`, `domains`, `detail` per domain; each detail
  check `{"check", "status", "value", "src"}`, `src` the DNS query the value
  was read from, `null` for `mail.starttls`);
  `src` where the entity's values come from: `{"evidence"` (path of the
  evidence file of its hosts), `"checks"`, `"scores"`, `"aggregation"`,
  `"mail"}` (links to the sections of the rating rules that define the
  checks, turn them into scores and combine hosts into the entity's values);
  `layers` (`{layer: {block: {"v", "m", "n"}}}`, same blocks as `model`);
  `dependencies` (see below); `stack`
  (TLD, DNS, hosting, CA, root); `no_data` (reason when unrated);
  `ct_stale` (true when Certificate Transparency failed for at least one
  domain and its hosts and certificates come from the previous snapshot;
  DNS, network and live checks are current);
  `hosts` (`host`, `overall`, `cats`, `status`, `critical`, `knockout`,
  `unreachable`).
  `plan` (Phase 3, not shown on the site before the good practice is
  approved): `{"base", "target", "target_kind": "benchmark", "goal": null,
  "proposed_value", "reaches", "items": [{"check", "hosts", "sample",
  "value", "gain", "effort", "practice", "proposed"}]}` or null without
  rated resources. Per check that fails or partly passes on at least one
  rated resource (and `knockout` for invalid or revoked certificates): the
  entity value if it passed on every affected resource (`value`, `gain`
  against `base`), the number of affected hosts and up to 20 of them
  (`sample`). Same rules as the rating (check and category weights, points,
  critical resources three times). `target`: the benchmark of the level
  (mean of the best 5 %, or the best) until a yearly goal is agreed (`goal`).
  `proposed`: the smallest set in order of gain that reaches `target`;
  `reaches` false when all measures together stay below it. `effort` and
  `practice` (id in `config/practice.toml`) only for approved entries, else null.
  `services`: the matrix services × functions, `[{"service", "host",
  "hosts", "cells"}]`. `service` is `website`, `portal`, `login`, `gever`
  (GEVER application) or `mail`, recognised by host name
  (`[apps]` in `config/stack.toml`) or, for mail, the mail domain; `host`
  the host (or mail domain) shown, `hosts` how many hosts of this kind were
  rated. `cells` per function `resolve` (check `sov.dns`), `registrar`
  (`sov.registrar`), `secure` (`sov.ca`; mail: `mail.starttls`), `operate`
  (`sov.hosting`; mail: `mail.mx`), `identity` (`own.identity`; mail:
  `mail.dmarc`): `{"check", "status", "value", "count": {"pass", "partial",
  "fail"}}`, where `status` and `value` are those of `host` and `count`
  covers all hosts of the kind; `null` where no check applies. Seals and
  time stamps are not measurable from outside and have no cell.
  `uses`: the services of the building blocks the entity uses,
  `[{"id", "service", "block", "role", "env", "evidence", "service_posture",
  "service_hosts"}]`; `service_posture` is the posture value (`overall`) of
  the service, shown beside the entity's own value as part of its supply
  chain, never part of it (decision 23.11.2026); `id` is the implementation `id` (page `#/dienst/<id>`).
  `swiyu`: the entity's identity trust statements in the swiyu Trust
  Registry, matched by its UID: `[{"env", "name", "did", "src",
  "state_actor"}]`, empty without one.
  `identity`: the LEI of the entity, matched by its UID in the GLEIF
  data (`data/gleif/lei.json`, CC0): `{"lei", "name", "entity_status",
  "registration_status" (ISSUED, LAPSED …), "next_renewal", "src" (link to
  the GLEIF record), "fetched"}`, `null` without an LEI.
  `parts` (federal level only): the department by the domains of its
  offices as listed in `config/entities.toml`, `[{"domain", "office", "hosts",
  "overall", "knockouts"}]`; `office` the administrative unit whose
  abbreviation equals the first label of the domain, from Annex 1 of the
  RVOV (`data/federal/units.json`): `{"abbr", "name", "i18n": {fr, it},
  "src", "version"}`; where the first label is no abbreviation, the unit
  named in the title of the domain's start page or by the first label of its
  redirect target (`data/federal/by_title.json`), then with `via`
  `{"title", "url", "checked"}`; else `null`; a host counts for the longest matching domain;
  `overall` is the mean of its rated hosts, `null` without one; `key` the
  key of the office entity (`office:<department>-<abbr>`) where there is one.
  Office entities (level `office`) carry `parent` (key of the department)
  and `office` (the unit as in `parts`); `canton` is null.

## Dependencies

`dependencies` in `entities/<level>-<id>.json` lists what the services of an
entity rest on, read from public DNS and HTTP (`src/tlsmap/stack.py`,
providers and patterns in `config/stack.toml`). Empty parts are left out.
Countries are ISO codes of the company that controls the provider; for a
login the entity runs itself, the country of the network that serves it
(empty when unknown).

| Part | Form | Meaning |
| --- | --- | --- |
| `mail` | `[[name, country, n_domains], …]` | mail platform or filter (MX, else network of the first MX) |
| `send` | `[[name, country], …]` | services allowed to send in the entity's name (SPF include, DKIM key) |
| `saas` | `[[name, country], …]` | SaaS in use (verification record in TXT, SPF, DKIM key, CNAME, redirect of the start page) |
| `idp` | `[[name, country], …]` | login provider (redirect of a start page to a known provider, a login path such as `/adfs/ls`, or sign-in on another host of the entity: «Eigener Login») |
| `cloud` | `[[name, country, n_hosts], …]` | cloud and hosting per host in use (CNAME, else network), at most 12 |
| `apps` | `{type: n_hosts}` | type of service from the host name |
| `via` | `[{"part", "provider", "name", "ev": [[kind, where, what], …]}, …]` | what each provider in `mail`, `send`, `saas`, `idp` was recognised by, at most two proofs each |

`via`: `part` is one of the parts above, `provider` the key in
`config/stack.toml` (stable; the later provider directory uses it), `name` as
in the part. `kind` is one of `mx`, `spf`, `txt`, `dkim`, `cname`,
`redirect`, `path`; `where` the domain, DNS name or host that showed it;
`what` the matched value (MX host, SPF include, CNAME or DKIM target,
redirect target, `host/path` of a login). For TXT records only the name of
the record (`atlassian-domain-verification`), never the token. Verifications
for web tools (search console, ad accounts) are not dependencies and do not
appear.

The pipeline keeps `via` out of `map.json` of the current map; it writes it
to `output/latest/resources/deps-<level>-<id>.json`, and `tlsmap public`
merges it into the entity file.

## Measures per building block

Defined in `config/model.toml`: `checks` = share of hosts meeting the listed
Trust & Sovereignty Posture checks (pass 1, partial ½); `mail` = share of mail domains
meeting the mail checks; `deps` = share of Swiss providers among the
dependencies found; `none` = not measured yet.

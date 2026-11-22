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
  building blocks they feed).

`index.json`
: `{"schema": 2, "rows": [[key, name, canton, overall, uid, sector], …]}` for
  the search. `key` = `<level>:<id>`, levels `federal`, `canton`,
  `municipality`, `organisation`.

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
  service types); the same names as in `history/<level>-<id>.json`
: the time series of one entity, one point per month:
  `{"schema": 2, "key", "points": [point, …], "predecessors": [{"key", "name", "merged", "points": [point, …]}, …]}`.
  A point: `{"month": "YYYY-MM", "run": "YYYY-MM-DD", "overall", "categories": {ownership, sovereignty, security, privacy}, "light", "knockouts", "mail"}`,
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
  A row: `{"id", "name", "country", "parent", "parent_country", "kind",
  "counts": {level: {function: n_entities}}, "hosts": {level: {function: n_hosts}}}`.
  `id` is the key in `config/stack.toml` where the provider is listed there,
  else `x-<slug of the name>` (networks, CAs and DNS operators by name);
  `parent` and `parent_country`: the controlling group, only where a source
  for it is recorded (`parent_source`, a link to the register entry, e.g.
  GLEIF), else `null`. `hosts` only for `cloud` and `ca`. Rows sorted by the
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
  trust infrastructure; identity, data exchange, value exchange):
  `{"schema": 2, "source": {"title", "url"}, "blocks": {"<layer>.<block>": {"implementations": [...], "alternatives": [...]}}, "control": [...]}`.
  `aspects`: labels of the aspects of the identity block (identity,
  authentication, authority, agency), `aspect_sources` the sources for this
  distinction. An implementation: `name`, `aspect` (identity block only),
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
  `users` (`{level: n_entities}` seen to use it). An implementation can
  appear in more than one block (swiyu: trust infrastructure and identity). `alternatives` (identity
  only): foreign login providers used instead, `{"id", "name", "country",
  "users"}`. Only implementations with sources and a check date appear.
  `control`: the lever per building block of the control layer, a view
  across all layers (`blocks`, `lever`, `checks`, `sources`, `checked`);
  only approved entries with sources appear.

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
  `mail` (`overall`, `checks`, `domains`, `detail` per domain);
  `layers` (`{layer: {block: {"v", "m", "n"}}}`, same blocks as `model`);
  `dependencies` (see below); `stack`
  (TLD, DNS, hosting, CA, root); `no_data` (reason when unrated);
  `ct_stale` (true when Certificate Transparency failed for at least one
  domain and its hosts and certificates come from the previous snapshot;
  DNS, network and live checks are current);
  `hosts` (`host`, `overall`, `cats`, `status`, `critical`, `knockout`,
  `unreachable`).

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

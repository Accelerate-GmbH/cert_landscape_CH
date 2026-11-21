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

Rule for anything added: a file the browser needs goes into the public folder
with an entry below and into the list of files `publish map` reads. Raw
results, CSV and Excel exports stay in the pipeline repository.

## Files

`meta.json`
: `schema`, `built`, `data_generated`, `cfg` (rating weights and thresholds),
  `check_order`, `model` (the layer model from `config/model.toml`), `counts`
  per level.

`index.json`
: `{"schema": 2, "rows": [[key, name, canton, overall, uid, sector], …]}` for
  the search. `key` = `<level>:<id>`, levels `federal`, `canton`,
  `municipality`, `organisation`.

`overview.json`
: per level: `entities`, `rated`, `overall` (mean), `lights` (count per
  colour) and `cells` per building block `"<layer>.<block>"`:
  `{"v": 0–100 | null, "entities": n, "objects": n, "m": "share" | "count" | "none"}`.
  `v` is weighted by the number of objects (hosts or mail domains).

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

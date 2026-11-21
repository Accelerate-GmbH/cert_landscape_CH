# Public data for the web app (schema 2)

The new frontend (`app/`, published under `/v2`) reads **only** this data.
The non-public pipeline writes it to its `output/public/v2/` (`tlsmap public`,
also at the end of every merge) and copies it, together with the files of the
current map, to the branch `published-data` of this repository:

| Branch `published-data` | Served as | Read by |
| --- | --- | --- |
| `v2/` | `/v2/data/` | `app/` (`app/js/data.js`, `BASE = "data"`) |
| `map/` (`map.json`, `hosts.json`, `search.json`, `resources/`) | `/data/` | `web/` (current map) |
| `SOURCE` | – | commit of the pipeline repository the data comes from |

The branch holds one commit, replaced after every run. Rule for anything
added: a file the browser needs goes into the public folder with an entry
below. Raw results, CSV and Excel exports stay in the pipeline repository.

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
  `dependencies` (mail platform, sending services, SaaS, login provider,
  cloud and hosting, service types; see `src/tlsmap/stack.py`); `stack`
  (TLD, DNS, hosting, CA, root); `no_data` (reason when unrated);
  `hosts` (`host`, `overall`, `cats`, `status`, `critical`, `knockout`,
  `unreachable`).

## Measures per building block

Defined in `config/model.toml`: `checks` = share of hosts meeting the listed
Trust & Sovereignty Posture checks (pass 1, partial ½); `mail` = share of mail domains
meeting the mail checks; `deps` = share of Swiss providers among the
dependencies found; `none` = not measured yet.

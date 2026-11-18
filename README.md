# cert_landscape_CH

Which certificate authorities do Swiss public administrations depend on?

`tlsmap` is an open pipeline that answers this for all 26 cantons and about
2,100 municipalities (optionally the federal administration). It reads
Certificate Transparency logs, works out which certificate each hostname uses
today, checks the hostname in DNS, and attributes every certificate to the
company that controls the issuing CA. All rules and weights are in
`config/` and documented in [METHOD.md](METHOD.md).

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

## Output

Each run writes `output/<date>/` and copies it to `output/latest/`:

| File | Content |
|---|---|
| `entities.csv` | one row per canton / municipality with scores and checks |
| `hostnames.csv` | one row per hostname: certificate, CA, owner, DNS, platform |
| `results.json` | everything above plus CAA records and per-check details |
| `export.xlsx` | the same as a workbook, including the CA registry and run metadata |
| `data.min.json` | same shape as the existing map frontends (mxmap / sslmap), counted per hostname |
| `run.json` | sources, CT lag, config hashes, versions |

A sample run for canton Zug is in `samples/zug/`.

## Map

`web/` is a static map (Leaflet, no tracking, no tile server) in German,
French, Italian and English: sovereignty and identity validation per canton
and municipality, critical services, CAA, good-practice checks and the CA mix
per entity. The `publish map` workflow deploys it to GitHub Pages with the
latest `output/latest/map.json`. Local preview:

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

## Licence

MIT, see [LICENSE](LICENSE). Third-party data and code: see [NOTICE](NOTICE).

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
| CA country | country printed in the certificate | country of the company that controls the CA, with sources |
| DV / OV / EV | inferred | read from the certificate policy OIDs |
| Domains per municipality | one | website and e-mail domains, shared domains removed |
| Freshness | not stated | source and lag of the CT data recorded per run |

## Quick start

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e .
export CERTSPOTTER_API_KEY=...          # free key at sslmate.com/certspotter, recommended
tlsmap run --canton ZG                  # one canton and its municipalities
tlsmap run                              # all cantons and municipalities
tlsmap run --probe                      # also connect to each hostname (live TLS)
tlsmap diff output/2026-10-01/results.json output/2026-11-01/results.json --changed-only
```

Without an API key the pipeline uses crt.sh. That works but is slow (about 25
seconds per domain) and in November 2026 lagged the logs by about five weeks;
the lag is recorded in `run.json` and the expiry check is skipped when it is
over seven days.

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

A sample run for canton Zug is in `samples/zug-2026-11-18/`.

## Corrections

- Wrong or missing CA owner: edit `config/ca_registry.toml` (add a source).
- Missing domains for an entity (schools, portals): `data/overrides.json`.
- Hostname operated by someone else under the entity's name: `exclude_hosts`
  in `data/overrides.json`, with a reason.
- What counts as critical, scoring weights, thresholds: `config/settings.toml`.

Issues and pull requests are welcome.

## Licence

MIT, see [LICENSE](LICENSE). Third-party data and code: see [NOTICE](NOTICE).

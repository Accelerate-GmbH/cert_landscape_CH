# Verification of the critical-services list

Checked: 2026-11-19T01:04:13Z · list: `/home/runner/work/cert_landscape_CH/cert_landscape_CH/data/critical_services/critical_services_ch.csv`

| | Hosts |
|---|---|
| listed | 1000 |
| resolve in public DNS | 1000 |
| answer over HTTPS | 842 |
| source page still links the host | 362 of 374 |

## Failing in two or more consecutive checks (review)

- none

## Source page no longer links the host (two or more checks)

- none

## Changed since the last check

- none

Operator data (UID, seat) is checked separately against the UID register with
`tools/critical_services/runuid.py`; this check does not change the list.

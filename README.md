# Trust Posture Switzerland (cert_landscape_CH)

How well are the online services of the federal administration, the 26
cantons, about 2,100 municipalities and the operators of critical services
protected, and who controls them? The map rates every service with fifteen
checks on ownership, sovereignty, security and privacy (Trust Posture), adds
six mail checks, and shows what the services rest on: mail platform, cloud and
hosting, SaaS, certificate authority, DNS, registrar.

- **Map:** https://accelerate-gmbh.github.io/cert_landscape_CH/ (German, French, Italian, English)
- **New frontend (draft):** https://accelerate-gmbh.github.io/cert_landscape_CH/v2/

## This repository

| Path | Content |
| --- | --- |
| `web/` | the current map (Leaflet, no build step) |
| `app/` | the new frontend, published under `/v2` (ES modules, no build step) |
| `docs/RATING.md` | the rating: checks, weights, rules, traffic lights |
| `METHOD.md` | how hostnames, certificates and authorities are attributed |
| `docs/CRITICAL_SERVICES.md` | how the list of critical services was built |
| `docs/DATA_CONTRACT.md` | the data the new frontend loads |
| `tools/check_site.mjs` | consistency of both frontends with the published data |
| branch `published-data` | the data the site loads, replaced after every monthly run |

Data collection, rating and the full results are maintained in a separate,
non-public repository. After every monthly run it replaces the branch
`published-data` here with the files the website needs and starts the
workflow `publish map`, which builds the site from `main` (code) and
`published-data` (data). The git history of this repository up to
21 November 2026 still contains the earlier pipeline and its output.

## Run the site locally

```bash
git clone https://github.com/Accelerate-GmbH/cert_landscape_CH.git && cd cert_landscape_CH
git clone --branch published-data --depth 1 https://github.com/Accelerate-GmbH/cert_landscape_CH.git pub
mkdir -p site/data site/v2
cp web/*.html web/*.css web/*.js site/ && cp -r web/vendor site/ && cp -r pub/map/. site/data/
cp -r app/. site/v2/ && cp -r pub/v2 site/v2/data
cd site && python3 -m http.server 8765    # http://localhost:8765/ and /v2/
```

The canton and municipality outlines (`site/data/ch-combined.json`) come from
[swiss-maps](https://github.com/interactivethings/swiss-maps) 4.7.0; the
publish workflow downloads them.

## Checks

`node tools/check_site.mjs pub` verifies that every published check has texts
in all four languages, that the languages carry the same keys, that the map
lists the checks in the published order and that every referenced file
exists. The workflow `checks` runs it on every push.

## Corrections

Corrections and missing services are welcome as issues: name the service,
what is wrong and a source.

## Credits

- **MXmap** by David Huser and the MXmap project
  ([mxmap-ch](https://github.com/mxmap/mxmap-ch),
  [secassure2026](https://github.com/mxmap/secassure2026), MIT): the list of
  Swiss municipalities with their website and mail domains, and the idea of
  mapping municipal infrastructure dependencies.
- **sslmap.nbrt.ch**, the first map of Swiss public-sector TLS certificates.
- **Common CA Database** ([CCADB](https://www.ccadb.org)): who owns each certificate authority.
- **Certificate Transparency** logs through [crt.sh](https://crt.sh) and
  [Cert Spotter](https://sslmate.com/ct_search_api/).
- **DNS over HTTPS** from [Google Public DNS](https://developers.google.com/speed/public-dns)
  and [Cloudflare](https://developers.cloudflare.com/1.1.1.1/).
- **Team Cymru** [IP to ASN mapping](https://www.team-cymru.com/ip-asn-mapping).
- **UID register** of the Federal Statistical Office ([uid.admin.ch](https://www.uid.admin.ch)).
- **RDAP** of [SWITCH](https://rdap.nic.ch/) and the registries in the [IANA bootstrap](https://data.iana.org/rdap/dns.json).
- [Leaflet](https://leafletjs.com) and [swiss-maps](https://github.com/interactivethings/swiss-maps).

License: see `LICENSE` and `NOTICE`.

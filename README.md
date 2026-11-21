# Trust & Sovereignty Posture Radar (cert_landscape_CH)

How well are the online services of the federal administration, the 26
cantons, about 2,100 municipalities and the operators of critical services
protected, and who controls them? The map rates every service with fifteen
checks on ownership, sovereignty, security and privacy (Trust & Sovereignty Posture), adds
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
| `tools/check_site.mjs` | consistency of both frontends with the data they load |

This repository holds no data. Data collection, rating and all results are
maintained in a separate, non-public repository. After every monthly run it
starts the workflow `publish map` here, which reads the files the website
loads from that repository at build time and deploys them with the code from
`main` to GitHub Pages; nothing of it is committed here. `publish map` and the
Dependabot rule for its actions are the only automation kept here. The git
history of this repository up to 21 November 2026 still contains the earlier
pipeline and its output.

## Run the site locally

Needs read access to the pipeline repository, which holds the data:

```bash
git clone https://github.com/Accelerate-GmbH/cert_landscape_CH.git && cd cert_landscape_CH
D=/path/to/cert_landscape_CH_data/output
mkdir -p site/data site/v2
cp web/*.html web/*.css web/*.js site/ && cp -r web/vendor site/
cp $D/latest/map.json $D/latest/hosts.json $D/latest/search.json site/data/ && cp -r $D/latest/resources site/data/
cp -r app/. site/v2/ && cp -r $D/public/v2 site/v2/data
cd site && python3 -m http.server 8765    # http://localhost:8765/ and /v2/
```

The canton and municipality outlines (`site/data/ch-combined.json`) come from
[swiss-maps](https://github.com/interactivethings/swiss-maps) 4.7.0; the
publish workflow downloads them.

## Checks

`node tools/check_site.mjs <folder with v2/meta.json>` verifies that every published check has texts
in all four languages, that the languages carry the same keys, that the map
lists the checks in the published order and that every referenced file
exists. It runs in every build of the site and daily in the pipeline repository;
run it locally before pushing changes to `web/` or `app/`.

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

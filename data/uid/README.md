# UID numbers of the public administration

`entities.json` holds the UID (CHE-…) of cantons, municipalities and federal
departments, written by `tlsmap uid` from the public search service of the
[UID register](https://www.uid.admin.ch) of the Federal Statistical Office.
Critical-service operators carry their UID in the host list instead.

How a UID is chosen:

| Level | Search | Chosen unit |
| --- | --- | --- |
| Municipality | BFS municipality number, legal form 0223 | the unit named after the whole municipality (“Politische Gemeinde Bonstetten”, “Ville de Lausanne”), not schools, utilities or offices |
| Canton | canton abbreviation, legal form 0221 | “Kanton Zug”, “Canton de Vaud”, “Repubblica e Cantone Ticino” |
| Federal department | abbreviation, then full name, legal form 0220 | the name ending in the abbreviation, e.g. “… (VBS)” |

Only active entries count. When several units qualify, the record keeps up to
eight candidates (`match: ambiguous`) and no UID. The courts and the Federal
Assembly (`JUS`) have no common UID.

`pins.json` fixes a UID by hand and always wins:

```json
{"municipality": {"351": {"uid": "CHE-123.456.789", "name": "Einwohnergemeinde Bern"}}}
```

The workflow `UID numbers` runs once a year and on demand; known UIDs are kept,
`--refresh` looks them up again. The monthly snapshot adds the UIDs to the map,
each linked to its own entry in the register.

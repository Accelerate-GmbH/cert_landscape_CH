"""Second round of UID-register searches with alternative names, for operators
the first round (runuid.py) did not resolve. Writes uidextra.json, which
enrich.py uses only to look up the UIDs pinned in its OVR table."""
import json
from uid import search

QUERIES = ['Eidgenössische Technische Hochschule', 'Universität Lausanne', 'Kernkraftwerk Leibstadt',
    'Kantonsspital St. Gallen', 'Saviva', 'Gaznat', 'Amedis-UE', 'Axsana', 'Canton de Fribourg',
    'Schweizerisches Rotes Kreuz', 'DocMorris', 'Ringier Medien', '20 Minuten', 'VRSG', 'Educa',
    'OFAC', 'eHealth Suisse', 'Nationalbibliothek NB', 'ComCom', 'PostCom', 'EDÖB', 'QuoVadis',
    'Aziende Industriali', 'Brack', 'Unilabs', 'Verteidigung', 'Office des Nations Unies',
    'Swisstransplant', 'Viollier', 'Medgate', 'Medbase', 'esisuisse', 'compenswiss', 'SASIS',
    'MediData', 'Refdata', 'Nevis', 'Equinix', 'SwissIX', 'Init7', 'Quickline', 'green.ch',
    'Sunrise', 'Hostpoint', 'Infomaniak', 'Inventx', 'Avaloq', 'finnova']

out = {}
for q in QUERIES:
    try:
        out[q] = search(q)
    except Exception as e:  # network errors are recorded, not fatal
        out[q] = {'error': str(e)}
json.dump(out, open('uidextra.json', 'w'), ensure_ascii=False)

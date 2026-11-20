"""The public data folder the new frontend reads (docs/DATA_CONTRACT.md)."""
import json

from tlsmap import public


def test_block_values_and_benchmarks(tmp_path):
    mdl = public.model()
    e = {"n": "X", "c": "ZG", "d": ["x.ch"], "uid": "CHE-1",
         "tm": {"o": 70, "c": {"ownership": 60}, "k": {"sov.registrar": {"pass": 1, "partial": 0, "fail": 1, "assessed": 2},
                                                     "sov.dns": {"pass": 2, "partial": 0, "fail": 0, "assessed": 2},
                                                     "own.dnssec": {"pass": 0, "partial": 0, "fail": 2, "assessed": 2}}},
         "ml": {"o": 50, "k": {"mail.dmarc": {"pass": 1, "partial": 0, "fail": 1}}, "n": 2},
         "sk": {"cloud": [["Infomaniak", "CH", 3], ["Amazon Web Services", "US", 1]], "saas": [["Microsoft 365", "US"]], "apps": {"website": 2}}}
    d = public.entity_doc("municipality", "1", e, mdl, [["www.x.ch", "municipality:1", 70, 60, 80, 70, 0, "", 0, "", 0]], None)
    L = d["layers"]
    assert L["net"]["registrar"]["v"] == 50.0
    assert L["net"]["dns"]["v"] == 50.0                 # 2 of 4 across sov.dns and own.dnssec
    assert L["ext"]["mail"]["v"] == 50.0
    assert L["cloud"]["infra"]["v"] == 75.0             # 3 of 4 hosts at a Swiss provider
    assert L["cloud"]["platform"]["v"] == 0.0
    assert L["trust"]["swiyu"]["m"] == "none" and L["apps"]["services"]["n"] == 2
    assert d["hosts"][0]["host"] == "www.x.ch"
    docs = {"municipality": [dict(d, key=f"municipality:{i}", posture=dict(d["posture"], overall=i)) for i in range(100)]}
    b = public.benchmarks(docs, mdl)["municipality"]["overall"]
    assert b["mode"] == "top" and b["group"] == 5 and b["value"] == 95 and b["mean"] == 97
    few = public.benchmarks({"canton": docs["municipality"][:10]}, mdl)["canton"]["overall"]
    assert few["mode"] == "best" and few["value"] == 9
    json.dumps(public.overview(docs, mdl))

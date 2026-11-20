"""Choosing the UID that stands for a whole canton, municipality or department.
The result lists are shaped like answers of the UID register's public search."""
from tlsmap import uidreg
from tlsmap.config import Entity
from tlsmap.merge import apply_uids


def r(name, uid="CHE-100.000.001", form="0223", status="3", add=""):
    return {"uid": uid, "name": name, "add": add, "form": form, "status": status, "town": "", "kt": ""}


def test_municipality_main_unit_not_sub_units():
    res = [r("Politische Gemeinde Bonstetten", "CHE-114.855.706"),
           r("Politische Gemeinde Bonstetten, Wasserversorgung", "CHE-112.540.404"),
           r("Politische Gemeinde Bonstetten", "CHE-165.068.825", add="(UID-Stelle)"),
           r("Schulgemeinde Bonstetten", "CHE-100.000.009"),
           r("Politische Gemeinde Bonstetten, Kabelnetz", "CHE-112.540.367", status="5")]
    hit, _ = uidreg.pick_municipality(res, "Bonstetten")
    assert hit["uid"] == "CHE-114.855.706"


def test_municipality_name_containing_a_unit_word():
    # "Neuheim" contains "heim": only words beyond the municipality's own name count
    hit, _ = uidreg.pick_municipality([r("Einwohnergemeinde Neuheim"), r("Einwohnergemeinde Neuheim, Wasserversorgung")], "Neuheim")
    assert hit["name"] == "Einwohnergemeinde Neuheim"


def test_municipality_with_canton_suffix_and_french_name():
    assert uidreg.pick_municipality([r("Gemeinde Schmitten (GR)")], "Schmitten (GR)")[0]
    assert uidreg.pick_municipality([r("Commune d'Aigle"), r("Commune d'Aigle, Service des eaux")], "Aigle")[0]["name"] == "Commune d'Aigle"


def test_municipality_left_open_when_unclear():
    hit, cands = uidreg.pick_municipality([r("Gemeinde Nirgendwo"), r("Stadt Irgendwo")], "Bern")
    assert hit is None and len(cands) == 2


def test_canton_plain_name_wins():
    res = [r("Repubblica e Cantone Ticino", "CHE-467.167.629", form="0221"),
           r("Repubblica e Cantone Ticino DFE. Sezione dell'agricoltura", form="0221"),
           r("Polizia cantonale", form="0221")]
    hit, _ = uidreg.pick_canton(res, "Kanton Tessin", "TI")
    assert hit["uid"] == "CHE-467.167.629"


def test_federal_department_by_tag_despite_commas():
    res = [r("Eidgenössisches Departement für Verteidigung, Bevölkerungsschutz und Sport (VBS)", "CHE-132.071.565", form="0220"),
           r("Eidgenössisches Departement für auswärtige Angelegenheiten (EDA), Informatik", form="0220")]
    assert uidreg.pick_federal(res, "VBS", "VBS")[0]["uid"] == "CHE-132.071.565"
    assert uidreg.pick_federal(res, "EDA", "EDA")[0] is None


class FakeRegister:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def search(self, **kw):
        self.calls.append(kw)
        return self.answers.get(kw.get("municipality") or kw.get("name"), [])

    def save(self):
        pass


def test_resolve_uses_pins_and_keeps_known_uids():
    ents = [Entity("municipality", "3", "Bonstetten", []), Entity("municipality", "1705", "Neuheim", []),
            Entity("municipality", "9999", "Pinned", [])]
    reg = FakeRegister({1705: [r("Einwohnergemeinde Neuheim", "CHE-115.081.522")]})
    prev = {"municipality": {"3": {"uid": "CHE-114.855.706", "match": "auto"}}}
    pins = {"municipality": {"9999": {"uid": "CHE-999.999.999"}}}
    out = uidreg.resolve(ents, reg, pins, prev)
    assert out["municipality"]["3"]["uid"] == "CHE-114.855.706"
    assert out["municipality"]["1705"]["uid"] == "CHE-115.081.522"
    assert out["municipality"]["9999"]["match"] == "pinned"
    assert [c["municipality"] for c in reg.calls] == [1705]


def test_apply_uids_leaves_organisations_alone(tmp_path):
    p = tmp_path / "entities.json"
    uidreg.write(p, {"municipality": {"3": {"uid": "CHE-114.855.706", "name": "Politische Gemeinde Bonstetten"}},
                     "organisation": {"x": {"uid": "CHE-000.000.000"}}})
    result = {"entities": [{"kind": "municipality", "id": "3"}, {"kind": "organisation", "id": "x", "uid": "CHE-123.456.789"}]}
    assert apply_uids(result, p) == 1
    assert result["entities"][0]["uid"] == "CHE-114.855.706"
    assert result["entities"][1]["uid"] == "CHE-123.456.789"


def test_fmt_and_parse():
    assert uidreg.fmt_uid("114855706") == "CHE-114.855.706"
    xml = ('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><SearchResponse xmlns="x">'
           '<SearchResult><a:uidEntitySearchResultItem xmlns:a="y"><a:organisation><b:organisation xmlns:b="z">'
           '<b:organisationIdentification><b:uid><b:uidOrganisationIdCategorie>CHE</b:uidOrganisationIdCategorie>'
           '<b:uidOrganisationId>114855706</b:uidOrganisationId></b:uid><b:organisationName>Politische Gemeinde Bonstetten</b:organisationName>'
           '<b:legalForm>0223</b:legalForm></b:organisationIdentification></b:organisation>'
           '<b:uidregInformation xmlns:b="z"><b:uidregStatusEnterpriseDetail>3</b:uidregStatusEnterpriseDetail></b:uidregInformation>'
           '</a:organisation></a:uidEntitySearchResultItem></SearchResult></SearchResponse></s:Body></s:Envelope>')
    out = uidreg.parse(xml)
    assert out[0]["uid"] == "CHE-114.855.706" and out[0]["form"] == "0223" and out[0]["status"] == "3"

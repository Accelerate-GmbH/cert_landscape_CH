"""Dependencies read from DNS and network data (config/stack.toml)."""
from tlsmap import stack


def test_providers_by_pattern():
    assert stack.provider_for("mx", "zg-ch.mail.protection.outlook.com")[1]["name"] == "Microsoft 365"
    assert stack.provider_for("spf", "spf.protection.outlook.com")[1]["name"] == "Microsoft 365"
    assert stack.provider_for("txt", "google-site-verification=abc")[1]["name"] == "Google Workspace"
    assert stack.provider_for("cname", "foo.trafficmanager.net")[1]["name"] == "Microsoft Azure"
    assert stack.provider_for("asn", "Infomaniak Network SA")[1]["country"] == "CH"
    assert stack.provider_for("redirect", "login.microsoftonline.com")[1]["kind"] == "idp"
    assert stack.provider_for("mx", "mail.example.ch") is None
    # a suffix must end at a label: "notoutlook.com" is not outlook.com
    assert stack.provider_for("cname", "notoutlook.com") is None


def test_app_type_from_host_name():
    assert stack.app_type("login.zg.ch") == "login"
    assert stack.app_type("sts001.example.ch") == "login"
    assert stack.app_type("gever.bonstetten.ch") == "gever"
    assert stack.app_type("www.bonstetten.ch") == "website"
    assert stack.app_type("bonstetten.ch") == "website"
    assert stack.app_type("vpn2.example.ch") == "remote"
    assert stack.app_type("xyz.example.ch") == "other"


def test_entity_stack():
    entity = {"mail": {"domains": [{
        "domain": "example.ch",
        "mx": [{"host": "example-ch.mail.protection.outlook.com", "nets": [["Microsoft Corporation", "US"]]}],
        "checks": [{"check": "mail.spf", "value": "v=spf1 include:spf.protection.outlook.com include:servers.mcsv.net -all"}],
        "txt": ["atlassian-domain-verification=xyz"]}]}}
    rows = [
        {"hostname": "www.example.ch", "in_use": True, "cnames": [], "as_name": "Infomaniak Network SA", "net_country": "CH"},
        {"hostname": "login.example.ch", "in_use": True, "cnames": [], "as_name": "Kanton X", "net_country": "CH",
         "http_sec": {"location_host": "login.microsoftonline.com"}},
        {"hostname": "old.example.ch", "in_use": False},
    ]
    sk = stack.entity_stack(entity, rows)
    assert sk["mail"] == [["Microsoft 365", "US", 1]]
    assert ["Mailchimp", "US"] in sk["send"]
    assert ["Microsoft 365", "US"] in sk["saas"] and ["Atlassian", "AU"] in sk["saas"]
    assert sk["idp"] == [["Microsoft Entra ID", "US"]]
    assert ["Infomaniak", "CH", 1] in sk["cloud"] and ["Kanton X", "CH", 1] in sk["cloud"]
    assert sk["apps"] == {"website": 1, "login": 1}

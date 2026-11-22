// Labels of the model. Check texts come from the existing guide (../guide.js),
// so both versions of the map explain a check in the same words.
export const LAYERS = {
  apps: { name: "Applikationen", hint: "Websites, Portale, Logins und weitere Dienste" },
  dpi: { name: "Identität, Daten- und Werteaustausch", hint: "Fähigkeiten, die Applikationen einbauen: Identität (E-ID), Authentifizierung (AGOV), Datenaustausch (sedex, I14Y), Zahlungen" },
  ext: { name: "Erweiterte Dienste", hint: "Transportsicherheit, Mail, Privatsphäre, Sicherheitskontakt" },
  trust: { name: "Vertrauensinfrastruktur", hint: "swiyu mit Base und Trust Registry, Siegel, Zeitstempel: Grundlage für Identität und rechtssicheren Geschäfts- und Datenverkehr" },
  cloud: { name: "Cloud-Dienste", hint: "Infrastruktur, Plattformen und Dienste aus der Cloud" },
  net: { name: "Netz-Grundbausteine", hint: "Registrar, DNS, Zertifikat, Hosting" },
};
// layers that form the digital public infrastructure (group "dpi" in the model)
export const GROUPS = {
  dpi: { name: "Digitale öffentliche Infrastruktur (DPI)", hint: "Bausteine, auf denen viele Dienste aufbauen und die in Schweizer Kontrolle betrieben werden müssen" },
};
export const CONTROL = {
  name: "Kontrollschicht",
  hint: "Quer durch alle Schichten: pro Baustein der Hebel, den eine Organisation halten muss, um selbst handeln zu können. Entwurf, erscheint nach Prüfung der Quellen.",
};
export const BLOCKS = {
  "net.registrar": "Registrar", "net.dns": "DNS", "net.cert": "Zertifikat und CA", "net.hosting": "Hosting",
  "cloud.infra": "Infrastruktur", "cloud.platform": "Plattform und SaaS",
  "trust.swiyu": "swiyu", "trust.seal": "Siegel, QES", "trust.timestamp": "Zeitstempel",
  "ext.transport": "TLS, HSTS, PQC", "ext.mail": "Mail", "ext.privacy": "Privatsphäre", "ext.contact": "Sicherheitskontakt",
  "dpi.identity": "Identität", "dpi.exchange": "Datenaustausch", "dpi.value": "Werteaustausch",
  "apps.services": "Dienste",
};
export const BLOCK_WHAT = {
  "net.registrar": "Anteil Domains bei einem Registrar in der Schweiz",
  "net.dns": "DNS-Betrieb in Schweizer Hand oder verteilt, DNSSEC",
  "net.cert": "Schweizer Zertifizierungsstelle, Identität im Zertifikat, Widerruf, CAA, Transparenz",
  "net.hosting": "Server in der Schweiz oder im eigenen Netz, Schweizer Domain",
  "cloud.infra": "Anteil Hosts bei Schweizer Betreibern",
  "cloud.platform": "Anteil erkannter SaaS-Dienste aus der Schweiz",
  "ext.transport": "TLS 1.3, Post-Quanten-Verfahren, nur verschlüsselte Verbindung",
  "ext.mail": "Sechs Mail-Prüfungen von Serverstandort bis DMARC",
  "ext.privacy": "Encrypted Client Hello verbirgt die besuchte Adresse",
  "ext.contact": "security.txt mit Kontakt für Sicherheitsmeldungen",
  "dpi.identity": "nur die Authentifizierung: Anteil erkannter Login-Anbieter aus der Schweiz",
};
export const LEVELS = [
  ["federal", "Bund"], ["canton", "Kantone"], ["municipality", "Gemeinden"], ["organisation", "Kritische Dienste"],
];
export const LEVEL_ONE = { federal: "Departement", canton: "Kanton", municipality: "Gemeinde", organisation: "Organisation" };
export const LEVEL_MANY = { federal: "Departemente", canton: "Kantone", municipality: "Gemeinden", organisation: "Organisationen" };
export const LEVEL_DAT = { federal: "Departementen", canton: "Kantonen", municipality: "Gemeinden", organisation: "Organisationen" };
export const APPS = {
  website: "Website", portal: "Portal", login: "Login", mail: "Mail", gever: "GEVER", payment: "Bezahlen", api: "Schnittstelle",
  remote: "Fernzugriff", collab: "Zusammenarbeit", geo: "Geodaten", intranet: "Intern", school: "Schule", test: "Test", other: "andere",
};
export const CATS = { ownership: "Eigentum und Kontrolle", sovereignty: "Souveränität", security: "Sicherheit", privacy: "Privatsphäre" };

const G = () => (window.GUIDE && window.GUIDE.de) || {};
export const checkName = (id) => (G().s || {})[id] || (G().ui || {})[id] || id;
export const checkText = (id, role) => {
  const c = (G().checks || {})[id] || {};
  return role === "tech" ? c.x || c.s || "" : c.s || "";
};
// why it matters beyond the technical cause: one line per category, the same for every role
export const WHY = {
  ownership: "Wer Domain, DNS und Zertifikate nicht selbst kontrolliert, kann im Ernstfall nicht selbst handeln.",
  sovereignty: "Liegt ein Baustein bei einem Anbieter im Ausland, gilt dessen Recht und dessen Entscheid, etwa bei Sanktionen oder Ausfällen.",
  security: "Veraltete Verschlüsselung macht Daten heute oder später lesbar, auch für Angreifer mit Quantencomputern.",
  privacy: "Ohne Schutz sieht jedes Netz unterwegs, welche Dienste jemand nutzt.",
  mail: "Mail ist der häufigste Weg für Betrug und Datenabfluss; ohne Schutz lässt sich der Absender fälschen.",
};

// Texts of the interface, by language; only German so far. New views take their
// texts from here so that French, Italian and English can be added without
// touching the views. {name} is replaced by the value given.
const T = {
  de: {
    overall: "Gesamtwert", total_and_areas: "Gesamtwert und Bereiche", mail: "Mail", function: "Funktion", benchmark: "Vergleichswert", gap: "Abstand",
    who_reaches: "Wer ihn erreicht", best_top: "Ø beste {p} %", best_one: "Bester",
    compare_title: "Vergleich", per_function: "{n} pro Funktion",
    explain_top: "Vergleichswert: Durchschnitt der besten {p} % aller {lv}. Daneben, wer ihn erreicht; ⇄ stellt diese Einheit daneben.",
    explain_best: "Vergleichswert: der Beste unter den {lv}. Daneben, wer ihn erreicht; ⇄ stellt diese Einheit daneben.",
    compare_with: "{n} daneben stellen", remove: "entfernen",
    other_level: "{n} ist ein(e) {lv}; die Rangliste unten zeigt eine andere Ebene.",
    no_home: "Wählen Sie oben eine Organisation oder legen Sie eine Heim-Organisation fest, um sie mit den Besten zu vergleichen. Die Rangliste unten gilt für alle.",
    does_differently: "Was {n} anders macht", no_difference: "Bei keiner Prüfung mindestens 20 Punkte besser.",
    ranking: "Rangliste", sort_by: "Sortiert nach", canton: "Kanton", sector: "Sektor", all: "alle",
    trend: "Entwicklung", trend_one: "Erster Stand {m}. Der Verlauf erscheint ab dem nächsten Monatslauf.",
    trend_none: "Noch kein Monatslauf mit einem Wert.", month: "Monat", trend_chart: "Gesamtwert pro Monat, 0 bis 100",
    merged_into: "Seit {d} Teil dieser Gemeinde: {n}", last_value: "letzter Wert {v} ({m})", change: "{d} Punkte seit {m}",
    deps_title: "Abhängigkeiten",
    deps_intro: "Welche Anbieter wie viele Organisationen tragen, aufgeteilt nach Funktion. Pro Funktion steht, ob sie über ein offenes Protokoll oder eine Plattform läuft.",
    deps_note: "Aus öffentlichen DNS-Einträgen, Netzwerken, Zertifikaten und Weiterleitungen. Was intern genutzt wird, ist nicht sichtbar.",
    cluster_lead: "Der grösste Anbieter, {name}, trägt {p} % aller {lv} ({f}).",
    any_function: "alle Funktionen", by_group: "nach Konzern zusammenfassen", group: "Konzern oder Anbieter", products: "Produkte",
    provider: "Anbieter", functions: "Funktionen", depend: "abhängige {lv}", who_depends: "Wer davon abhängt",
    part_of: "Gehört zu {p}", not_found: "Nicht gefunden",
    fn_mail: "Mail", fn_send: "Versand", fn_saas: "SaaS", fn_idp: "Login", fn_cloud: "Cloud und Hosting", fn_ca: "Zertifikate (CA)", fn_dns: "DNS",
    model_protocol: "offenes Protokoll", model_platform: "Plattform",
    swap_easy: "leicht ersetzbar", swap_effort: "mit Aufwand und Kosten ersetzbar", swap_hard: "schwer ersetzbar",
    assessment: "Einschätzung des Trust & Sovereignty Posture Radar.", checked_on: "Geprüft am {d}", sources: "Quellen",
    repl_data: "Daten beim Anbieter", repl_export: "Herausnehmen und weiterverwenden", repl_costs: "Kosten eines Wechsels",
    kind_saas: "SaaS", kind_sending: "Versanddienst", kind_send: "Versanddienst", kind_idp: "Login-Anbieter", kind_cloud: "Cloud",
    kind_cdn: "Content Delivery Network", kind_hosting: "Hosting", kind_mailsec: "Mail-Filter", kind_network: "Netz (Hosting)",
    kind_ca: "Zertifizierungsstelle", kind_dns: "DNS-Betreiber", kind_mail: "Mail-Betreiber",
    rests_on: "Worauf die Hosts ruhen", used_by: "Wer es nutzt (erkannt)",
    "rest_sov.ca": "Zertifizierungsstelle", "rest_sov.dns": "DNS-Betrieb", "rest_sov.hosting": "Hosting", "rest_sov.registrar": "Registrar",
    hosts: "Hosts", mean_of_hosts: "Durchschnitt der {n} Hosts, die den Dienst betreiben",
    host_roles: "Gezählt: {s} Hosts des Dienstes. Nicht gezählt: Informationsseiten {i}, Testumgebungen {t}. Eingeteilt nach Aufruf der Startseite am {d}.",
    host_other: "{o} weitere Hosts sind nicht eingeteilt und nicht gezählt, weil die Bedeutung ihrer Namenszusätze nicht belegt ist.",
    not_checked: "nicht geprüft",
    unclassified: "Die Hosts sind noch nicht nach Betrieb, Information und Test eingeteilt; alle fliessen ein, auch Testumgebungen.", no_hosts: "Keine Hosts gemessen.",
    measured_hosts: "Gemessene Hosts", users_none: "noch keine erkannt; Weiterleitungen werden ab dem Monatslauf vom 2.12.2026 erhoben",
    use_unmeasured: "Nutzung noch nicht gemessen",
    impl_count: "{n} Umsetzungen erfasst", impl_one: "1 Umsetzung erfasst",
    instead: "Stattdessen genutzt: ausländische Login-Anbieter",
    aspect_identity: "Wer eine Person oder Organisation ist.",
    aspect_authentication: "Der Nachweis beim Zugang, dass jemand diese Identität besitzt.",
    aspect_authority: "Was jemand darf, etwa eine Zeichnungsberechtigung oder eine Rolle in einer Behörde.",
    aspect_agency: "Handeln im Auftrag eines anderen, etwa mit Vollmacht oder Delegation.",
    aspects_note: "Das interne Zugangs- und Berechtigungssystem einer Organisation (IAM) gehört zu keinem dieser Aspekte; es ist ein Hebel der Kontrollschicht.", measured_as: "Gemessen als",
    dpi_term: "Begriff", overview: "Überblick", no_implementation: "Noch keine Umsetzung mit Quelle erfasst.",
    basics_title: "Grundlagen",
    basics_intro: "Wie der Radar misst und bewertet, auf welchen Standards jede Prüfung beruht und woher die Daten stammen. Gewichte und Schwellen kommen aus denselben Daten wie die Werte auf den anderen Seiten.",
    data_as_of: "Stand der Daten {d}", links_checked: "Links geprüft am {d}",
    how_rated: "Wie bewertet wird",
    rating_text: "Jede Prüfung eines Dienstes ist erfüllt (1 Punkt), teilweise erfüllt ({p}) oder nicht erfüllt (0). Ein Bereich ist der gewichtete Anteil der Punkte seiner Prüfungen, der Gesamtwert eines Dienstes der gewichtete Durchschnitt der Bereiche. Ein ungültiges oder widerrufenes Zertifikat setzt den Gesamtwert des Dienstes auf 0. Für eine Organisation zählen kritische Dienste {c}-fach. Die Ampel ist grün ab {g}, gelb ab {y} und darunter rot.",
    weight: "Gewicht", check: "Prüfung", standard: "Standard oder Regel",
    mail_separate: "eigene Bewertung pro Maildomain, fliesst nicht in den Gesamtwert ein",
    blocks_title: "Bausteine und ihre Quellen", block: "Baustein", measured_by: "Gemessen über", data_sources: "Datenquellen",
    not_measured: "noch nicht gemessen", mail_checks: "die Mail-Prüfungen oben",
    dpi_title: "Digitale öffentliche Infrastruktur",
    dpi_text: "Den Begriff und die Einteilung in Identität, Zahlungen und Datenaustausch übernimmt der Radar von UNDP; die Unterscheidung von Identität und Authentifizierung folgt NIST.",
    limits_title: "Grenzen der Messung",
    limits_text: "Gemessen wird, was öffentlich sichtbar ist: DNS-Einträge, Zertifikate aus Certificate Transparency, Netze und die Antworten der Dienste selbst. Interne Systeme, Dienste im Hintergrund einer Applikation, GEVER, Siegel und Zeitstempel sind von aussen kaum oder nicht sichtbar. Die Messungen laufen in Rechenzentren von GitHub in den USA und in Europa; ein Dienst, der je nach Herkunft anders antwortet, kann deshalb anders erscheinen als für Nutzer in der Schweiz.",
    raw_title: "Rohdaten",
    raw_text: "Die Website zeigt verdichtete Werte. Rohdaten erhalten Fachleute auf Anfrage mit einer schriftlichen Vereinbarung.",
    rated_of: "{r} von {n} bewertet", own_rank: "eigener Rang {r}", rank: "Rang", show_all: "Alle {n} anzeigen",
  },
};
export const LANG = "de";
export function t(key, vars = {}) {
  const s = (T[LANG] || T.de)[key] ?? T.de[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
export const monthName = (m) => {
  const [y, mo] = (m || "").split("-").map(Number);
  return y ? new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("de-CH", { month: "short", year: "numeric", timeZone: "UTC" }) : m;
};

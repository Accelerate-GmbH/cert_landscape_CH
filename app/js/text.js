// Labels of the model. Check texts come from the existing guide (../guide.js),
// so both versions of the map explain a check in the same words.
export const LAYERS = {
  apps: { name: "Applikationen", hint: "Websites, Portale, Logins und weitere Dienste" },
  control: { name: "Kontrollschicht", hint: "Identität, Datenaustausch, Werteaustausch: hält die strategischen Kontrollpunkte und macht Grunddienste austauschbar. Gibt es heute nicht." },
  ext: { name: "Erweiterte Dienste", hint: "Transportsicherheit, Mail, Privatsphäre, Sicherheitskontakt" },
  trust: { name: "Vertrauensinfrastruktur", hint: "swiyu mit Trust Protocol, Siegel, Zeitstempel" },
  cloud: { name: "Cloud-Dienste", hint: "Infrastruktur, Plattformen und Dienste aus der Cloud" },
  net: { name: "Netz-Grundbausteine", hint: "Registrar, DNS, Zertifikat, Hosting" },
};
export const BLOCKS = {
  "net.registrar": "Registrar", "net.dns": "DNS", "net.cert": "Zertifikat und CA", "net.hosting": "Hosting",
  "cloud.infra": "Infrastruktur", "cloud.platform": "Plattform und SaaS",
  "trust.swiyu": "swiyu", "trust.seal": "Siegel, QES", "trust.timestamp": "Zeitstempel",
  "ext.transport": "TLS, HSTS, PQC", "ext.mail": "Mail", "ext.privacy": "Privatsphäre", "ext.contact": "Sicherheitskontakt",
  "control.identity": "Identität", "control.exchange": "Datenaustausch", "control.value": "Werteaustausch",
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
  "control.identity": "Anteil erkannter Login-Anbieter aus der Schweiz",
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

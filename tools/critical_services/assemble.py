import json, re, collections
R=json.load(open('dns.json'))
orgs=[l.split('|') for l in open('orgs.txt',encoding='utf-8').read().splitlines() if l and not l.startswith('#')]
SEK={'BEH':'Behörden','SIC':'Öffentliche Sicherheit','FIN':'Finanzen','GES':'Gesundheit','ENE':'Energie','IKT':'IKT & Vertrauensinfrastruktur','VER':'Verkehr & Logistik','NAH':'Detailhandel & Nahrung','MED':'Medien','BIL':'Bildung & Forschung','INT':'Internationale Organisationen'}
TR={'o':'öffentlich','h':'halbprivat','p':'privat'}
TYPE={
 'login':(1,'Login-Endpunkt'),'auth':(1,'Authentisierungs-Endpunkt'),'id':(1,'Identitäts-Endpunkt'),'sso':(1,'Single-Sign-on'),'account':(2,'Kontoverwaltung'),
 'ebanking':(1,'E-Banking'),'e-banking':(1,'E-Banking'),'netbanking':(1,'E-Banking'),'banking':(1,'Online-Banking'),'online':(2,'Online-Kundenzugang'),
 'portal':(2,'Kundenportal'),'my':(2,'Kundenkonto'),'mein':(2,'Kundenkonto'),'kunden':(2,'Kundenportal'),'customer':(2,'Kundenportal'),
 'app':(5,'Web-App'),'api':(5,'API/Schnittstelle'),'shop':(5,'Online-Shop'),'secure':(2,'Gesicherter Kundenbereich'),'webmail':(25,'Webmail')}
WHY={1:'Zugangspunkt für Kunden bzw. Mitarbeitende; Ausfall sperrt Nutzer aus, Kompromittierung ermöglicht Kontoübernahmen',
     2:'Bereich mit Personen- und Vertragsdaten; bevorzugtes Ziel von Phishing und Account-Takeover',
     5:'Schnittstelle bzw. Kanal für Apps, Partner oder Bestellungen; Ausfall unterbricht automatisierte Abläufe',
     25:'Webmail-Zugang (meist Mitarbeitende); häufiger Einstiegspunkt für Angriffe auf die Organisation'}
rows={}
def add(h,org,sek,tr,tier,why,typ,rank):
    if h in rows: return
    rows[h]=dict(hostname=h,organisation=org,sektor=sek,traegerschaft=tr,stufe=int(tier),typ=typ,warum_kritisch=why,_score=int(tier)*10+rank)
# admin hosts first (curated)
for l in open('admin_hosts.txt',encoding='utf-8').read().splitlines():
    if not l or l.startswith('#'): continue
    p=l.split('|'); h,org,sek,tier,why=p[:5]; trg={'p':'privat','h':'halbprivat'}.get(p[5] if len(p)>5 else '','öffentlich')
    typ='Login/Identität' if re.search(r'(idp|auth|login|eiam|op\.agov|pams|ebanking|onba)',h) else ('Register/Vertrauensinfrastruktur' if 'swiyu' in h else 'Fachanwendung')
    add(h,org,SEK[sek],trg,tier,why,typ,0 if typ!='Fachanwendung' else 1)
wild=0
for d,org,sek,tr,tier,why in orgs:
    if d=='admin.ch':
        add('www.admin.ch',org,SEK[sek],TR[tr],tier,why,'Website/Portal',0); continue
    main='www.'+d if R.get('www.'+d) else (d if R.get(d) else None)
    if main: add(main,org,SEK[sek],TR[tr],tier,why,'Website/Portal',0)
    wc=[v for k,v in R.items() if k.endswith('.'+d) and re.match(r'^[0-9a-f]{12}\.',k) and k.count('.')==d.count('.')+1]
    wips=set(wc[0]) if wc and wc[0] else None
    if wips: wild+=1
    for p,(rk,label) in TYPE.items():
        h=f'{p}.{d}'; ips=R.get(h)
        if not ips: continue
        if wips and set(ips)==wips: continue
        if wips: continue  # Wildcard-Zonen: Treffer nicht belastbar
        add(h,org,SEK[sek],TR[tr],tier,f'{label} von {org}: {WHY[rk]}',label,rk)
print('wildcard zones',wild,'rows',len(rows))
print(collections.Counter(r['stufe'] for r in rows.values()))
json.dump(list(rows.values()),open('rows.json','w'),ensure_ascii=False)

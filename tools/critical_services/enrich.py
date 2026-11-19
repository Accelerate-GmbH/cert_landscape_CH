import csv,json,re,unicodedata,collections
from urllib.parse import urlparse
rows=list(csv.DictReader(open('kritische_digitale_services_ch_top1000.csv',encoding='utf-8-sig')))
R=json.load(open('http.json'))
M={l.split('|')[0]:l.split('|') for l in open('orgmap.txt',encoding='utf-8').read().splitlines() if l and not l.startswith('#')}
cache=json.load(open('uidcache.json'))
import os
extra=json.load(open('uidextra.json')) if os.path.exists('uidextra.json') else {}
ALL={}
for v in list(cache.values())+list(extra.values()):
    for x in v.get('results',[]): ALL.setdefault(x['uid'],x)
SEK={'B':'Behörden','E':'Energie','F':'Finanzen','G':'Gesundheit','I':'Information und Kommunikation','N':'Nahrung','S':'Öffentliche Sicherheit','V':'Verkehr','X':''}
TS={'PRJV':'Parlament, Regierung, Justiz, Verwaltung','FL':'Forschung und Lehre','KG':'Kulturgüter','STROM':'Stromversorgung','GAS':'Erdgasversorgung','OEL':'Erdölversorgung','FW':'Fern- und Prozesswärme','FD':'Finanzdienstleistungen','VD':'Versicherungsdienstleistungen','MV':'Medizinische Versorgung','LAB':'Labordienstleistungen','CH':'Chemie und Heilmittel','IT':'IT-Dienstleistungen','TK':'Telekommunikation','MED':'Medien','POST':'Postdienste','LM':'Lebensmittelversorgung','WV':'Wasserversorgung','ARM':'Armee','BLAU':'Blaulichtorganisationen','ZS':'Zivilschutz','LUFT':'Luftverkehr','BAHN':'Schienenverkehr','SCHIFF':'Schiffsverkehr','STR':'Strassenverkehr','':''}
OVR={'AIL':'CHE-105.969.920','AdNovum':'CHE-106.013.711','CARA (EPD-Gemeinschaft)':'CHE-356.327.035','Bundesstrafgericht':'CHE-265.476.805','CERN':'CHE-108.967.751',
'Carbura':'CHE-105.841.616','IKRK':'CHE-105.924.024','ELCA':'CHE-105.944.452','Energie 360°':'CHE-106.839.415','Generali Schweiz':'CHE-105.991.440','Genève Aéroport':'CHE-108.913.293',
'HFR Hôpital fribourgeois':'CHE-113.175.595','Hupac':'CHE-106.844.385','HUG':'CHE-108.907.884','ITU':'CHE-498.972.006','WHO':'CHE-440.062.067','WIPO':'CHE-462.076.735','WTO':'CHE-467.353.304',
'UNO Genf':'CHE-328.330.061','Kantonsspital Graubünden':'CHE-112.957.968','Primeo Energie':'CHE-105.932.928','Hirslanden':'CHE-113.796.171','RSI':'CHE-460.782.578','SBB Cargo':'CHE-100.866.483',
'Swissmedic':'CHE-108.952.985','SEPOS':'CHE-488.645.267','Swiss Re':'CHE-102.979.129','Swissquote':'CHE-102.383.586','Yuh (Swissquote/PostFinance)':'CHE-102.383.586','Threema':'CHE-487.082.806',
'Tox Info Suisse':'CHE-107.827.343','Viseca':'CHE-105.243.616','ZAS':'CHE-200.474.557','État de Fribourg':'CHE-114.965.163','Schweizerisches Rotes Kreuz':'CHE-105.903.074',
'edulog':'CHE-271.002.692','OFAC':'CHE-107.755.086','Swisstransplant':'CHE-100.390.782','Medgate':'CHE-440.718.407','Medbase':'CHE-112.648.125','esisuisse':'CHE-406.991.378',
'compenswiss (AHV-Ausgleichsfonds)':'CHE-115.188.083','SASIS':'CHE-455.517.384','MediData':'CHE-107.618.934','Refdata':'CHE-109.531.422','Nevis Security':'CHE-299.693.105',
'Equinix Schweiz':'CHE-100.935.049','SwissIX':'CHE-110.460.993','Init7':'CHE-101.606.393','Quickline':'CHE-107.530.104','green.ch':'CHE-113.574.742','Sunrise':'CHE-106.848.147',
'Hostpoint':'CHE-101.974.997','Infomaniak':'CHE-103.167.648','Inventx':'CHE-115.804.226','Avaloq':'CHE-103.836.490','Finnova':'CHE-108.242.607','Armee':'CHE-132.071.565','VBS':'CHE-132.071.565',
'Galexis':'CHE-105.973.991','Securitas':'CHE-106.832.531','Skyguide':'CHE-106.029.770','EPFL':'CHE-116.075.613','Verein eCH':'CHE-267.752.399',
'SWITCH':'CHE-101.494.993','SWITCH Registry':'CHE-101.494.993','SWITCH edu-ID':'CHE-101.494.993','SRG SSR':'CHE-102.978.667','SWI swissinfo.ch':'CHE-102.978.667','SRF':'CHE-102.978.667','RTS':'CHE-102.978.667','RSI':'CHE-102.978.667',
'BLS':'CHE-112.898.515','Universitätsspital Zürich':'CHE-108.904.325','Kanton Basel-Landschaft':'CHE-114.809.333','Stadt Bern':'CHE-115.140.892','Suva':'CHE-271.029.455','ZVV':'CHE-472.268.704',
'Stiftung Auffangeinrichtung BVG':'CHE-187.252.001','Stadt Uster':'CHE-114.885.274','VRSG':'CHE-106.840.022'}
FBN={'Université de Lausanne':'Université de Lausanne','ComCom':'Eidgenössische Kommunikationskommission (ComCom)','PostCom':'Eidgenössische Postkommission (PostCom)','EDÖB':'Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)','eHealth Suisse':'eHealth Suisse','QuoVadis (DigiCert)':'QuoVadis Trustlink Schweiz AG','Amedis-UE':'Amedis-UE AG','Saviva':'Saviva AG','Blick':'Ringier Medien Schweiz AG','Brack.ch':'BRACK.CH AG','Digitale Verwaltung Schweiz':'Digitale Verwaltung Schweiz (DVS)','Digitale Verwaltung Schweiz (DVS)':'Digitale Verwaltung Schweiz (DVS)','EuroAirport Basel-Mulhouse':'EuroAirport Basel-Mulhouse-Freiburg','Zur Rose':'Zur Rose','ETH Zürich':'Eidgenössische Technische Hochschule Zürich (ETH Zürich)','CSCS':'Eidgenössische Technische Hochschule Zürich (ETH Zürich)','Schweizerischer Erdbebendienst':'Eidgenössische Technische Hochschule Zürich (ETH Zürich)','20 Minuten':'20 Minuten','Gaznat':'Gaznat SA','Axsana (EPD)':'Axsana AG','Unilabs':'Unilabs','TCS':'Touring Club Suisse (TCS)','Kernkraftwerk Leibstadt':'Kernkraftwerk Leibstadt AG','Kantonsspital St. Gallen':'Kantonsspital St. Gallen','SVGW':'Schweizerischer Verein des Gas- und Wasserfaches (SVGW)','Nationalbibliothek':'Schweizerische Nationalbibliothek (NB)','Polizei (Portal)':'','Sanitätsnotruf 144':'','BFS':'Bundesamt für Statistik (BFS)','BFS sedex':'Bundesamt für Statistik (BFS)','BFS I14Y':'Bundesamt für Statistik (BFS)','BFS UID-Register':'Bundesamt für Statistik (BFS)','Bundesgericht':'Schweizerisches Bundesgericht'}
SRGNOTE='Unternehmenseinheit der SRG; UID der Schweizerischen Radio- und Fernsehgesellschaft'
NOUID={'TCS','Brack.ch','Unilabs','Zur Rose','20 Minuten','Blick','Nationalbibliothek','Kantonsspital St. Gallen','Kernkraftwerk Leibstadt','ETH Zürich','CSCS','Schweizerischer Erdbebendienst','Digitale Verwaltung Schweiz','Digitale Verwaltung Schweiz (DVS)','EuroAirport Basel-Mulhouse','Gaznat','Amedis-UE','Axsana (EPD)','Saviva','ComCom','PostCom','EDÖB','QuoVadis (DigiCert)','Université de Lausanne','eHealth Suisse','SVGW','Polizei (Portal)','Sanitätsnotruf 144','Bundesgericht','BFS','BFS sedex','BFS I14Y','BFS UID-Register'}
def norm(s):
    s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower(); return re.sub(r'[^a-z0-9]+',' ',s).strip()
def autopick(q):
    allr=[x for x in cache.get(q,{}).get('results',[]) if x['status']=='3' and x['legalForm']!='0302']
    res=[x for x in allr if 'uid stelle' not in norm(x.get('add'))] or allr
    nq=norm(q)
    def base(n): return re.sub(r'\s*\(.*?\)\s*$','',n).strip()
    c=[x for x in res if norm(base(x['name']))==nq or norm(x['name'])==nq or (norm(x['name']).startswith(nq+' ') and ',' not in x['name'] and len(norm(x['name']).split())-len(nq.split())<=1)]
    nb=[x for x in c if x['legalForm'] not in (None,'0151')] or [x for x in c if x['legalForm']!='0151']
    c=nb
    if len({x['uid'] for x in c})>1:
        gov=[x for x in c if x['legalForm'] in ('0220','0221','0223','0224')]
        par=[x for x in (gov or c) if re.search(r'\([A-Za-zÄÖÜäöü\- ]+\)$',x['name'])]
        for sel in (par,gov):
            if len({x['uid'] for x in sel})==1: return sel[0],''
        return dict(_name=re.sub(r'\s*\(.*?\)\s*$','',c[0]['name'])+(' ('+re.search(r'\(([^)]*)\)\s*$',c[0]['name']).group(1)+')' if re.search(r'\(([^)]*)\)\s*$',c[0]['name']) else '')),'mehrere gleichnamige UID-Einträge'
    if c: return c[0],''
    return None,'kein Eintrag im UID-Register gefunden'
ORG={}
for lab,m in M.items():
    q=m[1]; hint=m[4] if len(m)>4 else ''
    if lab in OVR: e=ALL.get(OVR[lab]); why=''
    elif lab in NOUID or not q: e=None; why='kein eindeutiger Eintrag im UID-Register gefunden'
    else: e,why=autopick(q)
    fallback=q or lab
    if isinstance(e,dict) and '_name' in e: fallback=e['_name']; e=None
    if OVR.get(lab)=='CHE-102.978.667' and lab!='SRG SSR': hint=(hint+'; ' if hint else '')+SRGNOTE
    if lab in FBN and not OVR.get(lab): fallback=FBN[lab] if FBN[lab] else None
    if lab=='VRSG': hint='VRSG ist in der Abraxas Informatik AG aufgegangen; portal.vrsg.ch leitet auf portal.abraxas.ch weiter'
    if lab=='Armee': hint=(hint+'; ' if hint else '')+'Armee ist Teil des VBS (Gruppe Verteidigung); UID des VBS'
    ORG[lab]=dict(e=e,why=why,sek=SEK[m[2]],ts=TS[m[3]],hint=hint,fallback=fallback)
# merge identical operators: same UID -> same name; same label query without UID -> keep
LOGIN=re.compile(r'(?i)(log ?in|logon|anmeld|sign ?in|se connecter|einlogg|passw|mot de passe|keycloak|oauth|saml|openid|/auth|/idp|/sso|realms/|my\.policy|authorize|identity)')
REMOTE=re.compile(r'(?i)(logonpoint|citrix|netscaler|globalprotect|global-protect|/remote/login|dana-na|ivanti|pulse secure|anyconnect|\+cscoe\+|/vpn/|ssl ?vpn|horizon|rdweb|remote ?desktop)')
MAIL=re.compile(r'(?i)(outlook|/owa|webmail|roundcube|zimbra|sogo|open-xchange)')
def base_type(h):
    l=h.split('.')[0]
    if h in ('me.agov.admin.ch','www.me.agov.admin.ch','eportal.admin.ch','user.eportal.admin.ch','forms.eid.admin.ch','www.gateportal.zas.admin.ch','www.anmeldung.admin.ch','ordipro.eda.admin.ch','edoc.estv.admin.ch','pams.estv.admin.ch'): return 'kundenportal'
    if h in ('mwstabrechnen.estv.admin.ch','mwsteasy.estv.admin.ch','passar.bazg.admin.ch','e-dec-web.ezv.admin.ch','via.admin.ch','e-vignette.admin.ch','unternehmensabgabe.estv.admin.ch','taxas.bazg.admin.ch','lsvaportal.ezv.admin.ch'): return 'transaktion'
    if re.match(r'^(api\d?|.*-api|wmts|ws|gw-apinaz|selfservice|backend|sedex-service|identifier-reg.*|status-reg.*|trust-reg.*|vzc-api|passar-b2bhub|taxas-b2bhub)$',l) or '.api.' in h: return 'api'
    if l in ('login','auth','id','sso','account','idp','op','connect','eiam','init','identity-eiam','guestlogin','access','feds','cert','idp-base','chlogin'): return 'login'
    if l in ('ebanking','e-banking','netbanking','banking','onba','ebanking-ch','shop'): return 'transaktion'
    if l in ('portal','my','mein','kunden','customer','secure','online','app','user','forms'): return 'kundenportal'
    if l=='webmail': return 'email'
    return 'website'
def classify(h):
    v=R.get(h,{}); t=base_type(h)
    if 'error' in v or v.get('status') is None:
        return t,False,'Host antwortet nicht auf HTTPS ('+v.get('error','keine Antwort').split(':')[0]+'); Service-Typ aus Hostnamen abgeleitet'
    fin=v.get('final',''); title=v.get('title',''); kw=v.get('kw',''); st=v['status']; ct=v.get('ctype','')
    blob=fin+' '+title
    if REMOTE.search(blob) or re.search(r'(?i)(citrix|netscaler|globalprotect|pulse secure|ivanti|anyconnect|forticlient)',kw):
        return 'fernzugriff',True,('Gateway für Fernzugriff erkannt (Seite/Adresse); ursprünglich als '+t+' eingeordnet') if t!='fernzugriff' else ''
    if MAIL.search(blob) and t in ('email','website','kundenportal','login'):
        return 'email',True,'' if t=='email' else 'Webmail-Oberfläche erkannt'
    if t=='website':
        return t, st<400, '' if st<400 else f'Website antwortet mit HTTP {st}'
    fh=urlparse(fin).hostname or ''; path=urlparse(fin).path
    if fh!=h and fh!='www.'+h and fh.startswith('www.') and path in ('','/') and not LOGIN.search(blob+' '+kw):
        return 'website',True,f'Host leitet auf {fh} weiter; als website eingestuft'
    lg=bool(LOGIN.search(blob)) or bool(LOGIN.search(kw))
    if t=='login': return t,lg,'' if lg else 'keine Login-Merkmale auf der Einstiegsseite; Service-Typ aus Hostnamen abgeleitet'
    if t=='transaktion': 
        ok=lg or bool(re.search(r'(?i)(shop|store|warenkorb|cart|bestell|e-?banking|abrechn|deklar|vignette|passar|zoll)',blob))
        return t,ok,'' if ok else 'keine Transaktions-Merkmale auf der Einstiegsseite; Service-Typ aus Hostnamen abgeleitet'
    if t=='kundenportal':
        ok=lg or bool(re.search(r'(?i)(portal|kunden|konto|account|mein|my|espace|client)',title+' '+path))
        return t,ok,'' if ok else 'keine Portal-Merkmale auf der Einstiegsseite; Service-Typ aus Hostnamen abgeleitet'
    if t=='api':
        ok=('json' in ct or 'xml' in ct or bool(re.search(r'(?i)(api|developer|swagger|openapi)',blob)) or (st in (401,403,404,405) and not title))
        return t,ok,'' if ok else 'keine API-Merkmale; Service-Typ aus Hostnamen abgeleitet'
    if t=='email': return t,False,'keine Webmail-Oberfläche erkannt; Service-Typ aus Hostnamen abgeleitet'
    return t,False,''
KRIT={'Finanzen':{'login','transaktion','api'},'Gesundheit':{'kundenportal','login'},'Energie':{'kundenportal','fernzugriff'},'Information und Kommunikation':{'login','kundenportal'},'Verkehr':{'transaktion','api'},'Behörden':{'kundenportal','login','api'}}
OTHER={'login','kundenportal','fernzugriff'}
def parents(h):
    p=h.split('.'); out=[]
    for i in range(1,len(p)-1):
        d='.'.join(p[i:]); out+= ['www.'+d,d]
    return out
def quelle(h):
    for c in ([h] if (h.startswith('www.') or h.count('.')==1) else [])+parents(h):
        v=R.get(c)
        if v and v.get('body') and re.search(r'(?i)(https?:)?//'+re.escape(h)+r'([/"\'?#:\s]|$)',v['body']):
            return v['final']
    return ''
out=[];reasons=[]
for x in rows:
    h=x['hostname']; lab=x['organisation']; o=ORG[lab]; e=o['e']; notes=[]; rs=[]
    name=e['name'] if e else (o['fallback'] or '')
    uid=e['uid'] if e else ''
    if not e: notes.append('UID: '+o['why']); rs.append('UID nicht eindeutig')
    est=bool(re.search(r'(angenommen|geschätzt|nicht belegt|nicht ermittelt|fraglich)',o['hint']))
    if o['hint']: notes.append(o['hint'])
    if est: rs.append('Betreiber geschätzt')
    sek,ts=o['sek'],o['ts']
    if not sek: rs.append('kein SKI-Sektor')
    st,ok,n=classify(h)
    v=R.get(h,{})
    if sek=='Finanzen' and st in ('kundenportal','login') and re.search(r'(?i)(e-?banking|e-?finance|onlinebanking)',v.get('title','')+' '+v.get('final','')+' '+v.get('kw','')):
        n=(n+'; ' if n else '')+f'E-Banking-Einstieg erkannt; als transaktion statt {st} eingestuft'; st='transaktion'; ok=True
    if n: notes.append(n)
    if not ok: rs.append('Service-Typ nicht belegt' + (' (Host nicht erreichbar)' if 'antwortet nicht' in n else ''))
    rule=KRIT.get(sek,OTHER)
    krit='ja' if st in rule else 'nein'
    if h=='www.alert.swiss': krit='ja'; notes.append('Abweichung: offizieller Alarmierungskanal des Bundes, als Website kritisch')
    if sek=='Behörden' and st=='transaktion' and h in ('mwstabrechnen.estv.admin.ch','mwsteasy.estv.admin.ch','passar.bazg.admin.ch','e-dec-web.ezv.admin.ch','via.admin.ch','e-vignette.admin.ch','unternehmensabgabe.estv.admin.ch'):
        krit='ja'; notes.append('Abweichung: behördliche Pflichttransaktion (Steuer-/Zollabwicklung), als kritisch eingestuft')
    if st=='fernzugriff' and krit=='nein': krit='ja'; notes.append('Abweichung: Fernzugriff auf interne Systeme, unabhängig vom Sektor kritisch')
    sich='tief' if rs else 'hoch'
    out.append(dict(hostname=h,begruendung=x['warum_kritisch'],organisation=name,uid=uid,sektor=sek,teilsektor=ts,service_typ=st,kritisch=krit,
        plz=(e or {}).get('plz') or '',ort=(e or {}).get('ort') or '',kanton=(e or {}).get('kt') or '',quelle_url=quelle(h),sichtbarkeit='aggregat',sicherheit=sich,bemerkung='; '.join(dict.fromkeys(notes))))
    reasons.append(rs)
F=['hostname','begruendung','organisation','uid','sektor','teilsektor','service_typ','kritisch','plz','ort','kanton','quelle_url','sichtbarkeit','sicherheit','bemerkung']
with open('kritische_services_ch_angereichert.csv','w',newline='',encoding='utf-8') as f:
    w=csv.DictWriter(f,fieldnames=F); w.writeheader(); w.writerows(out)
rep=[]
for b in range(10):
    blk=out[b*100:(b+1)*100]; rb=reasons[b*100:(b+1)*100]
    c=collections.Counter(r for rr in rb for r in rr)
    rep.append(dict(block=f'{b*100+1}–{b*100+100}',tief=sum(1 for y in blk if y['sicherheit']=='tief'),gruende=c.most_common(3),kritisch=sum(1 for y in blk if y['kritisch']=='ja')))
json.dump(rep,open('blockreport.json','w'),ensure_ascii=False)
for r_ in rep: print(r_)
print(collections.Counter(y['service_typ'] for y in out)); print(collections.Counter(y['sektor'] for y in out)); print('kritisch',sum(1 for y in out if y['kritisch']=='ja'),'quelle',sum(1 for y in out if y['quelle_url']),'uid',sum(1 for y in out if y['uid']),'hoch',sum(1 for y in out if y['sicherheit']=='hoch'))

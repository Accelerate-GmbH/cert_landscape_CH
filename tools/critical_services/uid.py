import requests, re, time, json, sys, xml.etree.ElementTree as ET
URL='https://www.uid-wse.admin.ch/V5.0/PublicServices.svc'
H={'Content-Type':'text/xml; charset=utf-8','SOAPAction':'http://www.uid.admin.ch/xmlns/uid-wse/IPublicServices/Search'}
def esc(s): return s.replace('&','&amp;').replace('<','&lt;')
def search(name):
    body=f'''<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:uid="http://www.uid.admin.ch/xmlns/uid-wse" xmlns:v5="http://www.uid.admin.ch/xmlns/uid-wse/5"><soapenv:Header/><soapenv:Body><uid:Search><uid:searchParameters><v5:uidEntitySearchParameters><v5:organisationName>{esc(name)}</v5:organisationName></v5:uidEntitySearchParameters></uid:searchParameters></uid:Search></soapenv:Body></soapenv:Envelope>'''
    r=requests.post(URL,data=body.encode(),headers=H,timeout=60)
    t=re.sub(r'\sxmlns(:\w+)?="[^"]+"','',r.text); t=re.sub(r'<(/?)\w+:',r'<\1',t)
    if r.status_code!=200: return {'error':r.status_code,'text':t[:400]}
    root=ET.fromstring(t); out=[]
    for it in root.iter('uidEntitySearchResultItem'):
        o=it.find('organisation/organisation'); oi=o.find('organisationIdentification')
        uid=oi.findtext('uid/uidOrganisationId')
        adr=None
        for a in o.findall('address'):
            if a.findtext('addressCategory')=='LEGAL': adr=a
        adr=adr if adr is not None else o.find('address')
        out.append(dict(uid=f"CHE-{uid[:3]}.{uid[3:6]}.{uid[6:]}",name=oi.findtext('organisationName'),add=oi.findtext('organisationAdditionalName'),
            legalForm=oi.findtext('legalForm'),status=it.findtext('organisation/uidregInformation/uidregStatusEnterpriseDetail'),
            plz=adr.findtext('swissZipCode') if adr is not None else None,ort=adr.findtext('town') if adr is not None else None,
            kt=adr.findtext('cantonAbbreviation') if adr is not None else None,rating=it.findtext('rating')))
    return {'results':out}
if __name__=='__main__':
    for q in sys.argv[1:]:
        t=time.time(); r=search(q); print(q, round(time.time()-t,1), json.dumps(r,ensure_ascii=False)[:600])

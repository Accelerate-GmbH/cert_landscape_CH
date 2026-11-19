import csv,json,re,requests,html
from concurrent.futures import ThreadPoolExecutor
import urllib3; urllib3.disable_warnings()
r=list(csv.DictReader(open('kritische_digitale_services_ch_top1000.csv',encoding='utf-8-sig')))
UA={'User-Agent':'Mozilla/5.0 (compatible; cert_landscape_CH research; +https://github.com/Accelerate-GmbH/cert_landscape_CH)','Accept-Language':'de-CH,de;q=0.9,en;q=0.5'}
def get(h):
    try:
        s=requests.get(f'https://{h}/',headers=UA,timeout=15,allow_redirects=True,stream=True)
        body=s.raw.read(400000,decode_content=True).decode(s.encoding or 'utf-8',errors='ignore')
        m=re.search(r'<title[^>]*>(.*?)</title>',body,re.S|re.I)
        title=html.unescape(re.sub(r'\s+',' ',m.group(1))).strip()[:200] if m else ''
        ctype=s.headers.get('content-type','')
        return h,dict(status=s.status_code,final=s.url,title=title,ctype=ctype,len=len(body),hist=[x.url for x in s.history][:5],body=body)
    except Exception as e:
        return h,dict(error=type(e).__name__+': '+str(e)[:150])
with ThreadPoolExecutor(24) as ex: res=dict(ex.map(get,[x['hostname'] for x in r]))
# keep bodies only for www/apex hosts (for quelle_url search), else drop
for h,v in res.items():
    if 'body' in v and not (h.startswith('www.') or h.count('.')<=1):
        v['kw']=' '.join(sorted(set(re.findall(r'(?i)(password|passwort|mot de passe|anmelden|login|log in|sign in|se connecter|einloggen|citrix|netscaler|globalprotect|fortinet|forticlient|pulse secure|ivanti|anyconnect|vpn|outlook web|owa|swagger|openapi|keycloak|azure ad|microsoft online|e-banking|ebanking|e-finance)',v['body'][:200000]))))
        del v['body']
json.dump(res,open('http.json','w'),ensure_ascii=False)
print(sum(1 for v in res.values() if 'error' in v),'errors of',len(res))

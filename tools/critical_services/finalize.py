import json,collections,csv,socket
from concurrent.futures import ThreadPoolExecutor
r=json.load(open('rows.json'))
TO={'öffentlich':0,'halbprivat':1,'privat':2}
SO=['Behörden','Öffentliche Sicherheit','IKT & Vertrauensinfrastruktur','Finanzen','Energie','Gesundheit','Verkehr & Logistik','Detailhandel & Nahrung','Medien','Bildung & Forschung','Internationale Organisationen']
r.sort(key=lambda x:(x['_score'],TO[x['traegerschaft']],SO.index(x['sektor']),x['hostname']))
import time
def ok(h):
    for i in range(4):
        try: socket.getaddrinfo(h,443); return True
        except: time.sleep(0.7)
    return False
with ThreadPoolExecutor(16) as ex: res=list(ex.map(ok,[x['hostname'] for x in r[:1100]]))
print('unresolved', [x['hostname'] for x,o in zip(r,res) if not o])
top=[x for x,o in zip(r,res) if o][:1000]
assert len(top)==1000
print(collections.Counter(x['stufe'] for x in top)); print(collections.Counter(x['sektor'] for x in top)); print(collections.Counter(x['traegerschaft'] for x in top))
print('cut at', top[-1]['hostname'], top[-1]['_score'])
with open('kritische_digitale_services_ch_top1000.csv','w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f); w.writerow(['rang','hostname','organisation','sektor','traegerschaft','stufe','typ','warum_kritisch'])
    for i,x in enumerate(top,1): w.writerow([i,x['hostname'],x['organisation'],x['sektor'],x['traegerschaft'],x['stufe'],x['typ'],x['warum_kritisch']])
open('hostnames_top1000.txt','w').write('\n'.join(x['hostname'] for x in top)+'\n')

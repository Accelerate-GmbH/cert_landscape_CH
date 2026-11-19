import socket, json, uuid
from concurrent.futures import ThreadPoolExecutor
socket.setdefaulttimeout(4)
orgs=[l.split('|') for l in open('orgs.txt',encoding='utf-8').read().splitlines() if l and not l.startswith('#')]
P=['login','auth','id','sso','account','ebanking','e-banking','netbanking','banking','online','portal','my','mein','kunden','customer','app','api','shop','secure','webmail']
def res(h):
    try: return sorted({a[4][0] for a in socket.getaddrinfo(h,443,proto=6)})
    except Exception: return None
tasks=set()
for o in orgs:
    d=o[0]
    if d=='admin.ch': continue
    tasks |= {d,'www.'+d,f'{uuid.uuid4().hex[:12]}.{d}'} | {f'{p}.{d}' for p in P}
tasks=sorted(tasks)
with ThreadPoolExecutor(64) as ex: R=dict(zip(tasks,ex.map(res,tasks)))
json.dump(R,open('dns.json','w'))
print(len(tasks), sum(1 for v in R.values() if v))

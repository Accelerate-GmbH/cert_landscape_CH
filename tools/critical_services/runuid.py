import csv,json,time,os
from uid import search
r=list(csv.DictReader(open('kritische_digitale_services_ch_top1000.csv',encoding='utf-8-sig')))
M={l.split('|')[0]:l.split('|') for l in open('orgmap.txt',encoding='utf-8').read().splitlines() if l and not l.startswith('#')}
miss={x['organisation'] for x in r}-set(M); print('missing',miss)
qs=sorted({m[1] for m in M.values() if m[1]})
cache=json.load(open('uidcache.json')) if os.path.exists('uidcache.json') else {}
for q in qs:
    if q in cache: continue
    for i in range(3):
        try: cache[q]=search(q); break
        except Exception as e: cache[q]={'error':str(e)}; time.sleep(3)
    json.dump(cache,open('uidcache.json','w'),ensure_ascii=False)
print(len(qs), sum(1 for q in qs if cache[q].get('results')), [q for q in qs if 'error' in cache[q]][:10])

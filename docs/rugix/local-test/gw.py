import json,math,random,time,urllib.request as u,sys
T=open('/home/felix/work/tb-local/.token').read().strip()
def api(m,p,b=None):
    r=u.Request('http://localhost:8080'+p,method=m,data=json.dumps(b).encode() if b is not None else None,headers={'X-Authorization':'Bearer '+T,'Content-Type':'application/json'})
    x=u.urlopen(r).read(); return json.loads(x) if x else None
def stat(ts,seed):
    t=ts/1000
    cpu=max(1,min(99,30+18*math.sin(t/3600*2+seed)+random.uniform(-6,6)))
    used=min(95,62+8*math.sin(t/9000+seed)+random.uniform(-1,1))
    rss=75e6+6e6*math.sin(t/5000+seed)+random.uniform(-1e6,1e6)
    return {"totalCpuUsage":round(cpu,2),"diskUsage":round(7.9+(t-1.79e9)/1e6*0.02%3+seed,1),"freeMemory":round(100-used,1),"freeDisk":"18.5G","gwProcessCpuUsage":round(max(0.5,cpu/3+random.uniform(-2,2)),1),"gwMemory":round(2+0.3*math.sin(t/7000),1),"gwProcessMemoryFullInfo":{"rss":int(rss),"vms":2140667904},"msgsSentToPlatform":int(t/20)%100000,"msgsReceivedFromPlatform":0}
if sys.argv[1]=='setup':
    devs={d['name']:d for d in api('GET','/api/tenant/devices?pageSize=100&page=0')['data'] if 'Rugix' in d['type']}  # not used
    all_=api('GET','/api/tenant/devices?pageSize=100&page=0')['data']
    byname={d['name']:d for d in all_}
    for i,(gwn,target) in enumerate([('TB-IoT-GW-Felix','Testanlage_Felix_Rugix'),('TB-IoT-GW-Nord','Anlage_Nord_RevPi_02')]):
        gw=api('POST','/api/device',{'name':gwn,'type':'default','additionalInfo':{'gateway':True}})
        tgt=byname[target]
        api('POST','/api/relation',{'from':gw['id'],'to':tgt['id'],'type':'Created','typeGroup':'COMMON'})
        now=int(time.time()*1000); pts=[{'ts':now-k*300000,'values':{'machineStats':stat(now-k*300000,i)}} for k in range(2016,-1,-1)]
        api('POST',f"/api/plugins/telemetry/DEVICE/{gw['id']['id']}/timeseries/ANY",pts)
        open('/home/felix/work/tb-local/gws.txt','a').write(f"{gw['id']['id']} {i}\n"); print('gw',gwn)
else:
    while True:
        for l in open('/home/felix/work/tb-local/gws.txt').read().split('\n'):
            if l.strip():
                gid,i=l.split(); now=int(time.time()*1000)
                try: api('POST',f"/api/plugins/telemetry/DEVICE/{gid}/timeseries/ANY",[{'ts':now,'values':{'machineStats':stat(now,int(i))}}])
                except Exception as e: print(e)
        time.sleep(20)

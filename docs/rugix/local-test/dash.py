import json,sys
sys.argv=['x']
exec(open('/home/felix/work/tb-local/setup.py').read().split("W='")[0])
cfg=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../')+'docs/rugix/widget/default-config.json'))
wt=api('GET','/api/widgetTypes?pageSize=50&page=0&tenantOnly=true')
fqn=[w['fqn'] for w in wt['data'] if 'rugix' in w['fqn']][0]; print(fqn)
ds=cfg['datasources'][0]; ds['entityAliasId']='alias1'
for i,k in enumerate(ds['dataKeys']): k['color']='#2196f3'
w={"typeFullFqn":fqn,"type":"latest","sizeX":24,"sizeY":12,"config":{**{k:v for k,v in cfg.items() if k!='datasources'},"datasources":[ds],"actions":{},"title":"Rugix Management"}}
d=api('POST','/api/dashboard',{"title":"Rugix Management (Test)","configuration":{
 "widgets":{"w1":w},"entityAliases":{"alias1":{"id":"alias1","alias":"Rugix devices","filter":{"type":"deviceType","resolveMultiple":True,"deviceTypes":["RevolutionPi_Rugix"],"deviceNameFilter":""}}},
 "states":{"default":{"name":"Rugix","root":True,"layouts":{"main":{"widgets":{"w1":{"sizeX":24,"sizeY":12,"row":0,"col":0}},"gridSettings":{"backgroundColor":"#eeeeee","columns":24,"margin":10,"outerMargin":True,"layoutType":"default"}}}}},
 "settings":{},"timewindow":{"realtime":{"timewindowMs":60000}}}})
print('http://localhost:8080/dashboards/'+d['id']['id'])

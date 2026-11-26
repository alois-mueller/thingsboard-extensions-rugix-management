import json, urllib.request, sys, os
BASE='http://localhost:8080'
T=json.load(urllib.request.urlopen(urllib.request.Request(BASE+'/api/auth/login',data=json.dumps({'username':'tenant@thingsboard.org','password':'tenant'}).encode(),headers={'Content-Type':'application/json'})))['token']
open(os.path.expanduser('~/work/tb-local/.token'),'w').write(T)
def api(m,p,b=None):
    r=urllib.request.Request(BASE+p,method=m,data=json.dumps(b).encode() if b is not None else None,
        headers={'X-Authorization':'Bearer '+T,'Content-Type':'application/json'})
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        print(m,p,e.code,e.read()[:400]); raise
import base64
res=api('POST','/api/resource',{'title':'Rugix Extension','resourceType':'JS_MODULE','resourceSubType':'EXTENSION','fileName':'thingsboard-extension-widgets.js','data':base64.b64encode(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../')+'target/generated-resources/thingsboard-extension-widgets.js','rb').read()).decode()})
EXT=res['id']['id']; print('resource',EXT)
W=os.path.join(os.path.dirname(os.path.abspath(__file__)),'../../../')+'docs/rugix/widget/'
cfg=json.load(open(W+'default-config.json'))
wt=api('POST','/api/widgetType',{"name":"Rugix Management","descriptor":{
 "type":"latest","sizeX":24,"sizeY":12,"resources":[{"url":{"entityType":"TB_RESOURCE","id":EXT},"isModule":True,"isExtension":True}],
 "templateHtml":open(W+'template.html').read(),"templateCss":"","controllerScript":open(W+'controller.js').read(),
 "settingsSchema":"{}","dataKeySettingsSchema":"{}","settingsDirective":"","defaultConfig":json.dumps(cfg)}})
print('widgetType',wt['id']['id'],wt.get('fqn'))
prof=api('POST','/api/deviceProfile',{"name":"RevolutionPi_Rugix","type":"DEFAULT","transportType":"DEFAULT","profileData":{"configuration":{"type":"DEFAULT"},"transportConfiguration":{"type":"DEFAULT"},"alarms":None,"provisionConfiguration":{"type":"DISABLED"}}})
print('profile',prof['id']['id'])
devs=[('Testanlage_Felix_Rugix','Testanlage Felix','b','a'),('Anlage_Nord_RevPi_02','Anlage Nord 02','a','a')]
for name,label,ag,dg in devs:
    d=api('POST','/api/device',{"name":name,"label":label,"type":"RevolutionPi_Rugix","deviceProfileId":prof['id']})
    cred=api('GET','/api/device/%s/credentials'%d['id']['id'])
    print('device',name,d['id']['id'],cred['credentialsId'])
    open(os.path.expanduser('~/work/tb-local/devices.txt'),'a').write(f"{name} {d['id']['id']} {cred['credentialsId']} {ag} {dg}\n")

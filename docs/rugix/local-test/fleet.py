"""Create / update a varied test fleet (names, models, Edge OS versions, states, jobs ...).

Writes devices.txt (name id token activeGroup defaultGroup) and sim/fleet.json next to this file
(or into $TB_LOCAL). Run `node sim/sim.js` afterwards: online devices stay connected, offline ones connect once to
publish their data and disconnect again.
"""
import json, os, sys, urllib.request as u

ROOT = os.environ.get('TB_LOCAL', os.path.dirname(os.path.abspath(__file__)))
BASE = 'http://localhost:8080'
T = json.load(u.urlopen(u.Request(BASE + '/api/auth/login', data=json.dumps({'username': 'tenant@thingsboard.org', 'password': 'tenant'}).encode(), headers={'Content-Type': 'application/json'})))['token']


def api(m, p, b=None):
    r = u.Request(BASE + p, method=m, data=json.dumps(b).encode() if b is not None else None, headers={'X-Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    x = u.urlopen(r).read()
    return json.loads(x) if x else None


CM4 = dict(model='RevPi Connect 4 32/4GB', board='1.3', cpu='Raspberry Pi Compute Module 4 Rev 1.1')
CON5 = dict(model='RevPi Connect 5 16/4GB', board='1.0', cpu='Raspberry Pi Compute Module 5 Rev 1.0')
CORE = dict(model='RevPi Core S 1GB', board='1.2', cpu='Raspberry Pi Compute Module 4 Rev 1.1')
FLAT = dict(model='RevPi Flat', board='1.1', cpu='Raspberry Pi Compute Module 4 Rev 1.1')
GW = {'name': 'tb-iot-gateway', 'status': {'state': 'running'}, 'generation': 23, 'orchestrator': 'compose'}
NEWT = {'name': 'pangolin-newt', 'status': {'state': 'running'}, 'generation': 11, 'orchestrator': 'compose'}
GRAFANA = {'name': 'revpi-dio-grafana', 'status': {'state': 'running'}, 'generation': 4, 'orchestrator': 'compose'}


def app(a, state, msg=None, gen=None):
    x = dict(a); x['status'] = {'state': state}
    if msg: x['status']['message'] = msg
    if gen: x['generation'] = gen
    return x


def job(title, kind, status, minutes_ago, lines=(), failure=None):
    return dict(title=title, kind=kind, status=status, minutesAgo=minutes_ago, lines=list(lines), failure=failure)


# name, label (None = keep), hardware, os, online, active group, default group, extras
FLEET = [
    ('Testanlage_Felix_Rugix', None, CM4, '0.5.1-dev3', True, 'b', 'a', {}),
    ('Anlage_Nord_RevPi_02', None, CM4, '0.5.1-dev3', True, 'a', 'a', dict(insecure=True, factoryReset=False)),
    ('Anlage_03_RevPi', 'Pumpstation Hamburg 01', CM4, '0.5.1-dev3', True, 'a', 'a', dict(apps=[GW, NEWT], jobs=[job('Install system update', 'system-update', 'succeeded', 2600, ['Downloading bundle', 'Writing system-a'])])),
    ('Anlage_04_RevPi', 'Kompressor Halle 3', CM4, '0.5.1-dev3', True, 'b', 'a', dict(apps=[GW])),
    ('Anlage_05_RevPi', 'Lager Süd Gateway', CON5, '0.5.2-rc1', True, 'a', 'a', dict(apps=[GW, app(NEWT, 'unhealthy', 'container restarting (3 times in 10 min)'), GRAFANA])),
    ('Anlage_06_RevPi', 'Kühlhaus Bremen', CON5, '0.5.2-rc1', True, 'a', 'a', dict(state='error')),
    ('Anlage_07_RevPi', 'Förderband Ost 07', CM4, '0.5.0', False, 'a', 'a', dict(offlineMinutes=60 * 30)),
    ('Anlage_08_RevPi', 'Wärmepumpe Keller 08', FLAT, '0.5.0', False, 'b', 'a', dict(offlineMinutes=60 * 5)),
    ('Anlage_09_RevPi', 'Windpark Nordsee 09', CON5, '0.5.2-rc1', True, 'a', 'a', dict(apps=[GW, NEWT], jobs=[job('Install app bundle', 'app-install', 'failed', 95, ['unable to open HTTP bundle source'], 'rugix-ctrl failed: unable to create HTTP source')])),
    ('Anlage_10_RevPi', 'Photovoltaik Dach 10', CM4, '0.4.9', True, 'a', 'a', dict(apps=[GW])),
    ('Anlage_11_RevPi', 'Abfüllanlage Linie 2', CORE, '0.4.9', True, 'a', 'a', dict(consistent=False, apps=[GW, NEWT])),
    ('Anlage_12_RevPi', 'Trafostation Mitte', CM4, '0.5.1-dev3', False, 'a', 'a', dict(offlineMinutes=60 * 52)),
    ('Anlage_13_RevPi', 'Messstation Rhein 13', FLAT, '0.5.0', True, 'a', 'a', dict(jobs=[job('Install system update', 'system-update', 'running', 3, ['Downloading bundle', 'Verifying signature'])])),
    ('Anlage_14_RevPi', 'Schaltschrank Werk 2', CON5, '0.5.2-rc1', True, 'a', 'a', dict(apps=[GW, NEWT, GRAFANA])),
    ('Anlage_15_RevPi', 'Biogasanlage Süd 15', CM4, '0.4.8', False, 'a', 'a', dict(insecure=True, offlineMinutes=60 * 24 * 4)),
    ('Anlage_16_RevPi', 'Wasserwerk Nord 16', CORE, '0.5.1-dev3', True, 'a', 'a', dict(apps=[GW, app(NEWT, 'failed', 'service exited with code 137')])),
    ('Anlage_17_RevPi', 'Testlabor Felix 2', CM4, '0.5.2-rc1', True, 'a', 'a', dict(jobs=[job('Install system update', 'system-update', 'succeeded', 40, ['Downloading bundle', 'Writing system-a', 'Selecting boot group a'])])),
    ('Anlage_18_RevPi', 'Demo-Rack Messe', FLAT, '0.5.0', False, 'a', 'a', dict(offlineMinutes=60 * 24 * 12)),
    ('Anlage_19_RevPi', 'Kläranlage Ost', CORE, '0.5.1-dev3', True, 'a', 'a', dict(apps=[GW])),
    ('Anlage_20_RevPi', 'Hubstation Bahnhof', CON5, '0.5.2-rc1', True, 'b', 'a', dict(insecure=True, apps=[GW, NEWT])),
]

prof = next(p for p in api('GET', '/api/deviceProfiles?pageSize=50&page=0')['data'] if p['name'] == 'RevolutionPi_Rugix')
existing = {d['name']: d for d in api('GET', '/api/tenant/devices?pageSize=200&page=0')['data']}
cfg, lines = {}, []
for i, (name, label, hw, os_, online, ag, dg, x) in enumerate(FLEET):
    d = existing.get(name)
    if not d:
        d = api('POST', '/api/device', {'name': name, 'label': label or name, 'type': 'RevolutionPi_Rugix', 'deviceProfileId': prof['id']})
    elif label and d.get('label') != label:
        d['label'] = label
        d = api('POST', '/api/device', d)
    token = api('GET', '/api/device/%s/credentials' % d['id']['id'])['credentialsId']
    lines.append(f"{name} {d['id']['id']} {token} {ag} {dg}")
    serial = 'PR1000%02dR0%d' % (i + 1, i % 3)
    cfg[name] = dict(hw=hw, os=os_, online=online, serial=serial, **x)
open(os.path.join(ROOT, 'devices.txt'), 'w').write('\n'.join(lines) + '\n')
os.makedirs(os.path.join(ROOT, 'sim'), exist_ok=True)
json.dump(cfg, open(os.path.join(ROOT, 'sim', 'fleet.json'), 'w'), indent=1)
print(len(FLEET), 'devices,', sum(1 for f in FLEET if f[4]), 'online')

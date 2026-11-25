// Fake Rugix devices: answer TB RPC like the gateway would and emit jobEvent telemetry.
const mqtt = require('mqtt'), fs = require('fs');
const lines = fs.readFileSync(__dirname + '/../devices.txt', 'utf8').trim().split('\n');
for (const l of lines) {
  const [name, , token, ag, dg] = l.split(' ');
  const st = {ag, dg, groupsActive: ag};
  const c = mqtt.connect('mqtt://localhost:1883', {username: token});
  const tel = (o) => c.publish('v1/devices/me/telemetry', JSON.stringify(o));
  const attrs = () => c.publish('v1/devices/me/attributes', JSON.stringify({
    'boot.bootFlow': 'tryboot', 'boot.groups': {a: {}, b: {}}, 'state.status': 'active', 'state.dataPartition': '/dev/mmcblk0p4',
    'api.version': '0.1.4', 'daemon.features': {}, 'components.consistent': true, 'components.problems': [],
    'components.components': require('./components.json'),
    'slots.boot-a': {active: st.ag === 'a', size: 70254592}, 'slots.boot-b': {active: st.ag === 'b', size: 70254592},
    'slots.system-a': {active: st.ag === 'a', size: 1288490188, updated_at: '2026-11-20T10:00:00Z', hashes: {sha256: '9f2c4be1a7d03c55e0'}},
    'slots.system-b': {active: st.ag === 'b', size: 1395864371, updated_at: '2026-11-24T09:12:00Z', hashes: {sha256: '3b77aa01c9e2f4d8'}},
    'apps.apps': [{name: 'tb-iot-gateway', status: 'running', generation: 23, orchestrator: 'compose'}, {name: 'pangolin-newt', status: 'running', generation: 11, orchestrator: 'compose'}]
  }));
  const pushState = () => { tel({'boot.activeGroup': st.ag, 'boot.defaultGroup': st.dg}); attrs(); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function job(id, title, kind, outLines, progress, mutate) {
    const j = (status) => ({type: 'job-changed', job: {id, title, kind, status: typeof status === 'string' ? {status} : status, created_at: '', updated_at: ''}});
    tel({jobEvent: j('queued')}); await sleep(600); tel({jobEvent: j('running')});
    for (const [i, line] of outLines.entries()) {
      await sleep(900); tel({jobEvent: {type: 'job-output', job_id: id, stream: 'stderr', line}});
      if (progress) tel({jobEvent: {type: 'install-progress', job_id: id, progress: Math.round((i + 1) / outLines.length * 100)}});
    }
    mutate && mutate(); await sleep(500); tel({jobEvent: j('succeeded')}); pushState();
  }
  c.on('connect', () => { console.log(name, 'connected'); c.subscribe('v1/devices/me/rpc/request/+'); pushState(); });
  c.on('message', (topic, buf) => {
    const id = topic.split('/').pop(); const {method, params = {}} = JSON.parse(buf.toString());
    console.log(name, 'RPC', method, JSON.stringify(params));
    const jobId = params.uuid || String(Date.now() % 100000);
    const reply = (v) => c.publish('v1/devices/me/rpc/response/' + id, JSON.stringify(v));
    const spare = st.ag === 'a' ? 'b' : 'a';
    if (method === 'installUpdateFromUrl') { reply({}); job(jobId, 'Install system update', 'system-update', ['Downloading bundle', 'Verifying signature', 'Writing system-' + spare, 'Writing boot-' + spare, 'Selecting boot group ' + spare], true, () => { st.dg = st.dg; }); }
    else if (method === 'installAppFromUrl') { reply({}); job(jobId, 'Install app', 'app-install', ['Downloading', 'Unpacking', 'Done'], true); }
    else if (method === 'rebootSpare') { reply(jobId); job(jobId, 'Reboot into spare', 'system-action', ['Rebooting into ' + spare], false, () => { st.ag = spare; }); }
    else if (method === 'reboot') { reply(jobId); job(jobId, 'Reboot', 'system-action', ['Rebooting'], false); }
    else if (method === 'commit') { reply(jobId); job(jobId, 'Commit', 'system-action', ['Setting default boot group ' + st.ag], false, () => { st.dg = st.ag; }); }
    else if (method === 'factoryReset') { reply({id: jobId}); job(jobId, 'Factory reset', 'system-action', ['Resetting state'], false); }
    else { reply(jobId); job(jobId, method, 'app-action', [method + ' ' + (params.app || '')], false); }
  });
}

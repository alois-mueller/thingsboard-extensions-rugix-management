// Fake Rugix devices: answer TB RPC like the gateway would and emit jobEvent telemetry.
// Per-device data (model, Edge OS version, apps, jobs, ...) comes from fleet.json (see ../fleet.py).
const mqtt = require('mqtt'), fs = require('fs');
const lines = fs.readFileSync(__dirname + '/../devices.txt', 'utf8').trim().split('\n');
let fleet = {};
try { fleet = JSON.parse(fs.readFileSync(__dirname + '/fleet.json', 'utf8')); } catch (e) { /* defaults */ }
const baseComponents = require('./components.json');

function buildComponents(cfg, apps) {
  const list = JSON.parse(JSON.stringify(baseComponents));
  const names = new Set(apps.map(a => a.name));
  const out = [];
  for (const e of list) {
    const c = e.component;
    if (e.source.kind === 'App' && !names.has(e.source.app)) { continue; }
    if (c.id === 'system.edge-os') { c.version = cfg.os; }
    if (c.id === 'runtime.docker' && cfg.dockerVersion) { c.version = cfg.dockerVersion; }
    for (const p of c.provides || []) {
      if (p.id === 'hardware.revpi.model') { p.value = cfg.hw.model; }
      if (p.id === 'hardware.revpi.version') { p.version = cfg.hw.board; }
      if (p.id === 'hardware.revpi.id') { p.value = cfg.serial; }
      if (p.id === 'hardware.rpi.model') { p.value = cfg.hw.cpu; }
    }
    out.push(e);
  }
  return out;
}

const DEFAULT_APPS = [{name: 'tb-iot-gateway', status: {state: 'running'}, generation: 23, orchestrator: 'compose'}, {name: 'pangolin-newt', status: {state: 'running'}, generation: 11, orchestrator: 'compose'}];

for (const l of lines) {
  const [name, , token, ag, dg] = l.split(' ');
  const cfg = Object.assign({hw: {model: 'RevPi Connect 4 32/4GB', board: '1.3', cpu: 'Raspberry Pi Compute Module 4 Rev 1.1'}, os: '0.5.1-dev3', online: true, serial: 'PR100000R00'}, fleet[name] || {});
  const apps = JSON.parse(JSON.stringify(cfg.apps || DEFAULT_APPS));  // mutable: generation activation changes it
  const insecure = cfg.insecure !== undefined ? cfg.insecure : name.includes('Nord');
  const st = {ag, dg, groupsActive: ag};
  const c = mqtt.connect('mqtt://localhost:1883', {username: token});
  const tel = (o) => c.publish('v1/devices/me/telemetry', JSON.stringify(o));
  const problems = cfg.consistent === false ? [{kind: 'UnsatisfiedRequirement', component: {id: 'app.pangolin-newt'}, selector: {id: 'runtime.docker-compose', version: '>=6.0.0'}}] : [];
  const attrs = () => c.publish('v1/devices/me/attributes', JSON.stringify({
    'boot.bootFlow': 'tryboot', 'boot.groups': {a: {}, b: {}}, 'state.status': cfg.state || 'active', 'state.dataPartition': '/dev/mmcblk0p4',
    'api.version': '0.1.4', 'daemon.features': {factory_reset: cfg.factoryReset !== false, system_commit: true, system_reboot: true, app_lifecycle: true, dangerously_insecure: insecure}, 'admin.version': cfg.os.startsWith('0.4') ? '0.5.0' : '0.6.0',
    'components.consistent': cfg.consistent !== false, 'components.problems': problems,
    'components.components': buildComponents(cfg, apps),
    'slots.boot-a': {active: st.ag === 'a', size: 70254592}, 'slots.boot-b': {active: st.ag === 'b', size: 70254592},
    'slots.system-a': {active: st.ag === 'a', size: 1288490188, updated_at: '2026-11-20T10:00:00Z', hashes: {sha256: '9f2c4be1a7d03c55e0'}},
    'slots.system-b': {active: st.ag === 'b', size: 1395864371, updated_at: '2026-11-24T09:12:00Z', hashes: {sha256: '3b77aa01c9e2f4d8'}},
    'apps.apps': apps
  }));
  // past jobs of this device (telemetry with timestamps in the past)
  const history = () => {
    let n = 0;
    for (const j of cfg.jobs || []) {
      const id = 'seed-' + name + '-' + (n++), t0 = Date.now() - j.minutesAgo * 60000;
      const ev = (offset, jobEvent) => c.publish('v1/devices/me/telemetry', JSON.stringify({ts: t0 + offset, values: {jobEvent}}));
      const mk = (status) => ({type: 'job-changed', job: {id, title: j.title, kind: j.kind, status: status === 'failed' ? {status, message: j.failure, exitCode: 1} : {status}}});
      ev(0, mk('queued')); ev(400, mk('running'));
      j.lines.forEach((line, i) => ev(1000 + i * 900, {type: 'job-output', jobId: id, stream: 'stderr', line}));
      if (j.status !== 'running') { ev(2000 + j.lines.length * 900, mk(j.status)); }
    }
  };
  const pushState = () => { tel({'boot.activeGroup': st.ag, 'boot.defaultGroup': st.dg}); attrs(); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Event shapes as forwarded by the gateway SSE connector (camelCase, see rugix-admin AdminEvent).
  async function job(id, title, kind, outLines, progress, mutate) {
    const j = (status) => ({type: 'job-changed', job: {id, title, kind, status: typeof status === 'string' ? {status} : status, createdAt: '', updatedAt: ''}});
    const out = (line) => tel({jobEvent: {type: 'job-output', jobId: id, stream: 'stderr', line}});
    tel({jobEvent: j('queued')}); await sleep(600); tel({jobEvent: j('running')});
    if (progress) {
      // install: percentage 0..100 in small steps, output lines are spread over the run
      const steps = 25, perLine = Math.max(1, Math.floor(steps / outLines.length));
      for (let i = 0; i <= steps; i++) {
        await sleep(700 + Math.random() * 300);
        if (i % perLine === 0 && outLines[i / perLine]) { out(outLines[i / perLine]); }
        tel({jobEvent: {type: 'install-progress', jobId: id, progress: Math.round(i * 100 / steps * 10) / 10}});
      }
    } else {
      for (const line of outLines) { await sleep(900); out(line); }
    }
    mutate && mutate(); await sleep(500); tel({jobEvent: j('succeeded')}); pushState();
  }
  c.on('connect', () => {
    console.log(name, 'connected', cfg.online ? '(online)' : '(offline after publish)');
    pushState(); history();
    if (!cfg.online) {
      setTimeout(() => c.end(), 2500 + Math.random() * 500);
      return;
    }
    c.subscribe('v1/devices/me/rpc/request/+');
  });
  c.on('message', (topic, buf) => {
    const id = topic.split('/').pop(); const {method, params = {}} = JSON.parse(buf.toString());
    console.log(name, 'RPC', method, JSON.stringify(params));
    const jobId = params.uuid || String(Date.now() % 100000);
    const reply = (v) => c.publish('v1/devices/me/rpc/response/' + id, JSON.stringify(v));
    const spare = st.ag === 'a' ? 'b' : 'a';
    if (method === 'installUpdateFromUrl') { reply({}); job(jobId, 'Install system update', 'system-update', ['Downloading bundle', 'Verifying signature', 'Writing system-' + spare, 'Writing boot-' + spare, 'Selecting boot group ' + spare], true, () => { st.dg = st.dg; }); }
    else if (method === 'installAppFromUrl') { reply({}); job(jobId, 'Install app bundle', 'app-install', ['Downloading', 'Unpacking', 'Done'], false); /* app installs report no percentage */ }
    else if (method === 'appInfo') {
      const a = apps.find(x => x.name === params.app) || {name: params.app, generation: 1};
      const gens = [0, 1, 2].map(i => ({number: (a.generation || 1) - i, created_at: new Date(Date.now() - (i + 1) * 86400000 * 3).toISOString(), complete: i !== 2 || a.generation > 3, active: i === 0,
        last_activated: i === 0 ? new Date(Date.now() - 86400000).toISOString() : undefined, configuration_revision: 1})).filter(g => g.number > 0);
      reply({name: a.name, status: a.status, lifecycle: {state: 'active', generation: a.generation}, orchestrator: a.orchestrator, generations: gens});
    }
    else if (method === 'appActivate') {
      const g = Number(((params.query || '').match(/generation=(\d+)/) || [])[1]);
      reply(jobId); job(jobId, 'Activate application generation', 'app-action', ['Activating generation ' + g], false, () => { const a = apps.find(x => x.name === params.app); if (a && g) { a.generation = g; } });
    }
    else if (method === 'rebootSpare') { reply(jobId); job(jobId, 'Reboot into spare', 'system-action', ['Rebooting into ' + spare], false, () => { st.ag = spare; }); }
    else if (method === 'reboot') { reply(jobId); job(jobId, 'Reboot', 'system-action', ['Rebooting'], false); }
    else if (method === 'commit') { reply(jobId); job(jobId, 'Commit', 'system-action', ['Setting default boot group ' + st.ag], false, () => { st.dg = st.ag; }); }
    else if (method === 'factoryReset') { reply({id: jobId}); job(jobId, 'Factory reset', 'system-action', ['Resetting state'], false); }
    else { reply(jobId); job(jobId, method, 'app-action', [method + ' ' + (params.app || '')], false); }
  });
}

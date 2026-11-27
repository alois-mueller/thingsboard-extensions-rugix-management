const fs = require('fs');
const chain = JSON.parse(fs.readFileSync(__dirname + '/Rugix_refresh_after_job.rulechain.json', 'utf8'));
const conn = JSON.parse(`${process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : '{}'}`);
const script = name => chain.metadata.nodes.find(n => n.name === name).configuration.jsScript;
const run = (name, msg, metadata = {deviceName: 'Testanlage_Felix_Rugix', deviceType: 'RevolutionPi_Rugix'}) => new Function('msg', 'metadata', 'msgType', script(name))(msg, metadata, 'POST_TELEMETRY_REQUEST');
// wire shapes of Rugix Admin (camelCase, see api.sidex)
const sys = {boot: {bootFlow: 'tryboot', activeGroup: 'a', defaultGroup: 'b', groups: {a: {}, b: {}}},
  state: {status: 'active', dataPartition: '/dev/mmcblk0p4'},
  slots: {'boot-a': {active: true, size: 1}, 'boot-b': {active: false, size: 2}, 'system-a': {active: true, hashes: {sha256: 'x'}}, 'system-b': {active: false}}};
const sysErr = {boot: sys.boot, state: {status: 'error', message: "no data partition", ephemeral: true}, slots: sys.slots};
const apps = {apps: [{name: 'pangolin-newt', status: {state: 'running'}, generation: 13, orchestrator: 'docker-compose', metadata: {a: 1}}, {name: 'x', status: {state: 'stopped'}}]};
const comps = {roots: [{kind: 'System', path: '/usr/lib/rugix/components'}], components: [{source: {kind: 'System', path: '/p'}, component: {id: 'system.edge-os', version: '0.4.9'}}], consistent: true, problems: []};
const py = o => JSON.stringify(o).replace(/'/g, "\\'").replace(/"/g, "'").replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None');
// what the gateway sends: a native object (no responseValueExpression) as {"result": ...}, or text
const shapes = {object: o => ({result: o}), jsonText: o => ({result: JSON.stringify(o)}), pythonText: o => ({result: py(o)})};
const keysOf = o => Object.keys(o).sort();
const expect = {
  system: ['boot.bootFlow', 'boot.groups', 'slots', 'slots.boot-a', 'slots.boot-b', 'slots.system-a', 'slots.system-b', 'state.dataPartition', 'state.status'],
  apps: ['apps.apps'], comps: ['components.components', 'components.consistent', 'components.problems', 'components.roots']
};
let bad = 0;
const check = (label, ok, extra = '') => { if (!ok) { bad++; } console.log((ok ? 'ok  ' : 'FAIL') + ' ' + label + (extra ? '  ' + extra : '')); };
for (const [sn, wrap] of Object.entries(shapes)) {
  const a = run('system info to attributes', wrap(sys)), t = run('boot groups to telemetry', wrap(sys));
  check(`${sn}: system attributes = connector keys`, JSON.stringify(keysOf(a.msg)) === JSON.stringify(expect.system), JSON.stringify(keysOf(a.msg)));
  check(`${sn}: telemetry`, JSON.stringify(t.msg) === JSON.stringify({'boot.activeGroup': 'a', 'boot.defaultGroup': 'b'}), JSON.stringify(t.msg));
  check(`${sn}: msgType`, a.msgType === 'POST_ATTRIBUTES_REQUEST' && t.msgType === 'POST_TELEMETRY_REQUEST');
  const p = run('apps to attributes', wrap(apps));
  check(`${sn}: apps`, JSON.stringify(keysOf(p.msg)) === '["apps.apps"]' && p.msg['apps.apps'][0].generation === 13 && p.msg['apps.apps'][0].status.state === 'running');
  const c = run('components to attributes', wrap(comps));
  check(`${sn}: components`, JSON.stringify(keysOf(c.msg)) === JSON.stringify(expect.comps) && c.msg['components.consistent'] === true);
}
const e = run('system info to attributes', {result: JSON.stringify(sysErr)});
check('state error variant: message + ephemeral', e.msg['state.message'] === 'no data partition' && e.msg['state.ephemeral'] === true, JSON.stringify([e.msg['state.status'], e.msg['state.message'], e.msg['state.ephemeral']]));
let errOut; try { errOut = run('apps to attributes', {error: 'Rpc timeout'}); } catch (x) { errOut = 'THROWS ' + x.message; }
check('error answer does not throw', typeof errOut === 'object', JSON.stringify(errOut).slice(0, 120));
// filter with the Rugix Admin event shapes
const f = ev => new Function('msg', 'metadata', 'msgType', script('job succeeded'))(ev, {}, 'POST_TELEMETRY_REQUEST');
const job = status => ({type: 'job-changed', job: {id: '1', title: 't', kind: 'app-action', status}});
check('filter: succeeded object', f({jobEvent: job({status: 'succeeded'})}) === true);
check('filter: succeeded JSON text', f({jobEvent: JSON.stringify(job({status: 'succeeded'}))}) === true);
check('filter: running / failed / output / other keys', [f({jobEvent: job({status: 'running'})}), f({jobEvent: job({status: 'failed', message: 'x'})}), f({jobEvent: {type: 'job-output', jobId: '1', line: 'a'}}), f({machineStats: {}})].every(v => v === false));
// RPC request nodes against the connector
const r = run('create rpc getApps', {jobEvent: 1});
check('rpc request message', r.msg.method === 'getApps' && r.msgType === 'RPC_CALL_FROM_SERVER_TO_DEVICE' && r.metadata.oneway === 'false' && !!r.metadata.requestUUID && !!r.metadata.deviceName);
if (conn.serverSideRpc) {
  for (const m of ['getSystemInfo', 'getApps', 'getComponents']) {
    const c = conn.serverSideRpc.find(x => x.methodFilter === m);
    check(`connector has RPC ${m}`, !!c && !c.responseValueExpression && c.httpMethod === 'GET', c ? c.requestUrlExpression : 'missing');
  }
  const keys = new Set(conn.mapping.flatMap(m => [...(m.converter.attributes || []).map(a => a.key), ...(m.converter.telemetry || []).map(a => a.key)]));
  const produced = [...expect.system, ...expect.apps, ...expect.comps, 'boot.activeGroup', 'boot.defaultGroup'];
  const missing = produced.filter(k => !keys.has(k));
  check('every key written by the chain is a key of the connector mapping', missing.length === 0, missing.join(','));
}
console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');

///
/// Rugix management extension for ThingsBoard
///

import {
  RugixApp,
  RugixMachineStat,
  RugixCapability,
  RugixComponent,
  RugixHardwareInfo,
  RugixComponentProblem,
  RugixDaemonFeature,
  RugixDaemonFeatures,
  RugixDevice,
  RugixJobEvent,
  RugixJobStatus,
  RugixKeySettings,
  RugixSlot
} from './rugix.models';

/** Gateway attributes arrive either as parsed JSON or as JSON strings. */
export function parseJson<T = any>(value: any, fallback?: T): T {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch (e) {
      return value as unknown as T;
    }
  }
  return value as T;
}

export function toBoolean(value: any): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function parseSlots(slots: { [name: string]: any }): RugixSlot[] {
  return Object.keys(slots).sort().map(name => {
    const info = parseJson<any>(slots[name], {}) || {};
    return {
      name,
      active: !!info.active,
      size: info.size,
      updatedAt: info.updated_at ?? info.updatedAt,
      hashes: info.hashes
    };
  });
}

export function parseApps(value: any): RugixApp[] {
  const parsed = parseJson<any>(value, []);
  const list = Array.isArray(parsed) ? parsed : (parsed?.apps ?? []);
  return list.map((a: any) => ({
    name: a.name,
    status: a.status,
    generation: a.generation,
    orchestrator: a.orchestrator,
    metadata: a.metadata
  }));
}

const cap = (c: any): RugixCapability => ({id: c?.id, value: c?.value, version: c?.version});

/** `GET /api/components` -> `components` (array of `{source, component}`), tolerant against wrappers. */
export function parseComponents(value: any): RugixComponent[] {
  let parsed = parseJson<any>(value, []);
  if (parsed && !Array.isArray(parsed)) {
    parsed = parsed.components ?? [];
  }
  return (Array.isArray(parsed) ? parsed : []).map((e: any) => {
    const c = e.component || e;
    const s = e.source || {};
    return {
      id: c.id,
      version: c.version,
      kind: s.kind || 'Unknown',
      path: s.path,
      app: s.app,
      generation: s.generation,
      provides: (c.provides || []).map(cap),
      requires: (c.requires || []).map(cap),
      claims: (c.claims || []).map(cap),
      conflicts: (c.conflicts || []).map(cap)
    };
  }).filter((c: RugixComponent) => !!c.id);
}

export function capabilityLabel(c: RugixCapability): string {
  return c.id + (c.value !== undefined && c.value !== null ? ' = ' + c.value : '') + (c.version ? ' ' + c.version : '');
}

/** All capabilities provided anywhere, used to flag unsatisfied requirements. */
export function providedIds(list: RugixComponent[]): Set<string> {
  const ids = new Set<string>();
  list.forEach(c => { ids.add(c.id); c.provides.forEach(p => ids.add(p.id)); });
  return ids;
}

export function deriveHardware(list: RugixComponent[]): RugixHardwareInfo {
  const provided = (id: string) => {
    for (const c of list) {
      const p = c.provides.find(x => x.id === id);
      if (p) {
        return p;
      }
    }
    return undefined;
  };
  const val = (id: string) => provided(id)?.value;
  const ver = (id: string) => provided(id)?.version;
  const byId = (id: string) => list.find(c => c.id === id);
  return {
    vendor: val('hardware.revpi.vendor'),
    model: val('hardware.revpi.model'),
    boardVersion: ver('hardware.revpi.version'),
    serial: val('hardware.revpi.id'),
    cpuModule: val('hardware.rpi.model'),
    osVersion: byId('system.edge-os')?.version,
    rugixCtrl: ver('rugix.ctrl'),
    arch: val('host.arch'),
    docker: byId('runtime.docker')?.version,
    picontrol: ver('runtime.revpi.picontrol')
  };
}

export function parseProblems(value: any): RugixComponentProblem[] {
  const parsed = parseJson<any>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map(p => {
    const type = Object.keys(p || {}).find(k => k !== 'detail') || 'problem';
    return {type: p?.type ?? type, detail: p?.[type] ?? p};
  });
}

/** Human readable status of an app (rugix `AppStatus` can be a string or an externally tagged object). */
export function appStatusLabel(status: any): string {
  if (status === null || status === undefined) {
    return 'unknown';
  }
  if (typeof status === 'string') {
    return status;
  }
  // Rugix Admin: `{"state": "running"}` / `{"state": "failed", "message": "…"}`
  if (typeof status.state === 'string') {
    return status.state;
  }
  const keys = Object.keys(status);
  return keys.length ? keys[0] : 'unknown';
}

const FEATURE_KEYS: RugixDaemonFeature[] = ['factory_reset', 'system_commit', 'system_reboot', 'app_lifecycle'];

/**
 * Accepts the whole `GET /api/daemon` body (`{dangerously_insecure, features: {…}}`) or only its `features` object,
 * in snake_case or camelCase. Unknown/missing flags stay `undefined`.
 */
export function parseDaemon(value: any): { features?: RugixDaemonFeatures; insecure?: boolean } {
  const v = parseJson<any>(value);
  if (!v || typeof v !== 'object') {
    return {};
  }
  const f = v.features && typeof v.features === 'object' ? v.features : v;
  const features: RugixDaemonFeatures = {};
  let any = false;
  for (const k of FEATURE_KEYS) {
    const camel = k.replace(/_(\w)/g, (_, c) => c.toUpperCase());
    const flag = f[k] ?? f[camel];
    if (flag !== undefined) {
      features[k] = toBoolean(flag);
      any = true;
    }
  }
  const ins = v.dangerously_insecure ?? v.dangerouslyInsecure ?? f.dangerously_insecure;
  return {features: any ? features : undefined, insecure: ins === undefined ? undefined : toBoolean(ins)};
}

export function appStatusMessage(status: any): string {
  return (status && typeof status === 'object' && typeof status.message === 'string') ? status.message : '';
}

export function newDevice(id: string, name: string, label: string): RugixDevice {
  return {
    id, name, label,
    active: false,
    bootGroups: [],
    slots: [],
    components: undefined,
    componentList: [],
    hardware: {},
    componentsProblems: [],
    apps: [],
    commitPending: false
  };
}

/** Apply one latest-value data key to the device model. */
export function applyValue(device: RugixDevice, key: string, raw: any, keys: RugixKeySettings, slotRaw: { [name: string]: any }): void {
  if (key === keys.active) {
    device.active = toBoolean(raw);
  } else if (key === keys.lastActivityTime) {
    const n = Number(raw);
    device.lastSeen = isFinite(n) && n > 0 ? n : device.lastSeen;
  } else if (key === keys.bootFlow) {
    device.bootFlow = raw;
  } else if (key === keys.bootGroups) {
    const groups = parseJson<any>(raw, {});
    device.bootGroups = Array.isArray(groups) ? groups : Object.keys(groups || {});
  } else if (key === keys.activeGroup) {
    device.activeGroup = raw;
  } else if (key === keys.defaultGroup) {
    device.defaultGroup = raw;
  } else if (key === keys.stateStatus) {
    device.stateStatus = raw;
  } else if (key === keys.dataPartition) {
    device.dataPartition = raw;
  } else if (key === keys.apiVersion) {
    device.apiVersion = raw;
  } else if (key === keys.daemonFeatures) {
    device.features = parseJson(raw);
    const daemon = parseDaemon(device.features);
    device.daemon = daemon.features;
    if (daemon.insecure !== undefined) {
      device.insecure = daemon.insecure;
    }
  } else if (key === keys.adminVersion) {
    device.adminVersion = typeof raw === 'string' ? raw : (parseJson<any>(raw)?.version ?? undefined);
  } else if (key === keys.components) {
    device.components = parseJson(raw);
    device.componentList = parseComponents(raw);
    device.hardware = deriveHardware(device.componentList);
  } else if (key === keys.componentsConsistent) {
    const v = parseJson<any>(raw);
    device.componentsConsistent = typeof v === 'boolean' ? v : (v === null || v === undefined ? undefined : toBoolean(v));
  } else if (key === keys.componentsProblems) {
    device.componentsProblems = parseProblems(raw);
  } else if (key === keys.apps) {
    device.apps = parseApps(raw);
  } else if (key === keys.jobEvent) {
    device.lastJobEvent = parseJobEvent(raw, Date.now());
  } else if (key.startsWith(keys.slotPrefix)) {
    slotRaw[key.substring(keys.slotPrefix.length)] = raw;
  }
}

const STATUS_VALUES: RugixJobStatus[] = ['queued', 'running', 'succeeded', 'failed'];

/** Normalize a raw `AdminEvent` (as forwarded by the gateway SSE connector into `jobEvent` telemetry). */
export function parseJobEvent(raw: any, ts: number): RugixJobEvent {
  const e = parseJson<any>(raw, {}) || {};
  const event: RugixJobEvent = {ts, type: e.type ?? 'unknown', raw: e, jobId: e.job_id ?? e.job?.id};
  switch (e.type) {
    case 'job-changed': {
      const status = e.job?.status?.status;
      event.title = e.job?.title;
      event.kind = typeof e.job?.kind === 'string' ? e.job.kind : Object.keys(e.job?.kind || {})[0];
      event.status = STATUS_VALUES.includes(status) ? status : 'unknown';
      event.failureMessage = e.job?.status?.message ?? e.job?.status?.failed?.message;
      break;
    }
    case 'job-output':
      event.line = e.line;
      event.stream = typeof e.stream === 'string' ? e.stream : Object.keys(e.stream || {})[0];
      break;
    case 'install-progress':
      event.progress = Number(e.progress);
      break;
    case 'upload-progress':
      event.message = `${e.bytes} bytes uploaded`;
      break;
    case 'compatibility-check-skipped':
      event.message = `Compatibility check skipped: ${e.reason}`;
      break;
    case 'app-activation-result':
      event.message = `App ${e.app} generation ${e.generation}: ${typeof e.outcome === 'string' ? e.outcome : Object.keys(e.outcome || {})[0]}`;
      break;
    default:
      break;
  }
  return event;
}

export function isTerminalStatus(status?: RugixJobStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) {
    return '—';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function uuidv4(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = Math.random() * 16 | 0;
    return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Apps from `GET /api/apps` enriched with the version of their app component. Apps that only exist in the
 * components list (no `/api/apps` mapping in the gateway) are added, so the list is never empty for devices
 * that run apps.
 */
export function mergeApps(apps: RugixApp[], components: RugixComponent[]): RugixApp[] {
  const byApp = new Map<string, RugixComponent>();
  components.filter(c => c.kind === 'App' && c.app).forEach(c => byApp.set(c.app, c));
  const result = apps.map(a => {
    const c = byApp.get(a.name);
    return {...a, version: a.version ?? c?.version, generation: a.generation ?? c?.generation};
  });
  byApp.forEach((c, name) => {
    if (!result.some(a => a.name === name)) {
      result.push({name, version: c.version, generation: c.generation});
    }
  });
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

const num = (v: any): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : undefined;
};

/**
 * Parse the gateway `machineStats` value. `freeMemory` is interpreted as the percentage of free memory
 * (as reported by the ThingsBoard IoT Gateway), so the used share is `100 - freeMemory`.
 */
export function parseMachineStat(raw: any, ts: number): RugixMachineStat | undefined {
  const v = parseJson<any>(raw);
  if (!v || typeof v !== 'object') {
    return undefined;
  }
  const free = num(v.freeMemory);
  const rss = num(v.gwProcessMemoryFullInfo?.rss);
  return {
    ts,
    cpu: num(v.totalCpuUsage),
    gwCpu: num(v.gwProcessCpuUsage),
    memUsed: free === undefined ? undefined : Math.max(0, Math.min(100, 100 - free)),
    gwMemory: num(v.gwMemory),
    gwRssMiB: rss === undefined ? undefined : rss / 1048576,
    diskUsage: num(v.diskUsage),
    freeDisk: v.freeDisk === undefined ? undefined : String(v.freeDisk),
    msgsSent: num(v.msgsSentToPlatform),
    msgsReceived: num(v.msgsReceivedFromPlatform)
  };
}

/** Average samples into at most `maxPoints` buckets to keep charts light. */
export function downsample(stats: RugixMachineStat[], maxPoints: number): RugixMachineStat[] {
  if (stats.length <= maxPoints) {
    return stats;
  }
  const size = Math.ceil(stats.length / maxPoints);
  const keys: (keyof RugixMachineStat)[] = ['cpu', 'gwCpu', 'memUsed', 'gwMemory', 'gwRssMiB', 'diskUsage'];
  const out: RugixMachineStat[] = [];
  for (let i = 0; i < stats.length; i += size) {
    const bucket = stats.slice(i, i + size);
    const avg: any = {ts: bucket[Math.floor(bucket.length / 2)].ts, freeDisk: bucket[bucket.length - 1].freeDisk,
      msgsSent: bucket[bucket.length - 1].msgsSent, msgsReceived: bucket[bucket.length - 1].msgsReceived};
    for (const k of keys) {
      const vals = bucket.map(b => b[k] as number).filter(x => x !== undefined);
      avg[k] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
    }
    out.push(avg);
  }
  return out;
}

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;

/** `dd/MM/yyyy HH:mm:ss` (24h). */
export function formatDateTime(ts: number, seconds = true): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` +
    (seconds ? ':' + pad2(d.getSeconds()) : '');
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

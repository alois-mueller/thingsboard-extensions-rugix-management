///
/// Rugix management extension for ThingsBoard
///

import {
  RugixApp,
  RugixComponentProblem,
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
  const keys = Object.keys(status);
  return keys.length ? keys[0] : 'unknown';
}

export function newDevice(id: string, name: string, label: string): RugixDevice {
  return {
    id, name, label,
    active: false,
    bootGroups: [],
    slots: [],
    components: undefined,
    componentsProblems: [],
    apps: [],
    commitPending: false
  };
}

/** Apply one latest-value data key to the device model. */
export function applyValue(device: RugixDevice, key: string, raw: any, keys: RugixKeySettings, slotRaw: { [name: string]: any }): void {
  if (key === keys.active) {
    device.active = toBoolean(raw);
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
  } else if (key === keys.components) {
    device.components = parseJson(raw);
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

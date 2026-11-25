///
/// Rugix management extension for ThingsBoard
///

/** Widget settings (all optional – defaults match the `rugix-admin` TB IoT Gateway request connector). */
export interface RugixWidgetSettings {
  title: string;
  enableSearch: boolean;
  defaultPageSize: number;
  gatewayRelationType: string;
  maxRelationDepth: number;
  rpc: RugixRpcSettings;
  keys: RugixKeySettings;
  sse: RugixSseSettings;
}

/** Names of the server side RPC methods configured in the gateway connector. */
export interface RugixRpcSettings {
  reboot: string;
  rebootSpare: string;
  commit: string;
  factoryReset: string;
  installUpdate: string;
  installApp: string;
  appStart: string;
  appStop: string;
  appActivate: string;
  appDeactivate: string;
  appRollback: string;
  appRemove: string;
  appGc: string;
  appsGc: string;
  timeout: number;
}

/** Attribute / telemetry keys the widget reads (must be added as data keys of the widget datasource). */
export interface RugixKeySettings {
  active: string;
  bootFlow: string;
  bootGroups: string;
  activeGroup: string;
  defaultGroup: string;
  stateStatus: string;
  dataPartition: string;
  apiVersion: string;
  daemonFeatures: string;
  components: string;
  componentsConsistent: string;
  componentsProblems: string;
  apps: string;
  jobEvent: string;
  slotPrefix: string;
}

/** Live job stream (gateway SSE connector). */
export interface RugixSseSettings {
  rpcMethod: string;
  urlTemplate: string;
  reconnectPeriod: number;
  telemetryKey: string;
}

export const DEFAULT_RUGIX_SETTINGS: RugixWidgetSettings = {
  title: 'Rugix Management',
  enableSearch: true,
  defaultPageSize: 10,
  gatewayRelationType: 'Created',
  maxRelationDepth: 10,
  rpc: {
    reboot: 'reboot',
    rebootSpare: 'rebootSpare',
    commit: 'commit',
    factoryReset: 'factoryReset',
    installUpdate: 'installUpdateFromUrl',
    installApp: 'installAppFromUrl',
    appStart: 'appStart',
    appStop: 'appStop',
    appActivate: 'appActivate',
    appDeactivate: 'appDeactivate',
    appRollback: 'appRollback',
    appRemove: 'appRemove',
    appGc: 'appGc',
    appsGc: 'appsGarbageCollect',
    timeout: 30000
  },
  keys: {
    active: 'active',
    bootFlow: 'boot.bootFlow',
    bootGroups: 'boot.groups',
    activeGroup: 'boot.activeGroup',
    defaultGroup: 'boot.defaultGroup',
    stateStatus: 'state.status',
    dataPartition: 'state.dataPartition',
    apiVersion: 'api.version',
    daemonFeatures: 'daemon.features',
    components: 'components.components',
    componentsConsistent: 'components.consistent',
    componentsProblems: 'components.problems',
    apps: 'apps.apps',
    jobEvent: 'jobEvent',
    slotPrefix: 'slots.'
  },
  sse: {
    rpcMethod: 'request_startSse',
    urlTemplate: '/api/jobs/{jobId}/events',
    reconnectPeriod: 5,
    telemetryKey: 'jobEvent'
  }
};

/** Merge (shallow per section) user settings with the defaults. */
export function mergeRugixSettings(settings: Partial<RugixWidgetSettings> | undefined): RugixWidgetSettings {
  const s = settings || {};
  return {
    ...DEFAULT_RUGIX_SETTINGS,
    ...s,
    rpc: {...DEFAULT_RUGIX_SETTINGS.rpc, ...(s.rpc || {})},
    keys: {...DEFAULT_RUGIX_SETTINGS.keys, ...(s.keys || {})},
    sse: {...DEFAULT_RUGIX_SETTINGS.sse, ...(s.sse || {})}
  };
}

export interface RugixSlot {
  name: string;
  active: boolean;
  size?: number;
  updatedAt?: string;
  hashes?: { [algorithm: string]: string };
}

export interface RugixApp {
  name: string;
  status?: any;
  generation?: number;
  orchestrator?: string;
  metadata?: any;
}

/** A capability a component provides / requires / claims (`{id, value?, version?}`). */
export interface RugixCapability {
  id: string;
  value?: string;
  version?: string;
}

/** One entry of `GET /api/components` (`components` list). */
export interface RugixComponent {
  id: string;
  version?: string;
  kind: string;
  path?: string;
  app?: string;
  generation?: number;
  provides: RugixCapability[];
  requires: RugixCapability[];
  claims: RugixCapability[];
  conflicts: RugixCapability[];
}

/** Facts derived from the components list for the overview tab. */
export interface RugixHardwareInfo {
  vendor?: string;
  model?: string;
  boardVersion?: string;
  serial?: string;
  cpuModule?: string;
  osVersion?: string;
  rugixCtrl?: string;
  arch?: string;
  docker?: string;
  picontrol?: string;
}

export interface RugixComponentProblem {
  type: string;
  detail: any;
}

/** One managed Rugix device (= one row of the table). */
export interface RugixDevice {
  id: string;
  name: string;
  label: string;
  active: boolean;
  bootFlow?: string;
  bootGroups: string[];
  activeGroup?: string;
  defaultGroup?: string;
  stateStatus?: string;
  dataPartition?: string;
  apiVersion?: string;
  features?: any;
  slots: RugixSlot[];
  components: any;
  componentList: RugixComponent[];
  hardware: RugixHardwareInfo;
  componentsConsistent?: boolean;
  componentsProblems: RugixComponentProblem[];
  apps: RugixApp[];
  /** `true` when the system runs a non-default boot group, i.e. an update is waiting for `commit`. */
  commitPending: boolean;
  /** Latest `jobEvent` telemetry. */
  lastJobEvent?: RugixJobEvent;
}

export type RugixJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';

/** Normalized `AdminEvent` of rugix-admin (`/api/jobs/{id}/events`). */
export interface RugixJobEvent {
  ts: number;
  type: string;
  jobId?: string;
  raw: any;
  title?: string;
  kind?: string;
  status?: RugixJobStatus;
  failureMessage?: string;
  progress?: number;
  line?: string;
  stream?: string;
  message?: string;
}

export type RugixSystemAction = 'reboot' | 'rebootSpare' | 'commit' | 'factoryReset';
export type RugixAppAction = 'appStart' | 'appStop' | 'appActivate' | 'appDeactivate' | 'appRollback' | 'appRemove' | 'appGc';

/** Query parameters of `POST /api/system/update/{id}/url` (see rugix-admin `SystemInstallOptions`). */
export interface RugixInstallOptions {
  reboot?: 'yes' | 'no' | 'set' | 'deferred';
  bundle_hash?: string;
  boot_group?: string;
  keep_overlay?: boolean;
  skip_compatibility_check?: boolean;
  insecure_skip_bundle_verification?: boolean;
}

export const RUGIX_REBOOT_MODES: { value: RugixInstallOptions['reboot']; label: string; hint: string }[] = [
  {value: 'yes', label: 'Install & reboot', hint: 'Select the new system and reboot immediately.'},
  {value: 'set', label: 'Install & select', hint: 'Select the new system, reboot later manually.'},
  {value: 'deferred', label: 'Deferred', hint: 'Record the new system for the next boot.'},
  {value: 'no', label: 'Install only', hint: 'Do not change the boot selection.'}
];

///
/// Rugix management extension for ThingsBoard
///

/** Widget settings (all optional – defaults match the `rugix-admin` TB IoT Gateway request connector). */
export interface RugixWidgetSettings {
  title: string;
  enableSearch: boolean;
  defaultPageSize: number;
  /** View shown when the widget opens. */
  defaultView: 'overview' | 'devices';
  gatewayRelationType: string;
  maxRelationDepth: number;
  rpc: RugixRpcSettings;
  keys: RugixKeySettings;
  sse: RugixSseSettings;
  access: RugixAccessSettings;
}

/**
 * Which ThingsBoard user authorities may use which action class (UI-level gate; the server side RPC permission is
 * still decided by ThingsBoard). Values: SYS_ADMIN, TENANT_ADMIN, CUSTOMER_USER.
 */
export interface RugixAccessSettings {
  /** Install system update / install app / app actions. */
  install: string[];
  /** Reboot, Reboot (Spare), Commit. */
  power: string[];
  factoryReset: string[];
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
  /** Returns the `GET /api/apps/{app}` response (generations, lifecycle); params `{app}`. */
  appInfo: string;
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
  /** Optional: Rugix Admin build version (`GET /api/info` → `version`). */
  adminVersion: string;
  components: string;
  componentsConsistent: string;
  componentsProblems: string;
  apps: string;
  jobEvent: string;
  /** Telemetry key of the IoT Gateway statistics (read from the related gateway device). */
  machineStats: string;
  /** Optional device attribute (ms epoch) used for "last seen"; falls back to the timestamp of the `active` attribute. */
  lastActivityTime: string;
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
  defaultView: 'overview',
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
    appInfo: 'appInfo',
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
    adminVersion: 'admin.version',
    components: 'components.components',
    componentsConsistent: 'components.consistent',
    componentsProblems: 'components.problems',
    apps: 'apps.apps',
    jobEvent: 'jobEvent',
    machineStats: 'machineStats',
    lastActivityTime: 'lastActivityTime',
    slotPrefix: 'slots.'
  },
  access: {
    install: ['SYS_ADMIN', 'TENANT_ADMIN', 'CUSTOMER_USER'],
    power: ['SYS_ADMIN', 'TENANT_ADMIN', 'CUSTOMER_USER'],
    factoryReset: ['SYS_ADMIN', 'TENANT_ADMIN']
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
    sse: {...DEFAULT_RUGIX_SETTINGS.sse, ...(s.sse || {})},
    access: {...DEFAULT_RUGIX_SETTINGS.access, ...(s.access || {})}
  };
}

export type RugixDaemonFeature = 'factory_reset' | 'system_commit' | 'system_reboot' | 'app_lifecycle';

export type RugixDaemonFeatures = { [K in RugixDaemonFeature]?: boolean };

export interface RugixSlot {
  name: string;
  active: boolean;
  size?: number;
  updatedAt?: string;
  hashes?: { [algorithm: string]: string };
}

export interface RugixApp {
  name: string;
  /** Version of the app component of the active generation (from the components list). */
  version?: string;
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
  /** Privileged operation families enabled in the Rugix Ctrl daemon (`undefined` = unknown, treated as enabled). */
  daemon?: RugixDaemonFeatures;
  /** Daemon allows bypassing bundle verification / compatibility checks (development only). */
  insecure?: boolean;
  adminVersion?: string;
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
  /** Overall health used by the overview donut: healthy / warning / error / offline. */
  health?: 'healthy' | 'warning' | 'error' | 'offline';
  /** Current / most recent job incl. progress (derived from the job events). */
  job?: RugixJobState;
  /** ms epoch of the last known activity (offline since / last seen). */
  lastSeen?: number;
  /** ms epoch of the last change of the `active` attribute (online since / offline since). */
  stateSince?: number;
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

/** Current / most recent job of a device, folded from the `jobEvent` telemetry stream. */
export interface RugixJobState {
  id: string;
  title: string;
  kind: string;
  status: RugixJobStatus;
  /** Installation progress in percent (system update / app install), `null` if not reported. */
  progress: number | null;
  failure: string;
  /** Timestamp (ms) of the last event applied. */
  ts: number;
  /** Only part of the job's events were seen (title unknown) – the full history has to be loaded. */
  partial?: boolean;
}

export type RugixSystemAction = 'reboot' | 'rebootSpare' | 'commit' | 'factoryReset';
export type RugixAppAction = 'appStart' | 'appStop' | 'appActivate' | 'appDeactivate' | 'appRollback' | 'appRemove' | 'appGc';

/** Query parameters of `POST /api/system/update/{id}/url` (see rugix-admin `SystemInstallOptions`). */
export interface RugixInstallOptions {
  reboot?: 'yes' | 'no' | 'set' | 'deferred';
  bundle_hash?: string;
  root_cert?: string;
  boot_group?: string;
  keep_overlay?: boolean;
  skip_compatibility_check?: boolean;
  insecure_skip_bundle_verification?: boolean;
  insecure_allow_missing_block_index?: boolean;
  disable_range_queries?: boolean;
  http_max_retries?: number;
  http_retry_initial_backoff?: number;
  http_retry_max_backoff?: number;
}

/** One generation of an app (`AppGeneration` of rugix-admin). */
export interface RugixAppGeneration {
  number: number;
  createdAt?: string;
  complete: boolean;
  active: boolean;
  lastActivated?: string;
  configurationRevision?: number;
}

/** `GET /api/apps/{app}` (`AppInfoResponse`). */
export interface RugixAppInfo {
  name: string;
  status?: any;
  /** Lifecycle state: inactive / active / starting / stopping / switching / error (+ details). */
  lifecycle: { state: string; [key: string]: any };
  orchestrator?: string;
  generations: RugixAppGeneration[];
}

export const RUGIX_REBOOT_MODES: { value: RugixInstallOptions['reboot']; label: string; hint: string }[] = [
  {value: 'yes', label: 'Install & reboot', hint: 'Select the new system and reboot immediately.'},
  {value: 'set', label: 'Install & select', hint: 'Select the new system, reboot later manually.'},
  {value: 'deferred', label: 'Deferred', hint: 'Record the new system for the next boot.'},
  {value: 'no', label: 'Install only', hint: 'Do not change the boot selection.'}
];

/** One sample of the IoT Gateway `machineStats` telemetry (values are percentages unless noted). */
export interface RugixMachineStat {
  ts: number;
  cpu?: number;
  gwCpu?: number;
  /** Percentage of memory in use (derived from `freeMemory`). */
  memUsed?: number;
  gwMemory?: number;
  /** Resident set size of the gateway process in MiB. */
  gwRssMiB?: number;
  diskUsage?: number;
  freeDisk?: string;
  msgsSent?: number;
  msgsReceived?: number;
}

export interface RugixChartSeries {
  name: string;
  color: string;
  data: [number, number][];
}

export interface RugixStatsRange {
  label: string;
  ms: number;
}

export const RUGIX_STATS_RANGES: RugixStatsRange[] = [
  {label: '1 h', ms: 3600000},
  {label: '6 h', ms: 6 * 3600000},
  {label: '24 h', ms: 24 * 3600000},
  {label: '7 d', ms: 7 * 24 * 3600000}
];

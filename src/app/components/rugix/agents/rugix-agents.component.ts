///
/// Rugix management extension for ThingsBoard
///

import { ChangeDetectorRef, Component, ElementRef, NgZone, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { WidgetContext } from '@home/models/widget-component.models';
import { from, Observable, Subject, Subscription, timer } from 'rxjs';
import { map, mergeMap, takeUntil, toArray } from 'rxjs/operators';
import { Device } from '@shared/models/device.models';
import { AuditLogService } from '@core/public-api';
import { AuditLog, EntityType, TimePageLink } from '@shared/public-api';
import {
  mergeRugixSettings,
  RugixApp,
  RugixAppAction,
  RugixComponent,
  RugixChartSeries,
  RugixDevice,
  RugixMachineStat,
  RugixSystemAction,
  RUGIX_STATS_RANGES,
  RugixStatsRange,
  RugixWidgetSettings
} from '../models/rugix.models';
import { RugixAppGeneration, RugixAppInfo, RugixDaemonFeature, RugixJobEvent, RugixJobState } from '../models/rugix.models';
import { RugixDonutSegment } from '../charts/rugix-donut.component';
import { jobLabel, foldJobEvent, formatDateTime, fixMojibake, appStatusLabel, appStatusMessage, applyValue, downsample, capabilityLabel, mergeApps, providedIds, formatBytes, newDevice, parseSlots } from '../models/rugix-parse';
import { REVPI_ICON } from '../models/rugix-icons';
import { RugixJobHandle, RugixRpcService } from '../services/rugix-rpc.service';
import {
  RugixConfirmDialogComponent,
  RugixConfirmDialogData,
  RugixConfirmDialogResult
} from '../dialogs/rugix-confirm-dialog.component';
import {
  RugixInstallDialogComponent,
  RugixInstallDialogData,
  RugixInstallDialogResult
} from '../dialogs/rugix-install-dialog.component';
import { RugixJobDialogComponent, RugixJobDialogData } from '../dialogs/rugix-job-dialog.component';

interface FleetAlert {
  severity: 'error' | 'warning';
  category: string;
  deviceId: string;
  device: string;
  message: string;
  ts?: number;
}

interface JobGroup {
  id: string;
  title: string;
  kind: string;
  status: string;
  start: number;
  end: number;
  progress: number | null;
  failure: string;
  lines: { ts: number; text: string; kind: 'stdout' | 'stderr' | 'meta' }[];
}

interface SystemActionInfo {
  action: RugixSystemAction;
  icon: string;
  label: string;
  message: (d: RugixDevice) => string;
  warn?: boolean;
  /** Visually pre-warns the user (amber) before a risky but reversible action. */
  caution?: boolean;
  /** Text of the checkbox the user has to tick before the action can be confirmed. */
  ack: string;
}

/**
 * Rugix device management widget – modelled after ThingsBoard's "Edge management → Agents" page:
 * an entity table with status, a details panel with tabs and action dialogs with job progress.
 *
 * Widget type: latest values. Datasource: device(s) with Rugix attributes (see README).
 */
@Component({
  selector: 'tb-rugix-agents',
  templateUrl: './rugix-agents.component.html',
  styleUrls: ['./rugix-agents.component.scss'],
  standalone: false
})
export class RugixAgentsComponent implements OnInit, OnDestroy {

  @Input() ctx: WidgetContext;

  settings: RugixWidgetSettings;
  devices: RugixDevice[] = [];
  selectedId: string | null = null;
  checked = new Set<string>();
  search = '';
  pageIndex = 0;
  pageSize = 10;
  busy = new Set<string>();
  searchOpen = false;
  tabIndex = 0;

  private readonly destroy$ = new Subject<void>();

  // ---- app generations (GET /api/apps/{app} via the gateway RPC "appInfo")
  appOpen = new Set<string>();
  appInfos = new Map<string, { loading: boolean; error: string; info?: RugixAppInfo }>();

  private appKey(d: RugixDevice, a: RugixApp): string {
    return d.id + '|' + a.name;
  }

  isAppOpen(d: RugixDevice, a: RugixApp): boolean {
    return this.appOpen.has(this.appKey(d, a));
  }

  appState(d: RugixDevice, a: RugixApp): { loading: boolean; error: string; info?: RugixAppInfo } | undefined {
    return this.appInfos.get(this.appKey(d, a));
  }

  toggleApp(d: RugixDevice, a: RugixApp): void {
    const key = this.appKey(d, a);
    if (this.appOpen.has(key)) {
      this.appOpen.delete(key);
    } else {
      this.appOpen.add(key);
      this.loadAppInfo(d, a);
    }
  }

  loadAppInfo(d: RugixDevice, a: RugixApp): void {
    const key = this.appKey(d, a);
    const prev = this.appInfos.get(key);
    this.appInfos.set(key, {loading: true, error: '', info: prev?.info});
    this.rpc.appInfo(this.settings, d, a.name).pipe(takeUntil(this.destroy$)).subscribe({
      next: info => { this.appInfos.set(key, {loading: false, error: '', info}); this.cd.markForCheck(); },
      error: err => {
        this.appInfos.set(key, {loading: false, error: err?.error?.message || err?.message || 'Generations could not be loaded (RPC "appInfo" configured in the gateway?).', info: prev?.info});
        this.cd.markForCheck();
      }
    });
  }

  /** Lifecycle hint of an app (starting / stopping / switching / error), nothing for active / inactive. */
  lifecycleNotice(info?: RugixAppInfo): { tone: 'info' | 'err'; text: string } | null {
    const l = info?.lifecycle;
    if (!l) { return null; }
    const g = (n: any) => n === undefined || n === null ? '–' : String(n);
    switch (l.state) {
      case 'starting': return {tone: 'info', text: `Starting generation ${g(l.generation)}.`};
      case 'stopping': return {tone: 'info', text: `Stopping generation ${g(l.generation)}.`};
      case 'switching': return {tone: 'info', text: `${l.recovery ? 'Recovering application' : 'Switching generation'}: ${g(l.from)} → ${g(l.to)}.`};
      case 'error': return {tone: 'err', text: `Generation transition failed (${g(l.from)} → ${g(l.to)}): ${l.message || ''}`};
      default: return null;
    }
  }

  activateGeneration(d: RugixDevice, app: RugixApp, g: RugixAppGeneration): void {
    if (this.blocked(d, 'install', 'app_lifecycle')) {
      return;
    }
    this.dialog.open<RugixConfirmDialogComponent, RugixConfirmDialogData, RugixConfirmDialogResult>(
      RugixConfirmDialogComponent, {
        data: {title: `Activate generation ${g.number}`, message: '', confirmLabel: 'Activate', caution: true,
          acknowledge: `I understand that generation ${g.number} of app "${app.name}" becomes the active generation.`},
        autoFocus: false, maxWidth: '95vw'
      }).afterClosed().subscribe(r => {
      if (r) {
        this.track(d, `Activate ${app.name} (generation ${g.number})`, this.rpc.appAction(this.settings, d, 'appActivate', app.name, {generation: g.number}));
        setTimeout(() => this.loadAppInfo(d, app), 8000);
      }
    });
  }

  // ---- boot groups: reboot into a specific group (rugix-admin: reboot = active group, reboot-spare = the other group)
  bootGroupAction(d: RugixDevice, group: string): SystemActionInfo | undefined {
    if (group === d.activeGroup) {
      return this.systemActions.find(a => a.action === 'reboot');
    }
    const inactive = d.bootGroups.filter(g => g !== d.activeGroup);
    return inactive.length === 1 && inactive[0] === group ? this.systemActions.find(a => a.action === 'rebootSpare') : undefined;
  }

  // ---- fleet job list (Jobs view)
  fleetJobs: { device: RugixDevice; job: JobGroup }[] = [];
  fleetLoading = false;
  fleetDays = 7;
  fleetStatus: '' | 'running' | 'failed' | 'succeeded' = '';
  fleetSearch = '';
  fleetPageIndex = 0;
  readonly fleetPageSize = 10;
  private fleetTimer?: Subscription;

  get fleetFiltered(): { device: RugixDevice; job: JobGroup }[] {
    const q = this.fleetSearch.trim().toLowerCase();
    return this.fleetJobs.filter(f => {
      const s = f.job.status;
      const statusOk = !this.fleetStatus || (this.fleetStatus === 'running' ? (s === 'running' || s === 'queued') : s === this.fleetStatus);
      return statusOk && (!q || [f.device.label, f.device.name, jobLabel(f.job.title, f.job.kind), f.job.id, f.job.status].some(v => (v || '').toLowerCase().includes(q)));
    });
  }

  get fleetPage(): { device: RugixDevice; job: JobGroup }[] {
    return this.fleetFiltered.slice(this.fleetPageIndex * this.fleetPageSize, (this.fleetPageIndex + 1) * this.fleetPageSize);
  }

  fleetCount(status: 'running' | 'failed' | 'succeeded'): number {
    return this.fleetJobs.filter(f => status === 'running' ? (f.job.status === 'running' || f.job.status === 'queued') : f.job.status === status).length;
  }

  setFleetDays(d: number): void {
    this.fleetDays = d;
    this.fleetPageIndex = 0;
    this.loadFleetJobs();
  }

  /** Job history of all devices (jobEvent telemetry), refreshed every 30 s while the Jobs view is open. */
  private syncFleet(): void {
    this.fleetTimer?.unsubscribe();
    this.fleetTimer = undefined;
    if (this.view === 'jobs') {
      this.fleetTimer = timer(0, 30000).subscribe(i => this.loadFleetJobs(i > 0));
    }
  }

  loadFleetJobs(silent = false): void {
    const devices = [...this.devices];
    if (!devices.length) {
      this.fleetJobs = [];
      return;
    }
    this.fleetLoading = !silent || !this.fleetJobs.length;
    from(devices).pipe(
      mergeMap(d => this.rpc.loadJobEvents(this.settings, d, 2000, Date.now() - this.fleetDays * 86400000)
        .pipe(map(events => this.groupJobs(events).map(job => ({device: d, job})))), 4),
      toArray(),
      takeUntil(this.destroy$)
    ).subscribe(parts => {
      this.fleetJobs = ([] as { device: RugixDevice; job: JobGroup }[]).concat(...parts).sort((a, b) => b.job.start - a.job.start);
      this.fleetLoading = false;
      this.fleetPageIndex = Math.min(this.fleetPageIndex, Math.max(0, Math.ceil(this.fleetFiltered.length / this.fleetPageSize) - 1));
      this.cd.markForCheck();
    });
  }

  toggleFleetSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.fleetSearch = '';
      this.fleetPageIndex = 0;
    }
  }

  openDeviceJobs(f: { device: RugixDevice }): void {
    const d = this.devices.find(x => x.id === f.device.id);
    if (!d) {
      return;
    }
    if (this.selectedId !== d.id) {
      this.select(d);
    }
    this.tabIndex = this.jobsTab;
    this.loadJobs(true);
  }

  // ---- device creation time (device entity), loaded when a device is opened
  createdTimes = new Map<string, number>();

  private loadCreated(id: string | null): void {
    if (!id || this.createdTimes.has(id)) {
      return;
    }
    this.rpc.getDeviceCreated(id).pipe(takeUntil(this.destroy$)).subscribe(ts => {
      if (ts) {
        this.createdTimes.set(id, ts);
        this.cd.markForCheck();
      }
    });
  }

  now(): number {
    return Date.now();
  }

  // ---- current job per device (folded from the latest jobEvent of each update)
  private jobStates = new Map<string, RugixJobState>();
  private jobSeeding = new Set<string>();

  private trackJob(d: RugixDevice): void {
    const ev = d.lastJobEvent;
    let st = this.jobStates.get(d.id);
    if (ev && ev.ts > (st?.ts || 0)) {
      st = foldJobEvent(st, ev);
      if (st) {
        this.jobStates.set(d.id, st);
      }
    }
    d.job = st;
    // we joined in the middle of a job: only progress/output events seen, load the history to learn the title/status
    if (st?.partial && !this.jobSeeding.has(st.id)) {
      this.jobSeeding.add(st.id);
      this.rpc.loadJobEvents(this.settings, d, 500, Date.now() - 24 * 3600000).pipe(takeUntil(this.destroy$)).subscribe(events => {
        this.jobSeeding.delete(st.id);
        let rebuilt: RugixJobState | undefined;
        for (const e of [...events].sort((a, b) => a.ts - b.ts).filter(e => e.jobId === st.id)) {
          rebuilt = foldJobEvent(rebuilt, e);
        }
        const cur = this.jobStates.get(d.id);
        if (rebuilt && (!cur || cur.id === rebuilt.id)) {
          this.jobStates.set(d.id, {...rebuilt, ts: Math.max(rebuilt.ts, cur?.ts || 0), progress: cur?.progress ?? rebuilt.progress});
          this.onDataUpdated();
        }
      });
    }
  }

  isJobActive(d: RugixDevice): boolean {
    return d.job?.status === 'running' || d.job?.status === 'queued';
  }

  // ---- fleet overview
  /** Selected view per widget; survives a re-initialisation of the widget (e.g. refresh -> updateAliases). */
  private static readonly lastView = new Map<string, 'overview' | 'devices' | 'jobs'>();
  view: 'overview' | 'devices' | 'jobs' = 'overview';

  private get widgetKey(): string {
    return String((this.ctx as any).widget?.id || (this.ctx as any).id || 'rugix');
  }

  overviewStatus: RugixDonutSegment[] = [];
  overviewOs: RugixDonutSegment[] = [];
  overviewJobs: RugixDonutSegment[] = [];
  alerts: FleetAlert[] = [];
  readonly alertLimit = 8;
  alertsExpanded = false;

  get shownAlerts(): FleetAlert[] {
    return this.alertsExpanded ? this.alerts : this.alerts.slice(0, this.alertLimit);
  }

  setView(v: 'overview' | 'devices' | 'jobs'): void {
    this.view = v;
    RugixAgentsComponent.lastView.set(this.widgetKey, v);
    this.syncFleet();
    if (v === 'overview') {
      this.closeDetails();
    }
  }

  /** Devices tab pre-filtered by the health class of an overview donut segment. */
  showDevices(health?: 'healthy' | 'warning' | 'error' | 'offline'): void {
    this.clearFilters();
    this.search = '';
    this.healthFilter = health || '';
    this.setView('devices');
  }

  openAlert(a: FleetAlert): void {
    const d = this.devices.find(x => x.id === a.deviceId);
    if (d) {
      this.select(d);
    }
  }

  onStatusSegment(key: string): void {
    this.showDevices(key as 'healthy' | 'warning' | 'error' | 'offline');
  }

  private computeOverview(): void {
    const OK = '#198038', WARN = '#ef6c00', ERR = '#d12730', OFF = '#9e9e9e';
    const count = {healthy: 0, warning: 0, error: 0, offline: 0};
    const alerts: FleetAlert[] = [];
    const os = new Map<string, number>();
    const jobs = {succeeded: 0, running: 0, failed: 0, none: 0};
    const push = (d: RugixDevice, severity: 'error' | 'warning', category: string, message: string, ts?: number) =>
      alerts.push({severity, category, deviceId: d.id, device: d.label || d.name, message, ts});
    for (const d of this.devices) {
      let level: 'healthy' | 'warning' | 'error' | 'offline' = 'healthy';
      const raise = (l: 'warning' | 'error') => { if (level !== 'error') { level = (l === 'error' || level === 'healthy') ? l : level; } };
      if (!d.active) {
        level = 'offline';
        push(d, 'warning', 'connectivity', 'Device is offline', d.lastSeen);
      } else {
        if (d.insecure) {
          raise('error'); push(d, 'error', 'security', 'Rugix Ctrl security bypasses enabled');
        }
        if (d.stateStatus === 'error') {
          raise('error'); push(d, 'error', 'state', 'State management reports an error');
        }
        if (d.componentsConsistent === false) {
          raise('warning'); push(d, 'warning', 'components', 'Component set is inconsistent');
        }
        if (d.commitPending) {
          raise('warning');
          push(d, 'warning', 'update', `Running boot group ${d.activeGroup}, default is ${d.defaultGroup} – commit pending`);
        }
      }
      if (d.job?.status === 'failed') {
        push(d, 'error', 'job', `Job failed: ${d.job.failure || jobLabel(d.job.title, d.job.kind)}`.trim(), d.job.ts);
        if (d.active) { raise('error'); }
      }
      d.health = level;
      count[level]++;
      const v = d.hardware.osVersion || 'unknown';
      os.set(v, (os.get(v) || 0) + 1);
      const js = d.job?.status;
      if (js === 'succeeded') { jobs.succeeded++; } else if (js === 'running' || js === 'queued') { jobs.running++; }
      else if (js === 'failed') { jobs.failed++; } else { jobs.none++; }
    }
    this.overviewStatus = [
      {key: 'healthy', label: 'Healthy', value: count.healthy, color: OK},
      {key: 'warning', label: 'Warning', value: count.warning, color: WARN},
      {key: 'error', label: 'Error', value: count.error, color: ERR},
      {key: 'offline', label: 'Offline', value: count.offline, color: OFF}
    ];
    const palette = ['#2f6fd1', '#7b4fd1', '#1aa5a5', '#e0a800', '#c2528b'];
    const sorted = Array.from(os.entries()).sort((a, b) => b[1] - a[1]);
    this.overviewOs = sorted.slice(0, 5).map(([v, n], i) => ({key: v, label: v, value: n, color: palette[i]}));
    const rest = sorted.slice(5).reduce((a, [, n]) => a + n, 0);
    if (rest) { this.overviewOs.push({key: 'other', label: 'Other', value: rest, color: OFF}); }
    this.overviewJobs = [
      {key: 'running', label: 'Running', value: jobs.running, color: '#2f6fd1'},
      {key: 'succeeded', label: 'Succeeded', value: jobs.succeeded, color: OK},
      {key: 'failed', label: 'Failed', value: jobs.failed, color: ERR},
      {key: 'none', label: 'No job yet', value: jobs.none, color: OFF}
    ];
    const rank = (a: FleetAlert) => a.severity === 'error' ? 0 : 1;
    this.alerts = alerts.sort((a, b) => rank(a) - rank(b) || (b.ts || 0) - (a.ts || 0) || a.device.localeCompare(b.device));
  }

  alertIcon(a: FleetAlert): string {
    return a.severity === 'error' ? 'error' : 'warning';
  }

  // ---- job log (jobEvent telemetry of the last 30 days, grouped by job id)
  readonly jobsTab = 5;
  jobGroups: JobGroup[] = [];
  jobEventCount = 0;
  jobsTruncated = false;
  readonly logPageSize = 5;
  jobPageIndex = 0;
  auditPageIndex = 0;

  get jobPage(): JobGroup[] {
    return this.jobGroups.slice(this.jobPageIndex * this.logPageSize, (this.jobPageIndex + 1) * this.logPageSize);
  }

  get auditPage(): AuditLog[] {
    return this.auditLogs.slice(this.auditPageIndex * this.logPageSize, (this.auditPageIndex + 1) * this.logPageSize);
  }
  jobsLoading = false;
  jobsDeviceId = '';
  jobsLastTs = 0;
  jobsDays = 30;
  private jobToggled = new Set<string>();

  private jobsReloadTimer: any;

  /** New job events while the Job log is open: reload quietly (no spinner / button flicker), at most every 1.5 s. */
  private scheduleJobsReload(): void {
    if (this.jobsReloadTimer) {
      return;
    }
    this.jobsReloadTimer = setTimeout(() => {
      this.jobsReloadTimer = null;
      this.loadJobs(true, true);
    }, 1500);
  }

  loadJobs(force = false, silent = false): void {
    const d = this.selected;
    if (!d || this.tabIndex !== this.jobsTab || (!force && this.jobsDeviceId === d.id)) {
      return;
    }
    this.jobsDeviceId = d.id;
    this.jobsLastTs = d.lastJobEvent?.ts || 0;
    this.jobsLoading = !silent || !this.jobGroups.length;
    this.rpc.loadJobEvents(this.settings, d, 5000, Date.now() - this.jobsDays * 86400000).pipe(takeUntil(this.destroy$)).subscribe(events => {
      if (this.selectedId !== d.id) {
        return;
      }
      this.jobEventCount = events.length;
      this.jobsTruncated = events.length >= 5000;
      this.jobGroups = this.groupJobs(events);
      this.jobPageIndex = Math.min(this.jobPageIndex, Math.max(0, Math.ceil(this.jobGroups.length / this.logPageSize) - 1));
      this.jobsLoading = false;
      this.cd.markForCheck();
    });
  }

  private groupJobs(events: RugixJobEvent[]): JobGroup[] {
    const groups = new Map<string, JobGroup>();
    for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
      if (!e.jobId) {
        continue;
      }
      let g = groups.get(e.jobId);
      if (!g) {
        g = {id: e.jobId, title: '', kind: '', status: 'unknown', start: e.ts, end: e.ts, progress: null, failure: '', lines: []};
        groups.set(e.jobId, g);
      }
      g.end = e.ts;
      switch (e.type) {
        case 'job-changed':
          g.title = e.title || g.title;
          g.kind = e.kind || g.kind;
          g.status = e.status || g.status;
          if (e.failureMessage) {
            g.failure = e.failureMessage;
          }
          break;
        case 'install-progress':
          if (e.progress !== undefined && !isNaN(e.progress)) {
            g.progress = Math.max(0, Math.min(100, e.progress));
          }
          break;
        case 'job-output':
          if ((e.line || '').trim()) {
            g.lines.push({ts: e.ts, text: fixMojibake(e.line), kind: e.stream === 'stderr' ? 'stderr' : 'stdout'});
          }
          break;
        default:
          if (e.message) {
            g.lines.push({ts: e.ts, text: e.message, kind: 'meta'});
          }
      }
    }
    return Array.from(groups.values()).sort((a, b) => b.start - a.start);
  }

  jobOpen(j: JobGroup): boolean {
    return this.jobToggled.has(j.id);
  }

  toggleJob(j: JobGroup): void {
    if (this.jobToggled.has(j.id)) {
      this.jobToggled.delete(j.id);
    } else {
      this.jobToggled.add(j.id);
    }
  }

  jobIcon(kind: string): string {
    switch (kind) {
      case 'system-update': return 'system_update_alt';
      case 'app-install': return 'apps';
      case 'app-action': return 'tune';
      default: return 'settings';
    }
  }

  jobDuration(j: JobGroup): string {
    const s = Math.round((j.end - j.start) / 1000);
    if (s < 1) { return ''; }
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
  }

  copied = '';

  copy(text: string): void {
    try { navigator.clipboard?.writeText(text); } catch { /* ignore */ }
    this.copied = text;
    setTimeout(() => { this.copied = ''; this.cd.markForCheck(); }, 1500);
  }

  // ---- audit log (ThingsBoard audit logs of the device entity)
  readonly auditTab = 6;
  auditLogs: AuditLog[] = [];
  auditLoading = false;
  auditError = '';
  auditDeviceId = '';
  auditDays = 30;

  loadAudit(force = false): void {
    const id = this.selectedId;
    if (!id || this.tabIndex !== this.auditTab || (!force && this.auditDeviceId === id)) {
      return;
    }
    this.auditDeviceId = id;
    this.auditLoading = true;
    this.auditError = '';
    const now = Date.now();
    const link = new TimePageLink(100, 0, null, {property: 'createdTime', direction: 'DESC' as any}, now - this.auditDays * 86400000, now);
    this.auditService.getAuditLogsByEntityId({entityType: EntityType.DEVICE, id}, link, {ignoreLoading: true, ignoreErrors: true} as any).pipe(takeUntil(this.destroy$)).subscribe({
      next: page => {
        if (this.selectedId === id) {
          this.auditLogs = page.data || [];
          this.auditPageIndex = Math.min(this.auditPageIndex, Math.max(0, Math.ceil(this.auditLogs.length / this.logPageSize) - 1));
          this.auditLoading = false;
          this.cd.markForCheck();
        }
      },
      error: err => {
        this.auditLogs = [];
        this.auditLoading = false;
        this.auditError = err?.status === 403
          ? 'Audit logs are not available for your user role.'
          : (err?.error?.message || err?.message || 'Audit logs could not be loaded.');
        this.cd.markForCheck();
      }
    });
  }

  auditAction(l: AuditLog): string {
    const s = String(l.actionType || '').toLowerCase().replace(/_/g, ' ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  auditDetails(l: AuditLog): string {
    const data = l.actionData || {};
    const rpc = data.rpcRequest || data;
    let text = '';
    if (rpc?.method) {
      const params = typeof rpc.params === 'string' ? rpc.params : JSON.stringify(rpc.params ?? {});
      text = rpc.method + (params && !['{}', '{"query":{}}', 'null'].includes(params) ? ' ' + params : '');
    } else if (Object.keys(data).length) {
      text = JSON.stringify(data);
    }
    if (l.actionFailureDetails) {
      text = (text ? text + ' – ' : '') + l.actionFailureDetails;
    }
    return text;
  }

  // ---- resources (IoT Gateway machineStats)
  readonly resourcesTab = 4;
  readonly statsRanges = RUGIX_STATS_RANGES;
  statsRange: RugixStatsRange = RUGIX_STATS_RANGES[1];
  statsLatest?: RugixMachineStat;
  statsLoading = false;
  statsError = '';
  statsGateway: Device | null = null;
  cpuSeries: RugixChartSeries[] = [];
  memSeries: RugixChartSeries[] = [];
  rssSeries: RugixChartSeries[] = [];
  diskSeries: RugixChartSeries[] = [];
  private statsTimer?: Subscription;
  private gateways = new Map<string, Device>();

  readonly systemActions: SystemActionInfo[] = [
    {action: 'reboot', icon: 'restart_alt', label: 'Reboot',
      ack: 'I understand that the device is unavailable while it reboots.',
      message: () => ''},
    {action: 'rebootSpare', icon: 'swap_horiz', label: 'Reboot (Spare)', caution: true,
      ack: 'I understand that the device reboots into the spare system and falls back if it is not committed.',
      message: () => ''},
    {action: 'commit', icon: 'task_alt', label: 'Commit',
      ack: 'I understand that the running system becomes the default and the previous system is no longer the fallback.',
      message: () => ''},
    {action: 'factoryReset', icon: 'delete_forever', label: 'Factory reset', warn: true,
      ack: 'I understand that all persistent state is erased and the device reboots. This cannot be undone.',
      message: () => ''}
  ];

  readonly appActions: { action: RugixAppAction; icon: string; label: string; warn?: boolean }[] = [
    {action: 'appStart', icon: 'play_arrow', label: 'Start'},
    {action: 'appStop', icon: 'stop', label: 'Stop'},
    {action: 'appActivate', icon: 'bolt', label: 'Activate'},
    {action: 'appDeactivate', icon: 'power_settings_new', label: 'Deactivate'},
    {action: 'appRollback', icon: 'undo', label: 'Roll back'},
    {action: 'appGc', icon: 'cleaning_services', label: 'Remove old generations'},
    {action: 'appRemove', icon: 'delete', label: 'Remove', warn: true}
  ];

  readonly revpiIcon = REVPI_ICON;
  readonly capabilityLabel = capabilityLabel;
  componentFilter = '';
  readonly formatBytes = formatBytes;
  readonly appStatusLabel = appStatusLabel;
  readonly appStatusMessage = appStatusMessage;
  readonly jt = jobLabel;

  constructor(private dialog: MatDialog,
              private rpc: RugixRpcService,
              private auditService: AuditLogService,
              private cd: ChangeDetectorRef,
              private host: ElementRef<HTMLElement>,
              private ngZone: NgZone) {
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedId && !this.dialog.openDialogs.length) {
      this.closeDetails();
      this.cd.markForCheck();
    }
  }

  ngOnInit(): void {
    this.ctx.$scope.rugixAgentsComponent = this;
    // polling must not trigger a change-detection run of the whole ThingsBoard app every 400 ms
    this.ngZone.runOutsideAngular(() => {
      this.arrowTimer = setInterval(() => {
        this.syncDetailsLayout();
        const bar = this.host.nativeElement.querySelector('.tabbar') as HTMLElement;
        if (bar) {
          this.updateTabArrows(bar);
        } else if (this.tabCanLeft || this.tabCanRight) {
          this.ngZone.run(() => { this.tabCanLeft = this.tabCanRight = false; this.cd.markForCheck(); });
        }
      }, 400);
    });
    this.settings = mergeRugixSettings(this.ctx.settings);
    this.pageSize = this.settings.defaultPageSize;
    this.view = RugixAgentsComponent.lastView.get(this.widgetKey) || (this.settings.defaultView === 'devices' ? 'devices' : 'overview');
    this.syncFleet();
    this.onDataUpdated();
  }

  ngOnDestroy(): void {
    clearInterval(this.arrowTimer);
    clearTimeout(this.jobsReloadTimer);
    this.fleetTimer?.unsubscribe();
    this.destroy$.next();
    this.destroy$.complete();
    this.restoreClip();
    this.statsTimer?.unsubscribe();
    delete this.ctx.$scope.rugixAgentsComponent;
  }

  // ------------------------------------------------------------------ data

  onDataUpdated(): void {
    const byId = new Map<string, RugixDevice>();
    const slotRaw = new Map<string, { [name: string]: any }>();
    for (const item of (this.ctx.data || [])) {
      const ds = item.datasource;
      const id: string = ds?.entityId;
      if (!id) {
        continue;
      }
      let device = byId.get(id);
      if (!device) {
        device = newDevice(id, ds.entityName, ds.entityLabel);
        byId.set(id, device);
        slotRaw.set(id, {});
      }
      const last = item.data?.length ? item.data[item.data.length - 1] : null;
      if (last) {
        if (item.dataKey.name === this.settings.keys.active && last[0]) {
          device.stateSince = last[0];
          if (!device.lastSeen) {
            device.lastSeen = last[0];
          }
        }
        applyValue(device, item.dataKey.name, last[1], this.settings.keys, slotRaw.get(id));
        if (item.dataKey.name === this.settings.keys.jobEvent && device.lastJobEvent && last[0]) {
          device.lastJobEvent.ts = last[0];
        }
      }
    }
    this.devices = Array.from(byId.values()).map(d => {
      d.slots = parseSlots(slotRaw.get(d.id));
      d.apps = mergeApps(d.apps, d.componentList);
      d.commitPending = !!d.activeGroup && !!d.defaultGroup && d.activeGroup !== d.defaultGroup;
      this.trackJob(d);
      return d;
    }).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
    this.computeOverview();
    const sel = this.selected;
    if (sel && this.tabIndex === this.jobsTab && (sel.lastJobEvent?.ts || 0) !== this.jobsLastTs) {
      this.scheduleJobsReload();
    }
    if (this.selectedId && !byId.has(this.selectedId)) {
      this.closeDetails();
    }
    this.pageIndex = Math.min(this.pageIndex, Math.max(0, Math.ceil(this.filtered.length / this.pageSize) - 1));
    [...this.checked].filter(id => !byId.has(id)).forEach(id => this.checked.delete(id));
    this.cd.markForCheck();
    this.ctx.detectChanges();
  }

  statusFilter: 'all' | 'online' | 'offline' = 'all';
  pendingOnly = false;
  healthFilter: '' | 'healthy' | 'warning' | 'error' | 'offline' = '';

  get filtersActive(): boolean {
    return this.statusFilter !== 'all' || this.pendingOnly || !!this.healthFilter;
  }

  setStatusFilter(v: 'all' | 'online' | 'offline'): void {
    this.statusFilter = v;
    this.pageIndex = 0;
  }

  clearFilters(): void {
    this.statusFilter = 'all';
    this.pendingOnly = false;
    this.healthFilter = '';
    this.pageIndex = 0;
  }

  // ---- access control (UI level)
  allowed(kind: 'install' | 'power' | 'factoryReset'): boolean {
    const authority = this.ctx.currentUser?.authority;
    return (this.settings.access[kind] || []).includes(authority);
  }

  kindOf(a: SystemActionInfo): 'power' | 'factoryReset' {
    return a.action === 'factoryReset' ? 'factoryReset' : 'power';
  }

  /** Disabled when offline, not allowed for the user's role, or switched off in the device's Rugix Ctrl daemon. */
  blocked(d: RugixDevice, kind: 'install' | 'power' | 'factoryReset', feature?: RugixDaemonFeature): boolean {
    return !d.active || !this.allowed(kind) || (!!feature && !this.featureOn(d, feature));
  }

  /** Unknown (attribute not provided) counts as enabled. */
  featureOn(d: RugixDevice, feature: RugixDaemonFeature): boolean {
    return d.daemon?.[feature] !== false;
  }

  featureOf(a: SystemActionInfo): RugixDaemonFeature {
    switch (a.action) {
      case 'factoryReset': return 'factory_reset';
      case 'commit': return 'system_commit';
      default: return 'system_reboot';
    }
  }

  featureLabel(d: RugixDevice, feature: RugixDaemonFeature): string {
    const v = d.daemon?.[feature];
    return v === undefined ? '—' : (v ? 'enabled' : 'disabled');
  }

  get restrictionNote(): string {
    const missing = (['install', 'power', 'factoryReset'] as const).filter(k => !this.allowed(k));
    if (!missing.length) {
      return '';
    }
    const names = {install: 'upgrade firmware / install apps', power: 'reboot/commit', factoryReset: 'factory reset'};
    return 'Your user role is not allowed to ' + missing.map(k => names[k]).join(', ') + '.';
  }

  /** `dd.MM.yyyy HH:mm Uhr` (24 h); accepts ms epoch or an ISO string. */
  fmt(ts: number | string | undefined, seconds = false): string {
    const n = typeof ts === 'string' ? Date.parse(ts) : ts;
    return n && !isNaN(n) ? formatDateTime(n, seconds) : '';
  }

  ago(ts?: number): string {
    if (!ts) {
      return '';
    }
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) { return 'just now'; }
    if (s < 5400) { return Math.round(s / 60) + ' min ago'; }
    if (s < 129600) { return Math.round(s / 3600) + ' h ago'; }
    return Math.round(s / 86400) + ' d ago';
  }

  sortKey = 'name';
  sortDir: 'asc' | 'desc' = 'asc';

  sortBy(key: string): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
    this.pageIndex = 0;
  }

  private sortValue(d: RugixDevice, key: string): string {
    switch (key) {
      case 'status': return d.active ? '1' : '0';
      case 'os': return d.hardware.osVersion || '';
      case 'group': return d.activeGroup || '';
      case 'flow': return d.bootFlow || '';
      case 'state': return d.stateStatus || '';
      case 'api': return d.apiVersion || '';
      case 'job': return d.job?.status || '';
      default: return d.label || d.name;
    }
  }

  get filtered(): RugixDevice[] {
    const q = this.search.trim().toLowerCase();
    const base = this.devices.filter(d =>
      (this.statusFilter === 'all' || (this.statusFilter === 'online') === d.active)
      && (!this.pendingOnly || d.commitPending)
      && (!this.healthFilter || d.health === this.healthFilter));
    const list = q ? base.filter(d =>
      [d.name, d.label, d.hardware.osVersion, d.hardware.model, d.hardware.serial, d.bootFlow, d.activeGroup, d.defaultGroup,
        d.stateStatus, d.apiVersion, d.job?.status, d.job?.title, d.active ? 'online' : 'offline']
        .some(v => (v || '').toLowerCase().includes(q))) : base;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) =>
      dir * this.sortValue(a, this.sortKey).localeCompare(this.sortValue(b, this.sortKey), undefined, {numeric: true, sensitivity: 'base'})
      || (a.label || a.name).localeCompare(b.label || b.name));
  }

  get page(): RugixDevice[] {
    return this.filtered.slice(this.pageIndex * this.pageSize, (this.pageIndex + 1) * this.pageSize);
  }

  get selected(): RugixDevice | undefined {
    return this.devices.find(d => d.id === this.selectedId);
  }

  get tableActions(): SystemActionInfo[] {
    return this.systemActions.filter(a => a.action !== 'factoryReset');
  }

  get checkedOnline(): RugixDevice[] {
    return this.checkedDevices.filter(d => d.active);
  }

  get checkedDevices(): RugixDevice[] {
    return this.devices.filter(d => this.checked.has(d.id));
  }

  get allChecked(): boolean {
    return this.page.length > 0 && this.page.every(d => this.checked.has(d.id));
  }

  toggleAll(): void {
    const all = this.allChecked;
    this.page.forEach(d => all ? this.checked.delete(d.id) : this.checked.add(d.id));
  }

  toggle(d: RugixDevice): void {
    if (this.checked.has(d.id)) {
      this.checked.delete(d.id);
    } else {
      this.checked.add(d.id);
    }
  }

  select(d: RugixDevice): void {
    this.selectedId = this.selectedId === d.id ? null : d.id;
    this.resetDeviceState();
    this.loadCreated(this.selectedId);
    this.tabIndex = 0;
    this.auditDeviceId = '';
    this.jobsDeviceId = '';
    this.jobPageIndex = 0;
    this.auditPageIndex = 0;
    this.loadAudit();
    this.syncStats();
    setTimeout(() => this.syncDetailsLayout());
  }

  /** Data of the previously opened device must not show up under the next one while it loads. */
  private resetDeviceState(): void {
    this.jobGroups = [];
    this.jobEventCount = 0;
    this.jobsTruncated = false;
    this.auditLogs = [];
    this.auditError = '';
    this.statsLatest = undefined;
    this.statsError = '';
    this.statsGateway = null;
    this.cpuSeries = [];
    this.memSeries = [];
    this.rssSeries = [];
    this.diskSeries = [];
  }

  closeDetails(): void {
    this.selectedId = null;
    this.resetDeviceState();
    this.syncStats();
    setTimeout(() => this.syncDetailsLayout());
  }

  private clipSaved: { el: HTMLElement; overflow: string; zIndex: string }[] = [];

  /**
   * The dashboard grid leaves a gap around every widget. While the details panel is open it is stretched to the edges
   * of the dashboard area (top, right, bottom) by letting it overflow the widget and its clipping ancestors.
   */
  private syncDetailsLayout(): void {
    const root = this.host.nativeElement;
    const panel = root.querySelector('.rugix-details') as HTMLElement;
    const backdrop = root.querySelector('.rugix-backdrop') as HTMLElement;
    const grid = root.closest('gridster') as HTMLElement;
    if (!panel || !grid || !this.selectedId) {
      this.restoreClip();
      return;
    }
    if (!this.clipSaved.length) {
      let el: HTMLElement | null = root.querySelector('.rugix') as HTMLElement;
      while (el && el !== grid) {
        this.clipSaved.push({el, overflow: el.style.overflow, zIndex: el.style.zIndex});
        el.style.overflow = 'visible';
        if (el.tagName.toLowerCase() === 'gridster-item') {
          el.style.zIndex = '1000';
        }
        el = el.parentElement;
      }
    }
    const w = (root.querySelector('.rugix') as HTMLElement).getBoundingClientRect();
    const g = grid.getBoundingClientRect();
    const top = g.top - w.top;
    const bottom = w.bottom - g.bottom;
    const right = w.right - g.right;
    const left = g.left - w.left;
    panel.style.top = top + 'px';
    panel.style.bottom = bottom + 'px';
    panel.style.right = right + 'px';
    panel.style.width = Math.min(780, g.width) + 'px';
    if (backdrop) {
      backdrop.style.inset = `${top}px ${right}px ${bottom}px ${left}px`;
    }
  }

  private restoreClip(): void {
    for (const s of this.clipSaved) {
      s.el.style.overflow = s.overflow;
      s.el.style.zIndex = s.zIndex;
    }
    this.clipSaved = [];
  }

  tabLabels(d: RugixDevice): { i: number; label: string }[] {
    return ['Overview', `Slots (${d.slots.length})`, `Apps (${d.apps.length})`, `Components (${d.componentList.length})`,
      'Resources', 'Job log', 'Audit log'].map((label, i) => ({i, label}));
  }

  /** Select a tab and scroll it to the middle of the tab bar (clamped at both ends, so first/last stay put). */
  private arrowTimer: any;
  tabCanLeft = false;
  tabCanRight = false;

  updateTabArrows(bar: HTMLElement): void {
    const left = bar.scrollLeft > 2;
    const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2;
    if (left !== this.tabCanLeft || right !== this.tabCanRight) {
      this.ngZone.run(() => {
        this.tabCanLeft = left;
        this.tabCanRight = right;
        this.cd.markForCheck();
      });
    }
  }

  scrollTabs(dir: number, bar: HTMLElement): void {
    bar.scrollBy({left: dir * Math.max(120, bar.clientWidth * 0.6), behavior: 'smooth'});
  }

  selectTab(i: number, ev: Event): void {
    const el = ev.currentTarget as HTMLElement;
    const bar = el.parentElement;
    bar.scrollTo({left: el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2, behavior: 'smooth'});
    this.onTabChange(i);
  }

  onTabChange(index: number): void {
    this.tabIndex = index;
    this.loadAudit();
    this.loadJobs();
    this.syncStats();
  }

  setStatsRange(r: RugixStatsRange): void {
    this.statsRange = r;
    this.loadStats(true);
  }

  /** Load the gateway statistics while the Resources tab of a device is open and refresh them every 30s. */
  private syncStats(): void {
    this.statsTimer?.unsubscribe();
    this.statsTimer = undefined;
    if (this.selectedId && this.tabIndex === this.resourcesTab) {
      this.statsTimer = timer(0, 30000).subscribe(i => this.loadStats(i === 0));
    }
  }

  private loadStats(spinner: boolean): void {
    const device = this.selected;
    if (!device) {
      return;
    }
    if (spinner) {
      this.statsLoading = true;
      this.statsError = '';
    }
    const gateway$ = this.gateways.has(device.id)
      ? new Observable<Device>(s => { s.next(this.gateways.get(device.id)); s.complete(); })
      : this.rpc.resolveGateway(this.settings, device.id);
    const end = Date.now();
    const range = this.statsRange;
    gateway$.pipe(takeUntil(this.destroy$),
      mergeMap(gw => {
        this.gateways.set(device.id, gw);
        this.statsGateway = gw;
        return this.rpc.loadMachineStats(this.settings, gw.id.id, end - this.statsRange.ms, end);
      })
    ).subscribe({
      next: stats => {
        if (this.selectedId !== device.id || this.statsRange !== range) {
          return;
        }
        this.statsLoading = false;
        this.statsError = '';
        this.statsLatest = stats[stats.length - 1];
        this.buildSeries(downsample(stats, 300));
        this.cd.markForCheck();
      },
      error: err => {
        if (this.selectedId === device.id) {
          this.statsLoading = false;
          this.statsError = err?.message || 'Gateway statistics could not be loaded.';
          this.cd.markForCheck();
        }
      }
    });
  }

  private buildSeries(stats: RugixMachineStat[]): void {
    const pick = (f: (s: RugixMachineStat) => number | undefined): [number, number][] =>
      stats.filter(s => f(s) !== undefined).map(s => [s.ts, f(s)] as [number, number]);
    this.cpuSeries = [
      {name: 'System CPU', color: '#2196f3', data: pick(s => s.cpu)},
      {name: 'Gateway CPU', color: '#ff9800', data: pick(s => s.gwCpu)}
    ];
    this.memSeries = [
      {name: 'Memory used', color: '#9c27b0', data: pick(s => s.memUsed)},
      {name: 'Gateway memory', color: '#4caf50', data: pick(s => s.gwMemory)}
    ];
    this.rssSeries = [{name: 'Gateway RSS', color: '#4caf50', data: pick(s => s.gwRssMiB)}];
    this.diskSeries = [{name: 'Disk used', color: '#f44336', data: pick(s => s.diskUsage)}];
  }

  onPage(e: PageEvent): void {
    this.pageIndex = e.pageIndex;
    this.pageSize = e.pageSize;
  }

  toggleSearch(): void {
    this.searchOpen = !this.searchOpen;
    if (!this.searchOpen) {
      this.search = '';
      this.onSearch();
    }
  }

  refresh(): void {
    this.ctx.updateAliases();
  }

  clearSelection(): void {
    this.checked.clear();
  }

  onSearch(): void {
    this.pageIndex = 0;
  }

  // ------------------------------------------------------------------ actions

  openInstall(devices: RugixDevice[], mode: 'system' | 'app'): void {
    devices = devices.filter(d => d.active);
    if (!devices.length || !this.allowed('install')) {
      return;
    }
    this.dialog.open<RugixInstallDialogComponent, RugixInstallDialogData, RugixInstallDialogResult>(
      RugixInstallDialogComponent, {
        data: {mode, devices, settings: this.settings},
        autoFocus: false, disableClose: true, maxWidth: '95vw'
      }).afterClosed().subscribe(result => {
      if (result?.failed?.length) {
        this.ctx.showErrorToast(`Could not start on ${result.failed.map(f => f.device.label || f.device.name).join(', ')}: ${result.failed[0].message}`, 'top', 'left');
      }
      if (result?.jobs?.length) {
        this.ctx.showSuccessToast(`Installation started on ${result.jobs.length} device(s).`, 3000, 'top', 'left');
        if (result.jobs.length === 1) {
          this.openJob(result.jobs[0].device, result.jobs[0].handle.jobId, mode === 'system' ? 'Upgrade Firmware' : 'Install App');
        }
      }
    });
  }

  /** Active slot (boot group) before and after a reboot, e.g. A → A for a reboot, A → B for reboot (spare). */
  private bootTransition(info: SystemActionInfo, d: RugixDevice): { from: string; to: string } | undefined {
    if (info.action !== 'reboot' && info.action !== 'rebootSpare') {
      return undefined;
    }
    const from = d.activeGroup;
    if (!from) {
      return undefined;
    }
    const to = info.action === 'reboot' ? from : (d.bootGroups.find(g => g !== from) || '?');
    return {from: from.toUpperCase(), to: to.toUpperCase()};
  }

  runSystemAction(info: SystemActionInfo, device: RugixDevice): void {
    if (this.blocked(device, this.kindOf(info), this.featureOf(info))) {
      return;
    }
    const data: RugixConfirmDialogData = {
      title: info.label,
      message: info.message(device),
      confirmLabel: info.label,
      warn: info.warn,
      caution: info.caution,
      acknowledge: info.ack,
      transition: this.bootTransition(info, device),
      checkbox: info.action === 'factoryReset' ? {label: 'Keep the old state as a backup profile', checked: true} : undefined,
      textWhenChecked: info.action === 'factoryReset' ? {label: 'Backup name (optional)'} : undefined
    };
    this.dialog.open<RugixConfirmDialogComponent, RugixConfirmDialogData, RugixConfirmDialogResult>(
      RugixConfirmDialogComponent, {data, autoFocus: false, maxWidth: '95vw'}).afterClosed().subscribe(result => {
      if (!result) {
        return;
      }
      this.track(device, info.label, this.rpc.systemAction(this.settings, device, info.action,
        {backup: result.checked, backupName: result.text || undefined}));
    });
  }

  runAppAction(device: RugixDevice, app: RugixApp, action: RugixAppAction, label: string, warn?: boolean): void {
    if (this.blocked(device, 'install', 'app_lifecycle')) {
      return;
    }
    const ack: { [a in RugixAppAction]: string } = {
      appStart: `I understand that app "${app.name}" is started on the device.`,
      appStop: `I understand that app "${app.name}" is stopped and its service is interrupted.`,
      appActivate: `I understand that the active generation of app "${app.name}" changes.`,
      appDeactivate: `I understand that app "${app.name}" is deactivated.`,
      appRollback: `I understand that app "${app.name}" is rolled back to its previous generation.`,
      appGc: `I understand that old generations of app "${app.name}" are removed permanently.`,
      appRemove: `I understand that app "${app.name}" is removed from the device.`
    };
    this.dialog.open<RugixConfirmDialogComponent, RugixConfirmDialogData, RugixConfirmDialogResult>(
      RugixConfirmDialogComponent, {
        data: {title: `${label} app`, message: `${label} app "${app.name}" on "${device.label || device.name}"?`,
          confirmLabel: label, warn, acknowledge: ack[action]},
        autoFocus: false, maxWidth: '95vw'
      }).afterClosed().subscribe(r => r && this.track(device, `${label} ${app.name}`,
      this.rpc.appAction(this.settings, device, action, app.name)));
  }

  garbageCollectApps(device: RugixDevice): void {
    if (this.blocked(device, 'install', 'app_lifecycle')) {
      return;
    }
    this.dialog.open<RugixConfirmDialogComponent, RugixConfirmDialogData, RugixConfirmDialogResult>(
      RugixConfirmDialogComponent, {
        data: {title: 'Clean up all apps', message: `Remove unused generations of all apps on "${device.label || device.name}"?`,
          confirmLabel: 'Clean up', warn: true, acknowledge: 'I understand that old app generations are removed permanently.'},
        autoFocus: false, maxWidth: '95vw'
      }).afterClosed().subscribe(r => r && this.track(device, 'App garbage collection',
      this.rpc.appsGarbageCollect(this.settings, device)));
  }

  openJob(device: RugixDevice, jobId: string, title: string, since = Date.now() - 5000): void {
    this.dialog.open<RugixJobDialogComponent, RugixJobDialogData>(RugixJobDialogComponent, {
      data: {device, settings: this.settings, jobId, title, since},
      autoFocus: false, maxWidth: '95vw'
    });
  }

  /** Start the job, subscribe the gateway to the job's event stream and show progress. */
  private track(device: RugixDevice, title: string, start$: Observable<RugixJobHandle>): void {
    this.busy.add(device.id);
    const startedAt = Date.now() - 5000;
    start$.pipe(
      mergeOnStream(this.rpc, this.settings, device)
    ).subscribe({
      next: handle => {
        this.busy.delete(device.id);
        this.openJob(device, handle.jobId, title, startedAt);
        this.cd.markForCheck();
      },
      error: err => {
        this.busy.delete(device.id);
        this.ctx.showErrorToast(`${title} failed: ${err?.error?.message || err?.message || err}`);
        this.cd.markForCheck();
      }
    });
  }

  statusClass(d: RugixDevice): string {
    return d.active ? 'online' : 'offline';
  }

  slotCount(d: RugixDevice): string {
    const active = d.slots.find(s => s.active);
    return active ? active.name : '—';
  }

  /** Human readable text of a component consistency problem (rugix-admin `ComponentProblem`). */
  problemTitle(p: { type: string }): string {
    const t = String(p.type || 'problem').replace(/([a-z])([A-Z])/g, '$1 $2');
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  problemText(p: { type: string; detail: any }): string {
    const d = p.detail || {};
    const sel = (x: any) => x ? `${x.id}${x.version ? ' ' + x.version : ''}${x.value ? ' = ' + x.value : ''}` : '';
    switch (p.type) {
      case 'UnsatisfiedRequirement': return `${d.component?.id} requires ${sel(d.selector)}`;
      case 'Conflict': return `${d.component?.id} conflicts with ${d.provider?.id} (${sel(d.capability || d.selector)})`;
      case 'DuplicateComponent': return `Component ${d.id} is declared more than once`;
      case 'DuplicateClaim': return `Resource ${d.id} is claimed by ${(d.components || []).map((c: any) => c.id).join(', ')}`;
      default: return this.jsonOf(p.detail);
    }
  }

  jsonOf(value: any): string {
    return value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
  }

  filteredComponents(d: RugixDevice): RugixComponent[] {
    const q = this.componentFilter.trim().toLowerCase();
    return q ? d.componentList.filter(c =>
      [c.id, c.version, c.kind, c.app].some(v => (v || '').toLowerCase().includes(q))) : d.componentList;
  }

  /** `true` if nothing in the system provides the required capability. */
  isUnsatisfied(d: RugixDevice, id: string): boolean {
    return !providedIds(d.componentList).has(id);
  }

  kindClass(kind: string): string {
    return 'kind-' + (kind || 'unknown').toLowerCase();
  }

  /** Revolution Pi devices are recognized by their hardware component (or the device name as fallback). */
  isRevPi(d: RugixDevice): boolean {
    return d.componentList.some(c => c.id === 'hardware.revpi') || /revpi|revolution.?pi/i.test(`${d.name} ${d.label}`);
  }

  trackById(_: number, d: RugixDevice): string {
    return d.id;
  }
}

/** Operator: after the action started, ask the gateway to stream the job events (best effort). */
function mergeOnStream(rpc: RugixRpcService, settings: RugixWidgetSettings, device: RugixDevice) {
  return (source: Observable<RugixJobHandle>): Observable<RugixJobHandle> => source.pipe(
    mergeMap(handle => new Observable<RugixJobHandle>(subscriber => {
      rpc.startJobStream(settings, device, handle.jobId).subscribe({
        next: () => undefined,
        error: () => { subscriber.next(handle); subscriber.complete(); },
        complete: () => { subscriber.next(handle); subscriber.complete(); }
      });
    }))
  );
}

///
/// Rugix management extension for ThingsBoard
///

import { ChangeDetectorRef, Component, ElementRef, HostListener, Input, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { WidgetContext } from '@home/models/widget-component.models';
import { Observable, Subscription, timer } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Device } from '@shared/models/device.models';
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
import { appStatusLabel, applyValue, downsample, capabilityLabel, mergeApps, providedIds, formatBytes, newDevice, parseSlots } from '../models/rugix-parse';
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
      message: d => `Reboot the active system of "${d.label || d.name}"?`},
    {action: 'rebootSpare', icon: 'swap_horiz', label: 'Reboot (Spare)', caution: true,
      ack: 'I understand that the device reboots into the spare system and falls back if it is not committed.',
      message: d => `Reboot "${d.label || d.name}" into the spare system? Commit afterwards to make it permanent, otherwise the device falls back.`},
    {action: 'commit', icon: 'task_alt', label: 'Commit',
      ack: 'I understand that the running system becomes the default and the previous system is no longer the fallback.',
      message: d => `Make the currently running system the default on "${d.label || d.name}"? A rollback to the previous system is no longer automatic afterwards.`},
    {action: 'factoryReset', icon: 'delete_forever', label: 'Factory reset', warn: true,
      ack: 'I understand that all persistent state is erased and the device reboots. This cannot be undone.',
      message: d => `Reset ALL persistent state of "${d.label || d.name}" and reboot? This cannot be undone.`}
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

  constructor(private dialog: MatDialog,
              private rpc: RugixRpcService,
              private cd: ChangeDetectorRef,
              private host: ElementRef<HTMLElement>) {
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
    this.arrowTimer = setInterval(() => {
      const bar = this.host.nativeElement.querySelector('.tabbar') as HTMLElement;
      if (bar) { this.updateTabArrows(bar); } else if (this.tabCanLeft || this.tabCanRight) {
        this.tabCanLeft = this.tabCanRight = false; this.cd.markForCheck();
      }
    }, 400);
    this.settings = mergeRugixSettings(this.ctx.settings);
    this.pageSize = this.settings.defaultPageSize;
    this.onDataUpdated();
  }

  ngOnDestroy(): void {
    clearInterval(this.arrowTimer);
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
        applyValue(device, item.dataKey.name, last[1], this.settings.keys, slotRaw.get(id));
      }
    }
    this.devices = Array.from(byId.values()).map(d => {
      d.slots = parseSlots(slotRaw.get(d.id));
      d.apps = mergeApps(d.apps, d.componentList);
      d.commitPending = !!d.activeGroup && !!d.defaultGroup && d.activeGroup !== d.defaultGroup;
      return d;
    }).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
    if (this.selectedId && !byId.has(this.selectedId)) {
      this.selectedId = null;
    }
    [...this.checked].filter(id => !byId.has(id)).forEach(id => this.checked.delete(id));
    this.cd.markForCheck();
    this.ctx.detectChanges();
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
      case 'job': return d.lastJobEvent?.status || '';
      default: return d.label || d.name;
    }
  }

  get filtered(): RugixDevice[] {
    const q = this.search.trim().toLowerCase();
    const list = q ? this.devices.filter(d =>
      [d.name, d.label, d.hardware.osVersion, d.hardware.model, d.hardware.serial, d.bootFlow, d.activeGroup,
        d.stateStatus, d.apiVersion, d.lastJobEvent?.status, d.active ? 'online' : 'offline']
        .some(v => (v || '').toLowerCase().includes(q))) : this.devices;
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
    this.checked.has(d.id) ? this.checked.delete(d.id) : this.checked.add(d.id);
  }

  select(d: RugixDevice): void {
    this.selectedId = this.selectedId === d.id ? null : d.id;
    this.syncStats();
  }

  closeDetails(): void {
    this.selectedId = null;
    this.syncStats();
  }

  tabLabels(d: RugixDevice): { i: number; label: string }[] {
    return ['Overview', `Slots (${d.slots.length})`, `Apps (${d.apps.length})`, `Components (${d.componentList.length})`,
      'Resources', 'Last job'].map((label, i) => ({i, label}));
  }

  /** Select a tab and scroll it to the middle of the tab bar (clamped at both ends, so first/last stay put). */
  private arrowTimer: any;
  tabCanLeft = false;
  tabCanRight = false;

  updateTabArrows(bar: HTMLElement): void {
    const left = bar.scrollLeft > 2;
    const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2;
    if (left !== this.tabCanLeft || right !== this.tabCanRight) {
      this.tabCanLeft = left;
      this.tabCanRight = right;
      this.cd.markForCheck();
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
    gateway$.pipe(
      mergeMap(gw => {
        this.gateways.set(device.id, gw);
        this.statsGateway = gw;
        return this.rpc.loadMachineStats(this.settings, gw.id.id, end - this.statsRange.ms, end);
      })
    ).subscribe({
      next: stats => {
        if (this.selectedId !== device.id) {
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
    if (!devices.length) {
      return;
    }
    this.dialog.open<RugixInstallDialogComponent, RugixInstallDialogData, RugixInstallDialogResult>(
      RugixInstallDialogComponent, {
        data: {mode, devices, settings: this.settings},
        autoFocus: false, disableClose: true, maxWidth: '95vw'
      }).afterClosed().subscribe(result => {
      if (result?.jobs?.length) {
        this.ctx.showSuccessToast(`Installation started on ${result.jobs.length} device(s).`, 3000, 'top', 'left');
        if (result.jobs.length === 1) {
          this.openJob(result.jobs[0].device, result.jobs[0].handle.jobId, 'Install');
        }
      }
    });
  }

  runSystemAction(info: SystemActionInfo, device: RugixDevice): void {
    const data: RugixConfirmDialogData = {
      title: info.label,
      message: info.message(device),
      confirmLabel: info.label,
      warn: info.warn,
      caution: info.caution,
      acknowledge: info.ack,
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

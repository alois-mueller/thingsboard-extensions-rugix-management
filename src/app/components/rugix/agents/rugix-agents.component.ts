///
/// Rugix management extension for ThingsBoard
///

import { ChangeDetectorRef, Component, Input, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { WidgetContext } from '@home/models/widget-component.models';
import { Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import {
  mergeRugixSettings,
  RugixApp,
  RugixAppAction,
  RugixComponent,
  RugixDevice,
  RugixSystemAction,
  RugixWidgetSettings
} from '../models/rugix.models';
import { appStatusLabel, applyValue, capabilityLabel, providedIds, formatBytes, newDevice, parseSlots } from '../models/rugix-parse';
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

  readonly systemActions: SystemActionInfo[] = [
    {action: 'reboot', icon: 'restart_alt', label: 'Reboot',
      message: d => `Reboot the active system of "${d.label || d.name}"?`},
    {action: 'rebootSpare', icon: 'swap_horiz', label: 'Reboot into spare',
      message: d => `Reboot "${d.label || d.name}" into the spare system? Commit afterwards to make it permanent, otherwise the device falls back.`},
    {action: 'commit', icon: 'task_alt', label: 'Commit running system',
      message: d => `Make the currently running system the default on "${d.label || d.name}"? A rollback to the previous system is no longer automatic afterwards.`},
    {action: 'factoryReset', icon: 'delete_forever', label: 'Factory reset', warn: true,
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

  readonly capabilityLabel = capabilityLabel;
  componentFilter = '';
  readonly formatBytes = formatBytes;
  readonly appStatusLabel = appStatusLabel;

  constructor(private dialog: MatDialog,
              private rpc: RugixRpcService,
              private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {
    this.ctx.$scope.rugixAgentsComponent = this;
    this.settings = mergeRugixSettings(this.ctx.settings);
    this.pageSize = this.settings.defaultPageSize;
    this.onDataUpdated();
  }

  ngOnDestroy(): void {
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

  get filtered(): RugixDevice[] {
    const q = this.search.trim().toLowerCase();
    return q ? this.devices.filter(d =>
      [d.name, d.label, d.bootFlow, d.activeGroup, d.apiVersion].some(v => (v || '').toLowerCase().includes(q))) : this.devices;
  }

  get page(): RugixDevice[] {
    return this.filtered.slice(this.pageIndex * this.pageSize, (this.pageIndex + 1) * this.pageSize);
  }

  get selected(): RugixDevice | undefined {
    return this.devices.find(d => d.id === this.selectedId);
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
    const run = () => this.track(device, `${label} ${app.name}`, this.rpc.appAction(this.settings, device, action, app.name));
    if (!warn && action !== 'appRollback') {
      run();
      return;
    }
    this.dialog.open<RugixConfirmDialogComponent, RugixConfirmDialogData, RugixConfirmDialogResult>(
      RugixConfirmDialogComponent, {
        data: {title: label, message: `${label} app "${app.name}" on "${device.label || device.name}"?`, confirmLabel: label, warn},
        autoFocus: false, maxWidth: '95vw'
      }).afterClosed().subscribe(r => r && run());
  }

  garbageCollectApps(device: RugixDevice): void {
    this.track(device, 'App garbage collection', this.rpc.appsGarbageCollect(this.settings, device));
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

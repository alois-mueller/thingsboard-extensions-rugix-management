///
/// Rugix management extension for ThingsBoard
///

import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OtaPackageService } from '@core/public-api';
import { OtaPackageInfo, OtaUpdateType, PageLink } from '@shared/public-api';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { RugixDevice, RugixInstallOptions, RugixWidgetSettings, RUGIX_REBOOT_MODES } from '../models/rugix.models';
import { RugixJobHandle, RugixRpcService } from '../services/rugix-rpc.service';

export interface RugixInstallDialogData {
  mode: 'system' | 'app';
  devices: RugixDevice[];
  settings: RugixWidgetSettings;
}

export interface RugixInstallDialogResult {
  jobs: { device: RugixDevice; handle: RugixJobHandle }[];
  /** Devices on which the installation could not be started. */
  failed?: { device: RugixDevice; message: string }[];
}

/** Install a system update (OTA firmware package) or an app bundle on one or many Rugix devices. */
@Component({
  selector: 'tb-rugix-install-dialog',
  templateUrl: './rugix-install-dialog.component.html',
  styleUrls: ['./rugix-dialogs.scss'],
  standalone: false
})
export class RugixInstallDialogComponent implements OnInit {

  readonly rebootModes = RUGIX_REBOOT_MODES;

  packages: OtaPackageInfo[] = [];
  loadingPackages = true;
  selectedPackage: OtaPackageInfo | null = null;
  customUrl = '';
  useCustomUrl = false;

  reboot: RugixInstallOptions['reboot'] = 'yes';
  advancedOpen = false;
  acknowledged = false;
  bootGroup = '';
  bundleHash = '';
  keepOverlay = false;
  skipCompatibilityCheck = false;
  // transfer / verification options (rugix-admin SystemInstallOptions / AppInstallOptions)
  rootCert = '';
  disableRange = false;
  maxRetries: number | null = null;
  initialBackoff: number | null = null;
  maxBackoff: number | null = null;
  // only honoured by daemons that run with security bypasses enabled (development)
  insecureSkipVerification = false;
  insecureAllowMissingBlockIndex = false;

  installing = false;
  error = '';

  constructor(@Inject(MAT_DIALOG_DATA) public data: RugixInstallDialogData,
              private dialogRef: MatDialogRef<RugixInstallDialogComponent, RugixInstallDialogResult>,
              private otaService: OtaPackageService,
              private rpc: RugixRpcService) {
  }

  get isSystem(): boolean {
    return this.data.mode === 'system';
  }

  /** The bypass options only work on daemons started with `dangerously_insecure`. */
  get anyInsecure(): boolean {
    return this.data.devices.some(d => d.insecure === true);
  }

  get bootGroups(): string[] {
    const groups = new Set<string>();
    this.data.devices.forEach(d => d.bootGroups.forEach(g => groups.add(g)));
    return Array.from(groups);
  }

  get installLabel(): string {
    if (!this.isSystem) {
      return 'Install';
    }
    return {yes: 'Install & reboot', set: 'Install & select', deferred: 'Install (deferred)', no: 'Install only'}[this.reboot] || 'Install';
  }

  get ackText(): string {
    const n = this.data.devices.length;
    const who = n === 1 ? 'the device' : `${n} devices`;
    if (!this.isSystem) {
      return `I understand that the app bundle is installed on ${who}.`;
    }
    switch (this.reboot) {
      case 'yes': return `I understand that the update is installed on ${who} and ${n === 1 ? 'it reboots' : 'they reboot'} immediately.`;
      case 'set': return `I understand that the update is installed on ${who} and the new system is selected for the next boot.`;
      case 'deferred': return `I understand that the update is installed on ${who} and applied at a later boot.`;
      default: return `I understand that the update is installed on ${who} without changing the boot selection.`;
    }
  }

  get targetsSummary(): string {
    const names = this.data.devices.map(d => d.label || d.name);
    return names.length <= 3 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
  }

  get targetsTooltip(): string {
    return this.data.devices.length > 3 ? this.data.devices.map(d => d.label || d.name).join('\n') : '';
  }

  get url(): string {
    return this.useCustomUrl ? this.customUrl.trim() : (this.selectedPackage?.url || '');
  }

  get canInstall(): boolean {
    return !this.installing && !!this.url && this.acknowledged;
  }

  ngOnInit(): void {
    const type = this.isSystem ? OtaUpdateType.FIRMWARE : OtaUpdateType.SOFTWARE;
    this.otaService.getOtaPackages(new PageLink(100, 0, null, {property: 'createdTime', direction: 'DESC' as any}),
      {ignoreLoading: true}).subscribe({
      next: page => {
        this.packages = (page.data || []).filter(p => p.type === type && !!p.url);
        this.selectedPackage = this.packages[0] || null;
        this.useCustomUrl = !this.packages.length;
        this.loadingPackages = false;
      },
      error: () => {
        this.loadingPackages = false;
        this.useCustomUrl = true;
      }
    });
  }

  install(): void {
    if (!this.canInstall) {
      return;
    }
    this.installing = true;
    this.error = '';
    const url = this.url;
    const num = (v: number | null) => (v === null || v === undefined || isNaN(Number(v)) ? undefined : Number(v));
    const insecure = this.anyInsecure;
    const base: RugixInstallOptions = {
      bundle_hash: this.bundleHash.trim() || undefined,
      root_cert: this.rootCert.trim() || undefined,
      skip_compatibility_check: this.skipCompatibilityCheck || undefined,
      http_max_retries: num(this.maxRetries),
      http_retry_initial_backoff: num(this.initialBackoff),
      http_retry_max_backoff: num(this.maxBackoff),
      insecure_skip_bundle_verification: insecure && this.insecureSkipVerification || undefined,
      insecure_allow_missing_block_index: insecure && this.insecureAllowMissingBlockIndex || undefined
    };
    const systemOptions: RugixInstallOptions = {
      ...base,
      disable_range_queries: this.disableRange || undefined,
      reboot: this.reboot,
      boot_group: this.bootGroup || undefined,
      keep_overlay: this.keepOverlay || undefined
    };
    const jobs$ = this.data.devices.map(device => {
      const start$: Observable<RugixJobHandle> = this.isSystem
        ? this.rpc.installUpdate(this.data.settings, device, url, systemOptions)
        : this.rpc.installApp(this.data.settings, device, url, base);
      return start$.pipe(
        mergeMap(handle => this.rpc.startJobStream(this.data.settings, device, handle.jobId).pipe(
          // starting the live stream is best-effort, the install itself is already running
          catchError(() => of(null)),
          mergeMap(() => [{device, handle}])
        )),
        // one failing device must not hide the installs that did start on the others
        catchError(err => of({device, error: err?.error?.message || err?.message || 'Installation could not be started.'}))
      );
    });
    forkJoin(jobs$).subscribe(results => {
      const jobs = results.filter((r: any) => !r.error) as { device: RugixDevice; handle: RugixJobHandle }[];
      const failed = results.filter((r: any) => !!r.error).map((r: any) => ({device: r.device as RugixDevice, message: r.error as string}));
      if (!jobs.length) {
        this.installing = false;
        this.error = failed[0]?.message || 'Installation could not be started.';
        return;
      }
      this.dialogRef.close({jobs, failed});
    });
  }

  cancel(): void {
    if (!this.installing) {
      this.dialogRef.close();
    }
  }
}

///
/// Rugix management extension for ThingsBoard
///

import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { OtaPackageService } from '@core/public-api';
import { OtaPackageInfo, OtaUpdateType, PageLink } from '@shared/public-api';
import { forkJoin, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { RugixDevice, RugixInstallOptions, RugixWidgetSettings, RUGIX_REBOOT_MODES } from '../models/rugix.models';
import { RugixJobHandle, RugixRpcService } from '../services/rugix-rpc.service';

export interface RugixInstallDialogData {
  mode: 'system' | 'app';
  devices: RugixDevice[];
  settings: RugixWidgetSettings;
}

export interface RugixInstallDialogResult {
  jobs: { device: RugixDevice; handle: RugixJobHandle }[];
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

  reboot: RugixInstallOptions['reboot'] = 'set';
  bootGroup = '';
  bundleHash = '';
  keepOverlay = false;
  skipCompatibilityCheck = false;

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

  get bootGroups(): string[] {
    const groups = new Set<string>();
    this.data.devices.forEach(d => d.bootGroups.forEach(g => groups.add(g)));
    return Array.from(groups);
  }

  get url(): string {
    return this.useCustomUrl ? this.customUrl.trim() : (this.selectedPackage?.url || '');
  }

  get canInstall(): boolean {
    return !this.installing && !!this.url;
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
    const base: RugixInstallOptions = {
      bundle_hash: this.bundleHash.trim() || undefined,
      skip_compatibility_check: this.skipCompatibilityCheck || undefined
    };
    const systemOptions: RugixInstallOptions = {
      ...base,
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
          mergeMap(() => [{device, handle}])
        ))
      );
    });
    forkJoin(jobs$).subscribe({
      next: jobs => this.dialogRef.close({jobs}),
      error: err => {
        this.installing = false;
        this.error = err?.error?.message || err?.message || 'Installation could not be started.';
      }
    });
  }

  cancel(): void {
    if (!this.installing) {
      this.dialogRef.close();
    }
  }
}

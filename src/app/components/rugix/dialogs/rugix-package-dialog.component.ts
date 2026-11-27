///
/// Rugix management extension for ThingsBoard
///

import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { catchError, mergeMap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { OtaPackageInfo, OtaUpdateType } from '@shared/public-api';
import { joinDescription, splitDescription, urlIssue } from '../models/rugix-parse';
import { RugixRpcService } from '../services/rugix-rpc.service';

export interface RugixPackageDialogData {
  type: OtaUpdateType.FIRMWARE | OtaUpdateType.SOFTWARE;
  /** Existing package to edit; omitted when adding. */
  pkg?: OtaPackageInfo;
  /** Reject plain http URLs. */
  requireHttps?: boolean;
}

/** Add an OTA package that points to an external URL, or edit title / tag / description of an existing one. */
@Component({
  selector: 'tb-rugix-package-dialog',
  templateUrl: './rugix-package-dialog.component.html',
  styleUrls: ['./rugix-dialogs.scss'],
  standalone: false
})
export class RugixPackageDialogComponent implements OnInit {
  title = '';
  version = '';
  tag = '';
  url = '';
  description = '';
  // metadata kept in the description (see `splitDescription`)
  signed: '' | 'yes' | 'no' = '';
  size: number | null = null;
  security = false;
  advisory = '';
  notes = '';
  profileId = '';
  profiles: { id: string; name: string }[] = [];
  saving = false;
  error = '';

  constructor(@Inject(MAT_DIALOG_DATA) public data: RugixPackageDialogData,
              private rpc: RugixRpcService,
              private dialogRef: MatDialogRef<RugixPackageDialogComponent, boolean>) {
    const p = data.pkg;
    if (p) {
      this.title = p.title || '';
      this.version = p.version || '';
      this.tag = p.tag || '';
      this.url = p.url || '';
      const d = splitDescription(p.additionalInfo?.description);
      this.description = d.text;
      this.signed = d.meta.signed === undefined ? '' : (d.meta.signed ? 'yes' : 'no');
      this.size = d.meta.size ?? null;
      this.security = !!d.meta.security;
      this.advisory = d.meta.advisory || '';
      this.notes = d.meta.notes || '';
    }
  }

  get isEdit(): boolean {
    return !!this.data.pkg;
  }

  get isFirmware(): boolean {
    return this.data.type === OtaUpdateType.FIRMWARE;
  }

  get urlProblem(): { error?: string; warn?: string } {
    return urlIssue(this.url, !!this.data.requireHttps);
  }

  /** Description text plus the `rugix-meta` line. */
  private get fullDescription(): string {
    const num = this.size === null || this.size === undefined || (this.size as any) === '' ? undefined : Number(this.size);
    return joinDescription(this.description, {
      signed: this.signed ? this.signed === 'yes' : undefined, size: num, security: this.security,
      advisory: this.advisory, notes: this.notes
    });
  }

  get linkIssue(): string {
    for (const v of [this.security ? this.advisory : '', this.notes]) {
      if (v.trim() && (!/^https?:\/\//i.test(v.trim()) || urlIssue(v.trim()).error)) {
        return 'Links must be valid http(s) URLs.';
      }
    }
    return '';
  }

  get sizeIssue(): string {
    return this.size !== null && (this.size as any) !== '' && !(Number(this.size) >= 0) ? 'Size must be a number of bytes.' : '';
  }

  get valid(): boolean {
    if (this.linkIssue || this.sizeIssue) {
      return false;
    }
    const url = this.url.trim();
    return !!this.title.trim() && !!this.version.trim() && !!url && !urlIssue(url, !!this.data.requireHttps).error && (this.isEdit || !!this.profileId);
  }

  /** ThingsBoard only allows changing the description of an existing package; everything else needs a replacement. */
  get replaces(): boolean {
    const p = this.data.pkg;
    return !!p && (this.title.trim() !== (p.title || '') || this.version.trim() !== (p.version || '')
      || (this.tag.trim() || '') !== (p.tag || '') || this.url.trim() !== (p.url || ''));
  }

  ngOnInit(): void {
    if (!this.isEdit) {
      this.rpc.listProfiles().subscribe(list => {
        this.profiles = list;
        this.profileId = (list.find(p => /rugix|revolution|revpi/i.test(p.name)) || list[0])?.id || '';
      });
    }
  }

  private fresh(profile: any): Partial<OtaPackageInfo> {
    return {type: this.data.type, deviceProfileId: profile, title: this.title.trim(), version: this.version.trim(),
      tag: this.tag.trim() || undefined, url: this.url.trim(), additionalInfo: {...(this.data.pkg?.additionalInfo || {}), description: this.fullDescription}};
  }

  save(): void {
    if (!this.valid || this.saving) {
      return;
    }
    this.saving = true;
    this.error = '';
    const done = {next: () => this.dialogRef.close(true), error: (err: any) => this.fail(err)};
    const old = this.data.pkg;
    if (!old) {
      this.rpc.savePackage(this.fresh({id: this.profileId, entityType: 'DEVICE_PROFILE'})).subscribe(done);
    } else if (!this.replaces) {
      this.rpc.savePackage({...old, additionalInfo: {...(old.additionalInfo || {}), description: this.fullDescription}}).subscribe(done);
    } else {
      // title, version, tag and URL are immutable in ThingsBoard: replace the package (the version may stay the same, so delete first)
      const backup: Partial<OtaPackageInfo> = {type: old.type, deviceProfileId: old.deviceProfileId, title: old.title, version: old.version,
        tag: old.tag, url: old.url, additionalInfo: old.additionalInfo};
      this.rpc.deletePackage(old.id.id).pipe(
        mergeMap(() => this.rpc.savePackage(this.fresh(old.deviceProfileId)).pipe(
          catchError(err => this.rpc.savePackage(backup).pipe(
            mergeMap(() => throwError(() => err)), catchError(() => throwError(() => err))))))
      ).subscribe(done);
    }
  }

  private fail(err: any): void {
    this.saving = false;
    this.error = err?.error?.message || err?.message || 'Saving failed';
  }

  /** A mouse click leaves the checkbox focused (round focus shadow stays on); drop the focus again. */
  blurSoon(): void {
    setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}

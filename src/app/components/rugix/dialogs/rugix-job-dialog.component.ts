///
/// Rugix management extension for ThingsBoard
///

import { ChangeDetectorRef, Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subscription, timer } from 'rxjs';
import { exhaustMap, takeWhile } from 'rxjs/operators';
import { RugixDevice, RugixJobEvent, RugixJobStatus, RugixWidgetSettings } from '../models/rugix.models';
import { formatDateTime, isTerminalStatus } from '../models/rugix-parse';
import { RugixRpcService } from '../services/rugix-rpc.service';

export interface RugixJobDialogData {
  device: RugixDevice;
  settings: RugixWidgetSettings;
  jobId: string;
  /** Only show events newer than this (ms epoch). */
  since?: number;
  title?: string;
}

/** Live view of a Rugix job: status, install progress and process output (from `jobEvent` telemetry). */
@Component({
  selector: 'tb-rugix-job-dialog',
  templateUrl: './rugix-job-dialog.component.html',
  styleUrls: ['./rugix-dialogs.scss'],
  standalone: false
})
export class RugixJobDialogComponent implements OnInit, OnDestroy {

  events: RugixJobEvent[] = [];
  status: RugixJobStatus = 'queued';
  title = '';
  progress: number | null = null;
  failure = '';
  done = false;

  private sub: Subscription;

  constructor(@Inject(MAT_DIALOG_DATA) public data: RugixJobDialogData,
              private dialogRef: MatDialogRef<RugixJobDialogComponent>,
              private rpc: RugixRpcService,
              private cd: ChangeDetectorRef) {
  }

  ngOnInit(): void {
    const since = this.data.since ?? 0;
    this.sub = timer(0, 2000).pipe(
      exhaustMap(() => this.rpc.loadJobEvents(this.data.settings, this.data.device, 500, since)),
      takeWhile(() => !this.done, true)
    ).subscribe(events => {
      // oldest first, only this job
      this.events = events.filter(e => !e.jobId || e.jobId === this.data.jobId).sort((a, b) => a.ts - b.ts);
      this.recompute();
      this.cd.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  close(): void {
    this.dialogRef.close();
  }

  private recompute(): void {
    for (const e of this.events) {
      if (e.type === 'job-changed' && e.status) {
        this.status = e.status;
        this.title = e.title || this.title;
        this.failure = e.failureMessage || '';
      } else if (e.type === 'install-progress' && !isNaN(e.progress)) {
        this.progress = Math.max(0, Math.min(100, e.progress));
      }
    }
    if (this.status === 'succeeded') {
      this.progress = this.progress === null ? null : 100;
    }
    this.done = isTerminalStatus(this.status);
  }

  get logEvents(): RugixJobEvent[] {
    return this.events.filter(e => e.type === 'job-output' || e.message || (e.type === 'job-changed' && e.status));
  }

  fmt(ts: number): string {
    return formatDateTime(ts, true);
  }

  describe(e: RugixJobEvent): string {
    if (e.type === 'job-output') {
      return e.line;
    }
    if (e.type === 'job-changed') {
      return `Job ${e.status}${e.failureMessage ? ': ' + e.failureMessage : ''}`;
    }
    return e.message;
  }
}

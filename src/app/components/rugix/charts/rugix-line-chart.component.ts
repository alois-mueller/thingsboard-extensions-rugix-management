///
/// Rugix management extension for ThingsBoard
///

import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild
} from '@angular/core';
import { RugixChartSeries } from '../models/rugix.models';
import { formatDate, formatDateTime, formatTime } from '../models/rugix-parse';

interface Tick { pos: number; label: string; }

interface HoverInfo {
  x: number;
  ts: number;
  values: { name: string; color: string; text: string }[];
  left: boolean;
}

/** Dependency free SVG line/area chart with hover tooltip (24h time axis, dd/MM/yyyy). */
@Component({
  selector: 'tb-rugix-line-chart',
  templateUrl: './rugix-line-chart.component.html',
  styleUrls: ['./rugix-line-chart.component.scss'],
  standalone: false
})
export class RugixLineChartComponent implements OnChanges, AfterViewInit, OnDestroy {

  @Input() series: RugixChartSeries[] = [];
  @Input() unit = '';
  @Input() yMin = 0;
  /** Fixed upper bound (e.g. 100 for percentages); computed from the data when omitted. */
  @Input() yMax?: number;
  @Input() decimals = 1;
  @Input() height = 180;
  @Input() area = true;

  @ViewChild('wrap', {static: true}) wrap: ElementRef<HTMLElement>;

  width = 600;
  readonly pad = {l: 44, r: 12, t: 10, b: 26};
  paths: { name: string; color: string; line: string; fill: string }[] = [];
  yTicks: Tick[] = [];
  xTicks: Tick[] = [];
  hover: HoverInfo | null = null;
  empty = true;

  private min = 0;
  private max = 1;
  private t0 = 0;
  private t1 = 1;
  private observer: ResizeObserver | undefined;

  constructor(private cd: ChangeDetectorRef) {
  }

  ngAfterViewInit(): void {
    this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.wrap.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  ngOnChanges(): void {
    this.build();
  }

  private measure(): void {
    const w = Math.round(this.wrap.nativeElement.clientWidth);
    if (w > 0 && w !== this.width) {
      this.width = w;
      this.build();
      this.cd.markForCheck();
    }
  }

  private build(): void {
    const all = this.series.flatMap(s => s.data);
    this.empty = all.length === 0;
    if (this.empty) {
      this.paths = [];
      this.yTicks = [];
      this.xTicks = [];
      return;
    }
    this.t0 = Math.min(...all.map(p => p[0]));
    this.t1 = Math.max(...all.map(p => p[0]));
    if (this.t1 === this.t0) {
      this.t1 = this.t0 + 1;
    }
    const dataMax = Math.max(...all.map(p => p[1]));
    this.min = this.yMin;
    this.max = this.yMax ?? this.niceMax(dataMax);
    if (this.max <= this.min) {
      this.max = this.min + 1;
    }
    const x = (t: number) => this.pad.l + (t - this.t0) / (this.t1 - this.t0) * this.plotW;
    const y = (v: number) => this.pad.t + (1 - (Math.min(this.max, Math.max(this.min, v)) - this.min) / (this.max - this.min)) * this.plotH;
    const base = this.pad.t + this.plotH;
    this.paths = this.series.map(s => {
      const pts = s.data.map(p => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
      const line = pts.length ? 'M' + pts.join('L') : '';
      const fill = pts.length ? `${line}L${x(s.data[s.data.length - 1][0]).toFixed(1)},${base}L${x(s.data[0][0]).toFixed(1)},${base}Z` : '';
      return {name: s.name, color: s.color, line, fill};
    });
    this.yTicks = [0, 1, 2, 3, 4].map(i => {
      const v = this.min + (this.max - this.min) * i / 4;
      return {pos: y(v), label: Number.isInteger((this.max - this.min) / 4) ? v.toFixed(0) : this.fmt(v, false)};
    });
    const span = this.t1 - this.t0;
    const n = Math.max(2, Math.min(6, Math.floor(this.plotW / 90)));
    this.xTicks = Array.from({length: n}, (_, i) => {
      const t = this.t0 + span * i / (n - 1);
      return {pos: x(t), label: span > 36 * 3600000 ? formatDate(t).slice(0, 5) : formatTime(t)};
    });
  }

  get plotW(): number {
    return Math.max(10, this.width - this.pad.l - this.pad.r);
  }

  get plotH(): number {
    return this.height - this.pad.t - this.pad.b;
  }

  get title(): string {
    return this.empty ? '' : `${formatDateTime(this.t0, false)} – ${formatDateTime(this.t1, false)}`;
  }

  onMove(ev: MouseEvent): void {
    if (this.empty) {
      return;
    }
    const rect = this.wrap.nativeElement.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const t = this.t0 + (px - this.pad.l) / this.plotW * (this.t1 - this.t0);
    let ts: number | null = null;
    const values = this.series.map(s => {
      let best: [number, number] | null = null;
      for (const p of s.data) {
        if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) {
          best = p;
        }
      }
      if (best && (ts === null || Math.abs(best[0] - t) < Math.abs(ts - t))) {
        ts = best[0];
      }
      return {name: s.name, color: s.color, text: best ? this.fmt(best[1], true) : '—'};
    });
    if (ts === null) {
      return;
    }
    const x = this.pad.l + (ts - this.t0) / (this.t1 - this.t0) * this.plotW;
    this.hover = {x, ts, values, left: x > this.width * 0.6};
  }

  onLeave(): void {
    this.hover = null;
  }

  fmt(v: number, withUnit: boolean): string {
    const s = v.toFixed(Math.abs(v) >= 100 ? 0 : this.decimals);
    return withUnit && this.unit ? `${s} ${this.unit}` : s;
  }

  dateTime(ts: number): string {
    return formatDateTime(ts);
  }

  private niceMax(v: number): number {
    if (v <= 0) {
      return 1;
    }
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nice * exp;
  }
}

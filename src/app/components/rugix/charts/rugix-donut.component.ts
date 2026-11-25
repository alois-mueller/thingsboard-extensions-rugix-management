///
/// Rugix management extension for ThingsBoard
///

import { Component, EventEmitter, Input, Output } from '@angular/core';

export interface RugixDonutSegment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Dependency free SVG donut chart with a legend (label, count, percentage). */
@Component({
  selector: 'tb-rugix-donut',
  template: `
    <div class="donut-card">
      <div class="donut-title">{{ title }}</div>
      <div class="donut-body">
        <svg viewBox="0 0 120 120" class="donut-svg" role="img" [attr.aria-label]="title">
          <circle class="ring-bg" cx="60" cy="60" r="46"></circle>
          @for (s of arcs; track s.key) {
            <circle class="ring" cx="60" cy="60" r="46" [attr.stroke]="s.color"
                    [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset" transform="rotate(-90 60 60)"></circle>
          }
          <text x="60" y="66" text-anchor="middle" class="total">{{ total }}</text>
        </svg>
        <div class="legend">
          @for (s of segments; track s.key) {
            <div class="legend-row" [class.clickable]="clickable" (click)="clickable && segmentClick.emit(s.key)">
              <span class="dot" [style.background]="s.color"></span>
              <span class="lbl">{{ s.label }}</span>
              <span class="val">{{ s.value }}</span>
              <span class="pct">({{ pct(s.value) }}%)</span>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./rugix-donut.component.scss'],
  standalone: false
})
export class RugixDonutComponent {
  @Input() title = '';
  @Input() segments: RugixDonutSegment[] = [];
  @Input() clickable = false;
  @Output() segmentClick = new EventEmitter<string>();

  private readonly circumference = 2 * Math.PI * 46;

  get total(): number {
    return this.segments.reduce((a, s) => a + s.value, 0);
  }

  pct(v: number): number {
    return this.total ? Math.round(v * 100 / this.total) : 0;
  }

  get arcs(): { key: string; color: string; dash: string; offset: number }[] {
    const total = this.total;
    let acc = 0;
    return total ? this.segments.filter(s => s.value > 0).map(s => {
      const len = this.circumference * s.value / total;
      const arc = {key: s.key, color: s.color, dash: `${Math.max(len - 1.5, 0.5)} ${this.circumference}`, offset: -acc};
      acc += len;
      return arc;
    }) : [];
  }
}

///
/// Rugix management extension for ThingsBoard
///

import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface RugixConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  /** Style the confirm button as destructive. */
  warn?: boolean;
  /** Amber confirm button for risky but reversible actions. */
  caution?: boolean;
  /** Text of a checkbox that must be ticked before the confirm button is enabled. */
  acknowledge?: string;
  /** Optional checkbox, e.g. "keep old state as backup" on factory reset. */
  checkbox?: { label: string; checked?: boolean };
  /** Boot group (slot) change shown for reboots, e.g. A → B. */
  transition?: { from: string; to: string; caption?: string };
  /** Text the user has to type exactly (e.g. the device name) before the confirm button is enabled. */
  typeToConfirm?: string;
  /** Reason / ticket id field; `required` blocks the confirm button while empty. */
  reason?: { required: boolean };
  /** Optional free text input shown when the checkbox is checked. */
  textWhenChecked?: { label: string };
}

export interface RugixConfirmDialogResult {
  checked: boolean;
  text: string;
  reason: string;
}

@Component({
  selector: 'tb-rugix-confirm-dialog',
  templateUrl: './rugix-confirm-dialog.component.html',
  styleUrls: ['./rugix-dialogs.scss'],
  standalone: false
})
export class RugixConfirmDialogComponent {
  checked = false;
  acknowledged = false;
  text = '';
  typed = '';
  reason = '';

  constructor(@Inject(MAT_DIALOG_DATA) public data: RugixConfirmDialogData,
              private dialogRef: MatDialogRef<RugixConfirmDialogComponent, RugixConfirmDialogResult>) {
    this.checked = !!data.checkbox?.checked;
  }

  get canConfirm(): boolean {
    return (!this.data.acknowledge || this.acknowledged)
      && (!this.data.typeToConfirm || this.typed.trim() === this.data.typeToConfirm)
      && (!this.data.reason?.required || !!this.reason.trim());
  }

  confirm(): void {
    if (!this.canConfirm) {
      return;
    }
    this.dialogRef.close({checked: this.checked, text: this.text.trim(), reason: this.reason.trim()});
  }

  /** A mouse click leaves the checkbox focused (round focus shadow stays on); drop the focus again. */
  blurSoon(): void {
    setTimeout(() => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  cancel(): void {
    this.dialogRef.close();
  }
}

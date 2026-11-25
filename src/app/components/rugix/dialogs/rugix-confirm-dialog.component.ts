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
  /** Optional checkbox, e.g. "keep old state as backup" on factory reset. */
  checkbox?: { label: string; checked?: boolean };
  /** Optional free text input shown when the checkbox is checked. */
  textWhenChecked?: { label: string };
}

export interface RugixConfirmDialogResult {
  checked: boolean;
  text: string;
}

@Component({
  selector: 'tb-rugix-confirm-dialog',
  templateUrl: './rugix-confirm-dialog.component.html',
  styleUrls: ['./rugix-dialogs.scss'],
  standalone: false
})
export class RugixConfirmDialogComponent {
  checked = false;
  text = '';

  constructor(@Inject(MAT_DIALOG_DATA) public data: RugixConfirmDialogData,
              private dialogRef: MatDialogRef<RugixConfirmDialogComponent, RugixConfirmDialogResult>) {
    this.checked = !!data.checkbox?.checked;
  }

  confirm(): void {
    this.dialogRef.close({checked: this.checked, text: this.text.trim()});
  }

  cancel(): void {
    this.dialogRef.close();
  }
}

///
/// Rugix management extension for ThingsBoard
///

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/public-api';
import { RugixAgentsComponent } from './agents/rugix-agents.component';
import { RugixConfirmDialogComponent } from './dialogs/rugix-confirm-dialog.component';
import { RugixInstallDialogComponent } from './dialogs/rugix-install-dialog.component';
import { RugixLineChartComponent } from './charts/rugix-line-chart.component';
import { RugixJobDialogComponent } from './dialogs/rugix-job-dialog.component';

@NgModule({
  declarations: [
    RugixAgentsComponent,
    RugixConfirmDialogComponent,
    RugixInstallDialogComponent,
    RugixJobDialogComponent,
    RugixLineChartComponent
  ],
  imports: [
    CommonModule,
    SharedModule
  ],
  exports: [
    RugixAgentsComponent,
    RugixConfirmDialogComponent,
    RugixInstallDialogComponent,
    RugixJobDialogComponent,
    RugixLineChartComponent
  ]
})
export class RugixModule {
}

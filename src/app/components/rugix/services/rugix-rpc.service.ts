///
/// Rugix management extension for ThingsBoard
///

import { Injectable } from '@angular/core';
import { DeviceService, AttributeService, EntityRelationService, DeviceProfileService } from '@core/public-api';
import { AggregationType, DataSortOrder, EntityType } from '@shared/public-api';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Device } from '@shared/models/device.models';
import { EntityId } from '@shared/models/id/entity-id';
import {
  RugixAppAction,
  RugixMachineStat,
  RugixDevice,
  RugixInstallOptions,
  RugixJobEvent,
  RugixSystemAction,
  RugixWidgetSettings
} from '../models/rugix.models';
import { parseJobEvent, parseMachineStat, uuidv4 } from '../models/rugix-parse';

export interface RugixJobHandle {
  jobId: string;
  response: any;
}

/**
 * Talks to a Rugix device through ThingsBoard:
 *
 *   widget -> TB server side RPC -> TB IoT Gateway (request connector) -> Rugix Admin REST API
 *
 * RPC methods are the ones defined in `serverSideRpc` of the gateway connector. The query string
 * of the Rugix API is passed as `params.query` (the connector appends it to the URL expression).
 */
@Injectable({providedIn: 'root'})
export class RugixRpcService {

  constructor(private deviceService: DeviceService,
              private attributeService: AttributeService,
              private relationService: EntityRelationService,
              private deviceProfileService: DeviceProfileService) {
  }

  // ---------------------------------------------------------------- system actions

  systemAction(settings: RugixWidgetSettings, device: RugixDevice, action: RugixSystemAction,
               options: { backup?: boolean; backupName?: string } = {}): Observable<RugixJobHandle> {
    const params: any = {};
    if (action === 'factoryReset') {
      params.query = RugixRpcService.buildQuery({backup: options.backup, backup_name: options.backupName});
    }
    return this.callForJob(settings, device, settings.rpc[action], params);
  }

  installUpdate(settings: RugixWidgetSettings, device: RugixDevice, url: string,
                options: RugixInstallOptions = {}): Observable<RugixJobHandle> {
    const uuid = uuidv4();
    return this.callForJob(settings, device, settings.rpc.installUpdate,
      {uuid, url, query: RugixRpcService.buildQuery(options as any)}, uuid);
  }

  installApp(settings: RugixWidgetSettings, device: RugixDevice, url: string,
             options: { bundle_hash?: string; skip_compatibility_check?: boolean } = {}): Observable<RugixJobHandle> {
    const uuid = uuidv4();
    return this.callForJob(settings, device, settings.rpc.installApp,
      {uuid, url, query: RugixRpcService.buildQuery(options)}, uuid);
  }

  appAction(settings: RugixWidgetSettings, device: RugixDevice, action: RugixAppAction, app: string,
            options: { generation?: number; keep?: number } = {}): Observable<RugixJobHandle> {
    return this.callForJob(settings, device, settings.rpc[action],
      {app, query: RugixRpcService.buildQuery(options)});
  }

  appsGarbageCollect(settings: RugixWidgetSettings, device: RugixDevice, keep?: number): Observable<RugixJobHandle> {
    return this.callForJob(settings, device, settings.rpc.appsGc, {query: RugixRpcService.buildQuery({keep})});
  }

  // ---------------------------------------------------------------- jobs / SSE

  /**
   * Ask the gateway to subscribe to `/api/jobs/{jobId}/events` (SSE). Every event is stored as
   * `jobEvent` telemetry of the Rugix device. Safe to call more than once for a job.
   */
  startJobStream(settings: RugixWidgetSettings, device: RugixDevice, jobId: string): Observable<any> {
    return this.resolveGateway(settings, device.id).pipe(
      mergeMap(gateway => this.profileName(gateway).pipe(
        mergeMap(gatewayType => this.deviceService.sendOneWayRpcCommand(gateway.id.id, {
          method: settings.sse.rpcMethod,
          params: {
            url: settings.sse.urlTemplate.replace('{jobId}', encodeURIComponent(jobId)),
            streamId: String(jobId),
            reconnectPeriod: settings.sse.reconnectPeriod,
            converter: {
              type: 'json',
              deviceNameJsonExpression: device.name,
              deviceTypeJsonExpression: gatewayType,
              attributes: [],
              telemetry: [{key: settings.sse.telemetryKey, type: 'JSON', value: '${$}'}]
            }
          }
        }, {ignoreErrors: true}))
      ))
    );
  }

  /** Most recent job events (newest first). */
  loadJobEvents(settings: RugixWidgetSettings, device: RugixDevice, limit = 200, startTs = 0): Observable<RugixJobEvent[]> {
    const entityId: EntityId = {entityType: EntityType.DEVICE, id: device.id};
    const key = settings.keys.jobEvent;
    return this.attributeService.getEntityTimeseries(entityId, [key], startTs, Date.now(), limit,
      AggregationType.NONE, undefined, DataSortOrder.DESC, false, {ignoreLoading: true, ignoreErrors: true}).pipe(
      map(data => (data?.[key] || []).map(v => parseJobEvent(v.value, v.ts))),
      catchError(() => of([]))
    );
  }

  /** `machineStats` telemetry of the IoT Gateway that owns the Rugix device (oldest first). */
  loadMachineStats(settings: RugixWidgetSettings, gatewayId: string, startTs: number, endTs: number,
                   limit = 3000): Observable<RugixMachineStat[]> {
    const key = settings.keys.machineStats;
    const entityId: EntityId = {entityType: EntityType.DEVICE, id: gatewayId};
    return this.attributeService.getEntityTimeseries(entityId, [key], startTs, endTs, limit,
      AggregationType.NONE, undefined, DataSortOrder.DESC, false, {ignoreLoading: true, ignoreErrors: true}).pipe(
      map(data => (data?.[key] || []).map(v => parseMachineStat(v.value, v.ts)).filter(s => !!s).reverse() as RugixMachineStat[])
    );
  }

  // ---------------------------------------------------------------- helpers

  static buildQuery(options: { [key: string]: any }): string {
    return Object.keys(options || {})
      .filter(k => options[k] !== undefined && options[k] !== null && options[k] !== '')
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(options[k]))}`)
      .join('&');
  }

  /** Extract a job id from the heterogeneous response shapes the gateway can return. */
  static extractJobId(response: any): string | undefined {
    if (typeof response === 'string' || typeof response === 'number') {
      return String(response);
    }
    const paths = ['result.value.job.id', 'result.value.jobId', 'result.value.id', 'result.job.id', 'result.jobId',
      'result.id', 'value.job.id', 'value.jobId', 'value.id', 'job.id', 'jobId', 'id', 'result.value', 'result'];
    for (const path of paths) {
      const v = path.split('.').reduce((o, k) => (o === null || o === undefined) ? undefined : o[k], response);
      if (typeof v === 'string' || typeof v === 'number') {
        return String(v);
      }
    }
    return undefined;
  }

  private callForJob(settings: RugixWidgetSettings, device: RugixDevice, method: string, params: any,
                     preassignedJobId?: string): Observable<RugixJobHandle> {
    if (!method) {
      return throwError(() => new Error('RPC method is not configured in the widget settings.'));
    }
    return this.deviceService.sendTwoWayRpcCommand(device.id, {method, params, timeout: settings.rpc.timeout}).pipe(
      map(response => {
        // For installs the job id is chosen by us (`/api/system/update/{uuid}/url`), otherwise it is returned.
        const jobId = RugixRpcService.extractJobId(response) ?? preassignedJobId;
        if (!jobId) {
          throw new Error(`No Rugix job id returned for "${method}" on "${device.name}".`);
        }
        return {jobId, response};
      })
    );
  }

  /** Walk the `Created` relations up to the gateway device that owns the Rugix device. */
  resolveGateway(settings: RugixWidgetSettings, deviceId: string): Observable<Device> {
    const seen = new Set<string>();
    let fallback: Device | null = null;
    const search = (id: string, entityType: EntityType, depth: number): Observable<Device | null> => {
      if (depth > settings.maxRelationDepth || seen.has(id)) {
        return of(null);
      }
      seen.add(id);
      return this.relationService.findByTo({entityType, id} as EntityId, {ignoreLoading: true}).pipe(
        map(relations => relations.filter(r => r.type === settings.gatewayRelationType).map(r => r.from)),
        mergeMap(parents => parents.reduce(
          (chain: Observable<Device | null>, parent) => chain.pipe(mergeMap(found => {
            if (found) {
              return of(found);
            }
            if (parent.entityType !== EntityType.DEVICE) {
              return search(parent.id, parent.entityType as EntityType, depth + 1);
            }
            return this.deviceService.getDevice(parent.id, {ignoreLoading: true}).pipe(mergeMap(d => {
              if (RugixRpcService.isGateway(d)) {
                return of(d);
              }
              fallback = fallback || d;
              return search(parent.id, EntityType.DEVICE, depth + 1);
            }));
          })), of(null)))
      );
    };
    return search(deviceId, EntityType.DEVICE, 0).pipe(
      map(gateway => {
        const result = gateway || fallback;
        if (!result) {
          throw new Error(`No gateway found via relation "${settings.gatewayRelationType}".`);
        }
        return result;
      })
    );
  }

  private static isGateway(device: Device): boolean {
    const info = device?.additionalInfo || {};
    return [info.gateway, info.isGateway].some(v => v === true || v === 'true');
  }

  private profileName(device: Device): Observable<string> {
    if (!device?.deviceProfileId) {
      return of(device?.type || '');
    }
    return this.deviceProfileService.getDeviceProfileInfo(device.deviceProfileId.id, {ignoreLoading: true}).pipe(
      map(p => p?.name || device.type || ''),
      catchError(() => of(device.type || ''))
    );
  }
}

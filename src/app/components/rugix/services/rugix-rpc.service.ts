///
/// Rugix management extension for ThingsBoard
///

import { Injectable } from '@angular/core';
import { DeviceService, AttributeService, EntityRelationService, DeviceProfileService, OtaPackageService } from '@core/public-api';
import { AggregationType, AttributeScope, DataSortOrder, EntityType, OtaPackageInfo, OtaUpdateType, PageLink } from '@shared/public-api';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Device } from '@shared/models/device.models';
import { EntityId } from '@shared/models/id/entity-id';
import {
  RugixAppAction,
  RugixAppInfo,
  RugixMachineStat,
  RugixDevice,
  RugixInstallOptions,
  RugixJobEvent,
  RugixSystemAction,
  RugixWidgetSettings
} from '../models/rugix.models';
import { parseAppInfo, parseJobEvent, parseMachineStat, uuidv4 } from '../models/rugix-parse';

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
              private deviceProfileService: DeviceProfileService,
              private otaService: OtaPackageService) {
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
             options: RugixInstallOptions = {}): Observable<RugixJobHandle> {
    const uuid = uuidv4();
    return this.callForJob(settings, device, settings.rpc.installApp,
      {uuid, url, query: RugixRpcService.buildQuery(options as any)}, uuid);
  }

  appAction(settings: RugixWidgetSettings, device: RugixDevice, action: RugixAppAction, app: string,
            options: { generation?: number; keep?: number } = {}): Observable<RugixJobHandle> {
    return this.callForJob(settings, device, settings.rpc[action],
      {app, query: RugixRpcService.buildQuery(options)});
  }

  /** Generations and lifecycle state of one app (`GET /api/apps/{app}` through the gateway RPC `appInfo`). */
  appInfo(settings: RugixWidgetSettings, device: RugixDevice, app: string): Observable<RugixAppInfo> {
    if (!settings.rpc.appInfo) {
      return throwError(() => new Error('RPC method "appInfo" is not configured in the widget settings.'));
    }
    return this.deviceService.sendTwoWayRpcCommand(device.id, {
      method: settings.rpc.appInfo, params: {app}, timeout: settings.rpc.timeout
    }, {ignoreErrors: true} as any).pipe(map(response => parseAppInfo(response)));
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
        const jobId = preassignedJobId ?? RugixRpcService.extractJobId(response);
        if (!jobId) {
          throw new Error(`No Rugix job id returned for "${method}" on "${device.name}".`);
        }
        return {jobId, response};
      })
    );
  }

  /** All OTA packages of the tenant (firmware and software), newest first. */
  listPackages(): Observable<OtaPackageInfo[]> {
    return this.otaService.getOtaPackages(new PageLink(1000, 0, null, {property: 'createdTime', direction: 'DESC' as any}), {ignoreLoading: true})
      .pipe(map(page => (page.data || []).filter(p => p.type === OtaUpdateType.FIRMWARE || p.type === OtaUpdateType.SOFTWARE)));
  }

  /** Device profiles an OTA package can belong to. */
  listProfiles(): Observable<{ id: string; name: string }[]> {
    return this.deviceProfileService.getDeviceProfileInfos(new PageLink(100, 0, null, {property: 'name', direction: 'ASC' as any}), undefined, {ignoreLoading: true})
      .pipe(map(page => (page.data || []).map(p => ({id: p.id.id, name: p.name}))));
  }

  /** Create (external URL) or update the metadata (title, tag, description) of an OTA package. */
  savePackage(pkg: Partial<OtaPackageInfo>): Observable<any> {
    return this.otaService.saveOtaPackageInfo(pkg as OtaPackageInfo);
  }

  deletePackage(id: string): Observable<any> {
    return this.otaService.deleteOtaPackage(id);
  }

  /** Store the release channel as server-scope attribute of the device. */
  setChannel(settings: RugixWidgetSettings, device: RugixDevice, channel: string): Observable<any> {
    const entityId = {entityType: EntityType.DEVICE, id: device.id} as EntityId;
    return this.attributeService.saveEntityAttributes(entityId, AttributeScope.SERVER_SCOPE, [{key: settings.keys.channel, value: channel}]);
  }

  /** Record who changed what (best effort): server attribute of the device, ThingsBoard keeps its own audit log as well. */
  recordChange(settings: RugixWidgetSettings, device: RugixDevice, entry: { action: string; user: string; reason?: string; detail?: string }): Observable<any> {
    const key = settings.security.changeAttribute;
    if (!key) {
      return of(null);
    }
    const entityId = {entityType: EntityType.DEVICE, id: device.id} as EntityId;
    const value = {...entry, at: new Date().toISOString()};
    return this.attributeService.saveEntityAttributes(entityId, AttributeScope.SERVER_SCOPE, [{key, value}], {ignoreErrors: true, ignoreLoading: true}).pipe(
      catchError(() => of(null))
    );
  }

  /** Channel configuration stored as tenant server attribute (`null` when not stored or not readable). */
  loadChannelConfig(settings: RugixWidgetSettings, tenantId: string): Observable<{ channels: { [name: string]: string }; defaultChannel: string } | null> {
    const entityId = {entityType: EntityType.TENANT, id: tenantId} as EntityId;
    return this.attributeService.getEntityAttributes(entityId, AttributeScope.SERVER_SCOPE, [settings.channelsAttribute], {ignoreLoading: true, ignoreErrors: true}).pipe(
      map(attrs => {
        let v = attrs?.[0]?.value;
        if (typeof v === 'string') {
          try { v = JSON.parse(v); } catch { v = null; }
        }
        return v && typeof v === 'object' && v.channels && typeof v.channels === 'object' ? {channels: v.channels, defaultChannel: v.defaultChannel} : null;
      }),
      catchError(() => of(null))
    );
  }

  saveChannelConfig(settings: RugixWidgetSettings, tenantId: string, config: { channels: { [name: string]: string }; defaultChannel: string }): Observable<any> {
    const entityId = {entityType: EntityType.TENANT, id: tenantId} as EntityId;
    return this.attributeService.saveEntityAttributes(entityId, AttributeScope.SERVER_SCOPE, [{key: settings.channelsAttribute, value: config}]);
  }

  /** Creation time (ms epoch) of the device entity. */
  getDeviceCreated(deviceId: string): Observable<number | undefined> {
    return this.deviceService.getDevice(deviceId, {ignoreLoading: true, ignoreErrors: true}).pipe(
      map(d => d?.createdTime),
      catchError(() => of(undefined))
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

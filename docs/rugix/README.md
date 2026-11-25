# Rugix management extension

Widget `tb-rugix-agents` – manage [Rugix](https://github.com/rugix) devices from ThingsBoard, modelled after
**Edge management → Agents** of ThingsBoard 4.4 (entity table, details panel with tabs, action dialogs with job progress).

```
widget ──RPC──▶ ThingsBoard ──▶ TB IoT Gateway (request connector) ──▶ Rugix Admin REST API
   ▲                                   │
   └──── attributes / telemetry ◀──────┘   (poll mappings + SSE stream of /api/jobs/{id}/events → `jobEvent`)
```

## Features
- Device table: online status, boot flow, active boot group, **"commit pending"** hint (active ≠ default group), state management, API version, last job
- Details tabs: Overview, A/B Slots, Apps (start/stop/activate/deactivate/rollback/gc/remove), Components (+ problems), Last job
- Actions (single + bulk): install system update / app bundle from OTA package URL, reboot, reboot into spare, commit, factory reset (optional backup)
- Job dialog: live status, install progress and process output from `jobEvent` telemetry

## Resources tab (CPU / memory / storage)
The *Resources* tab charts the `machineStats` telemetry of the **TB IoT Gateway device that owns the Rugix device**
(found via the `Created` relation, same as for the job stream; key and relation type are widget settings).
`freeMemory` is interpreted as *percent free* (used = 100 - freeMemory); `diskUsage`, `totalCpuUsage` and
`gwProcessCpuUsage` as percent, `gwProcessMemoryFullInfo.rss` is shown in MiB. Ranges: 1 h, 6 h, 24 h, 7 d
(auto refresh every 30 s). No data keys have to be added to the widget datasource for this tab.

## Install
1. `yarn install && yarn build` → upload `target/generated-resources/thingsboard-extension-widgets.js` as **Extension** JS resource.
2. Create a **latest values** widget, add the extension as resource (*Is extension*), and use
   [`widget/template.html`](widget/template.html), [`widget/controller.js`](widget/controller.js); paste
   [`widget/default-config.json`](widget/default-config.json) as default config (data keys).
3. In dashboards use an entity alias for your device type (e.g. `RevolutionPi_Rugix`).

Widget settings (JSON, all optional) allow renaming RPC methods and data keys, see `DEFAULT_RUGIX_SETTINGS` in
[`rugix.models.ts`](../../src/app/components/rugix/models/rugix.models.ts).

## Gateway connector – recommended changes
Derived from `rugix-request-connector-v1-0`:

| # | Finding | Recommendation |
|---|---------|----------------|
| 1 | No app list is polled | Add mapping `GET /api/apps` → attribute `apps.apps = ${apps}` (needed for the Apps tab) |
| 2 | `scanPeriod` 600 s for `/api/system/info` | After a reboot/commit the UI shows stale boot groups for up to 10 min. Use 30–60 s |
| 3 | `deviceNameJsonExpression` hard-coded to one device | One connector instance per Rugix device (host differs) or generate them from a template |
| 4 | `factoryReset` returns `${job}`, others `${job.id}` | Use `${job.id}` everywhere |
| 5 | `installUpdateFromUrl` / `installAppFromUrl` have no `responseValueExpression` | Fine for this extension (it passes its own job UUID, Rugix accepts it in the path); optionally add `${job.id}` |
| 6 | RPC URLs lack leading `/` (`api/system/...`) while mappings have it | Make consistent (`/api/...`) |
| 7 | `jobEvent` telemetry gets one row per output line | Set a telemetry TTL / retention for the device profile |
| 8 | `auto_commit` toggle in the old dashboard only stores an attribute | Nothing consumes it – add a rule chain (activeGroup ≠ defaultGroup & auto_commit → RPC `commit`) |
| 9 | `anonymous` security + `SSLVerify: false` | OK for tests; protect Rugix Admin / use TLS in production |

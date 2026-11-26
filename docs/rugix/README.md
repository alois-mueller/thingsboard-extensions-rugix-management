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

### Views
The widget has two views in the top menu: **Overview** (fleet donuts for device status, Edge OS versions and last job, plus
recent alerts such as offline, commit pending, failed jobs, security bypasses) and **Devices** (the table). Set
`{"defaultView": "devices"}` in the widget settings to open on the table.

### Jobs view, generations, boot groups
- **Jobs** (top menu): job history of all devices from the `jobEvent` telemetry (last 24 h / 7 d / 30 d, filter by status, search, click a row opens the device's job log).
- **Apps tab → click an app**: generations (created, last activated, state) with *Activate*; needs the `appInfo` RPC (see connector table).
- **Overview → Boot groups**: reboot into a boot group (rugix-admin offers `reboot` for the active group and `reboot-spare` for the single other group).
- **Install dialogs → Advanced**: transfer options (root certificate, retries/backoff, range requests); bypass options only for devices whose daemon runs with `dangerously_insecure`.

### Role restrictions and last seen
`access` in the widget settings limits which ThingsBoard user authorities may use an action class
(`SYS_ADMIN`, `TENANT_ADMIN`, `CUSTOMER_USER`). Default: install and reboot/commit for everyone, factory reset for
tenant/system administrators only:

```json
{"access": {"install": ["TENANT_ADMIN", "CUSTOMER_USER"], "power": ["TENANT_ADMIN"], "factoryReset": ["TENANT_ADMIN"]}}
```

This is a **UI-level** gate. The server side RPC permission is still decided by ThingsBoard (customer roles /
dashboard access), so restrict who may open the dashboard or send RPC as well.

Offline devices show "offline since" taken from the timestamp of the `active` attribute. Add the device attribute
`lastActivityTime` as an optional data key to use the real last activity time instead.

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
| 10 | Daemon policy and Admin version are not polled | Add `GET /api/daemon` → attribute `daemon.features = ${features}` (+ optionally `daemon.dangerouslyInsecure = ${dangerously_insecure}`; the whole response body also works) and `GET /api/info` → attribute `admin.version = ${version}`. Used to disable actions the daemon switched off, to show the "security bypasses enabled" warning and the Rugix Admin version |
| 11 | No RPC for `GET /api/apps/{app}` | Add a server side RPC `appInfo` (GET `/api/apps/${params.app}`, return the response body). Used for the generations list of an app (Apps tab → click a row) incl. lifecycle state. Activating a generation uses the existing `appActivate` RPC with query `generation=<n>` |
| 9 | `anonymous` security + `SSLVerify: false` | OK for tests; protect Rugix Admin / use TLS in production |

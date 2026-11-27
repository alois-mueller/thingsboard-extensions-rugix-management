# Rugix management widget – open items

State: all requested features are implemented and checked against the simulated 20-device fleet (see `local-test/`).
Everything below is what is still open, roughly in priority order.

## 1. Verify against real systems (not yet done)
- [ ] IoT Gateway: SSE job events (`jobEvent`) and real `install-progress` payloads, app install progress.
- [ ] Gateway connector mappings (see README, "Gateway connector – recommended changes"): `GET /api/daemon` → `daemon.features`, `GET /api/info` → `admin.version`, `GET /api/apps` / RPC `appInfo`. Without them Daemon Capabilities, Admin version and app generations stay empty.
- [ ] Customer users: only the `access` setting was tested, never a real customer login. Check that the tenant attribute `rugix.channels` is readable (otherwise the widget falls back to the widget settings) and that OTA packages are listed.
- [ ] `machineStats.freeMemory` is assumed to be percent free.
- [ ] Bundle download from Azure Blob: decide how the access token is added without exposing it (reverse proxy / Front Door, or gateway config – not in ThingsBoard, see "Security notes" in the README).
- [ ] Accessibility: axe-core and keyboard checks pass (`local-test/e2e`), but a manual screen reader pass (NVDA / VoiceOver) and a check with browser zoom 200 % / forced colors are still open.
- [ ] Real phone / tablet test: emulated devices (iPhone SE / 14, Pixel 7, iPad portrait and landscape in Chromium) pass, real devices and Safari / WebKit were not tested.

## 2. Next features
- [ ] Package metadata in the catalog: bundle hash (prefill `bundle_hash`), size, release notes, hardware / architecture compatibility.
- [ ] App target versions: outdated indicator for apps (like firmware vs. channel), app channels.
- [ ] Bulk "Set channel" for selected devices.
- [ ] Staged rollouts (first N % of devices, wait for success, then the rest; pause / abort).
- [ ] Scheduled updates (maintenance window).
- [ ] Automatic commit after a health check, otherwise roll back into the spare slot.
- [ ] Real ThingsBoard alarms / notifications through a rule chain (failed job, offline too long) – alerts exist only inside the widget today.
- [ ] Groups / tags, filter by customer, site or device profile.
- [ ] CSV export of the device table and the job list.
- [ ] Deep links and saved filters.
- [ ] Cancel a running job (if Rugix Admin supports it).
- [ ] Per-device configuration editor, remote access / commands.
- [ ] Device onboarding / decommissioning.
- [ ] Translations (UI is English only).

- [ ] More package metadata in `rugix-meta` (see README): architecture / hardware compatibility with a warning in the install dialog, minimum running version, release date.
- [ ] Alarms through a rule chain for failed jobs (also see CRA/IEC 62443 gaps in `COMPLIANCE.md`).

## 3. Decisions left open
- [ ] Block actions on a device while a job runs? Not built: a stuck "running" state would lock the device.
- [ ] Treat "outdated" as an own status (current) or as a warning in the health filter?

## 4. Known limitations
- Job log loads at most 5000 events per device, the Jobs view 2000 (a hint is shown).
- Donut legends are narrow and truncate long labels ("Cu…", "Heal…").
- Two admins saving the Channels view at the same time overwrite each other (last write wins).
- ThingsBoard treats title, version, tag and URL of an OTA package as immutable: *Edit* replaces the package (removes and re-adds it).
- The GitHub version badges on the Overview page load from `camo.githubusercontent.com` (needs internet access, exposes the viewer's IP).
- Permissions are only hidden in the UI (`access.*`); ThingsBoard decides what is really allowed.

## 5. Quality
- [ ] CRA / IEC 62443 process items: threat model, SAST (CodeQL), signed releases, support period, named owner for the 24 h vulnerability report, dependency license review (see `COMPLIANCE.md`).
- [ ] Check `yarn audit` in CI: the local run in the sandbox audited 0 packages (no registry access), so the result of the CI job has not been seen yet.
- [ ] No automated tests yet. Worth adding unit tests for `compareVersions` / `firmwareState`, `foldJobEvent` / `parseJobEvent`, `urlIssue`, `channelTarget`.
- [x] Browser checks for phone / tablet sizes, accessibility and keyboard: `local-test/e2e` (Playwright, run by hand, not in CI yet).

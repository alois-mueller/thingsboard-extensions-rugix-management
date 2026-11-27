# CRA and IEC 62443 – mapping for the Rugix management widget

Technical assessment, **not legal advice**. Whether the Cyber Resilience Act (CRA) applies and in which product class
depends on how the product is placed on the market – please check this with your compliance officer.

## Scope and responsibilities

The widget is only a user interface on ThingsBoard. Most requirements are fulfilled by other layers:

| Layer | Responsible for |
|---|---|
| ThingsBoard | Authentication, MFA, roles, audit log, TLS, session handling |
| Rugix on the device | Bundle signature verification, A/B slots, rollback, commit |
| Operations | TLS everywhere, reverse proxy that adds storage tokens (SAS), network zones, log retention |
| This repository | Secure handling in the UI, supply chain, vulnerability handling, documentation |

Dates (CRA): reporting of actively exploited vulnerabilities applies since 2026-09-11, all other obligations from 2027-12-11.

## What the widget does

| Requirement | CRA Annex I | IEC 62443 | Implementation |
|---|---|---|---|
| No secrets in the widget | I (3), (4) | SR 4.1 | No tokens are stored or sent; URLs with credentials are warned about and the query is hidden in the UI |
| Transport integrity / confidentiality of updates | I (3) | SR 3.1, SR 4.1 | `security.requireHttps` (default **on**) rejects plain http bundle URLs in the install and package dialogs |
| Update integrity | I (2)(c) | SR 3.4 | Signature check is done by Rugix on the device; the widget can pass an expected bundle hash and never offers to skip verification unless the daemon itself allows it |
| Protection against unintended downgrade | I (2)(d) | SR 3.4 | A package older than the running firmware needs an extra confirmation |
| Prevent misuse / mass errors | I (2)(f) | SR 7.1, SR 7.2 | Factory reset needs the device name typed; installs on more than `security.bulkConfirmThreshold` devices (default 5) need the number typed; every action has a confirmation |
| Traceability | I (2)(j) | SR 2.8, SR 2.12 | Optional or required (`security.requireReason`) reason / ticket id; the widget writes `rugix.lastChange` (action, user, time, reason) as device attribute; ThingsBoard keeps its own audit log |
| Authorization | I (2)(b) | SR 2.1 | `access.*` only hides buttons. Enforcement is ThingsBoard's job (roles, RPC permissions) |
| Input validation | I (2)(f) | SR 3.5 | Channel names, URLs, versions and all device-provided data are validated; Angular templates, no `innerHTML` |
| Minimal attack surface | I (2)(h) | CR 7.7 | Only the configured RPC methods are called, no external requests except the optional version badges |

## What has to be done outside the widget

- TLS for ThingsBoard, the gateway, Rugix Admin and the bundle storage. The local test setup uses http and is for tests only.
- Enable 2FA, password policy and session timeouts in ThingsBoard.
- Roles: ThingsBoard CE has no fine-grained RBAC; use customers and device profiles to limit who may send RPC, or use PE.
- Export and keep the audit log for the retention period you need (SR 6.1).
- Sign all Rugix bundles; manage the signing keys separately from the build system.
- Alarms for failed jobs / outdated devices as rule chain in ThingsBoard (SR 6.2).
- Network zones and conduits between devices, gateway and cloud (IEC 62443-3-2).
- Azure Blob: serve private bundles through a proxy / Front Door that adds the SAS token (see README "Security notes").

## Development process (IEC 62443-4-1, CRA Annex I part II)

| Item | Status |
|---|---|
| Vulnerability disclosure policy and contact | `SECURITY.md` |
| Dependency monitoring | Dependabot (`.github/dependabot.yml`), `yarn audit` in CI |
| SBOM | SPDX file built by CI (`sbom` job, artifact `sbom.spdx.json`) |
| Reproducible build, locked dependencies | `yarn install --frozen-lockfile`, `yarn.lock` |
| Static analysis | `yarn lint` in CI. A dedicated SAST scan (e.g. CodeQL) is not set up yet |
| Review | Pull requests into `master` |
| Automated tests | **Open** – see `TODO.md` |
| Threat model | **Open** |
| Signed releases, release notes with security section | **Open** |
| Support period statement | **Open** – decide and put it into the release notes |
| Reporting to ENISA / CSIRT (24 h) | Process owner has to be named – **open** |
| EU declaration of conformity, technical documentation, CE marking | Only if the product is placed on the market – **open** |
| License review of dependencies | **Open** (this repo is a fork under Apache-2.0) |

## Known gaps in the widget

- No staged rollouts, maintenance windows or automatic stop on failures.
- No flag "security update" or link to an advisory on packages.
- Bundle signature state is not shown (only the hash is displayed).
- Failed jobs raise no ThingsBoard alarm.
- The widget cannot prove who started an action; it relies on the ThingsBoard audit log and the `rugix.lastChange` attribute, which a tenant admin can overwrite.

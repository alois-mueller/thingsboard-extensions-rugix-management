# Security policy

This repository contains a fork of the ThingsBoard extensions with the **Rugix management widget**
(`src/app/components/rugix`, documentation in `docs/rugix`). It is a UI component: it stores no secrets,
and authentication, authorization, audit logging and transport security are done by ThingsBoard.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

- Use GitHub's private reporting: *Security* tab → *Report a vulnerability* in
  <https://github.com/alois-mueller/thingsboard-extensions-rugix-management>.
- Or write to the maintainers of the Alois Müller organization (contact: felix.weitke@alois-mueller.com).

Please include the affected version / commit, a description, steps to reproduce and the impact.

What you can expect:
- Confirmation of receipt within 3 working days.
- A first assessment within 10 working days and regular status updates until the issue is closed.
- Coordinated disclosure: we publish a fix and an advisory first, then the details. Credit is given if wished.

Vulnerabilities in ThingsBoard itself, Rugix or the Angular / npm dependencies should be reported to the
respective project; we follow their fixes through the dependency updates described below.

## Supported versions

Only the current `master` branch (and the release built from it) receives security fixes.
The support period of a released version is stated in its release notes (target: at least 5 years for products
placed on the EU market, see `docs/rugix/COMPLIANCE.md`).

## How we handle security

- Dependencies are watched by Dependabot, `yarn audit` runs in CI, and a SBOM (SPDX) is built with every CI run.
- Security fixes are released as soon as possible, separate from feature work, and named as such in the release notes.
- Actively exploited vulnerabilities in a product placed on the EU market are reported to ENISA / the national CSIRT
  within 24 hours (Cyber Resilience Act, Art. 14).
- Security-relevant design decisions and the mapping to CRA and IEC 62443 are in `docs/rugix/COMPLIANCE.md`.

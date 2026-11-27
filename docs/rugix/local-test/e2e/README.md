# Browser checks (Playwright)

Run against a ThingsBoard with the Rugix dashboard (see `../docker-compose.yml`, users and simulator are local test data only).

```bash
npm i playwright-core axe-core
export DASHBOARD_URL=http://localhost:8080/dashboards/<id> OUT_DIR=/tmp/rugix-e2e   # CHROMIUM_PATH=/path/to/chrome if needed
node mob.js [iphone-se|iphone-14|pixel-7|ipad|ipad-land]   # overflow + touch target sizes at phone / tablet sizes, screenshots
node a11y.js                                                  # axe-core scan of all views, panels and dialogs
node kbd.js                                                   # keyboard: focus ring, Enter/Space/Escape, dialog focus trap and focus return
```

The login is `tenant@thingsboard.org` / `tenant` of the local test instance. Expected result: no overflow, no touch target under 24 px,
`0 rule(s)` for every axe scan, no focus stop without a ring, focus returns to the opening button.

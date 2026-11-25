# Local test instance (ThingsBoard 4.4.1)

```bash
yarn build                                  # in repo root
cd docs/rugix/local-test
docker compose up -d                        # postgres + install + tb-node:4.4.1 on :8080
python3 setup.py                            # uploads extension, creates widget type, profile, 2 devices
python3 dash.py                             # creates the dashboard, prints its URL
cd sim && npm i && node sim.js              # fake Rugix devices (MQTT): answer RPCs, emit jobEvent telemetry
```
Login: `tenant@thingsboard.org` / `tenant`. `setup.py` writes `devices.txt` (device access tokens) used by the simulator.
Run `setup.py` only once per fresh instance (`docker compose down -v` resets everything).

# sweph-core

Raw Swiss Ephemeris computations on `127.0.0.1` beside the client application, with no business logic: no per-visitor limits, aspects, dignities or interpretations.

## License and source code

- [AGPL-3.0-only](LICENSE); no permission for later versions is granted.
- Uses Swiss Ephemeris © Astrodienst AG, licensed under AGPL-3.0 ([licensing terms](https://www.astro.com/swisseph/swephinfo_e.htm#proflic)); see [third-party licenses](THIRD_PARTY_LICENSES.md).
- Every response carries `X-Source-Code` from `SOURCE_URL` for network users under AGPL §13; its default comes from `package.json` / `repository`. If you run a modified version, publish your changes and point `SOURCE_URL` to that source.
- Download the `.se1` data files from [Astrodienst](https://github.com/aloistr/swisseph/tree/master/ephe); they are not included here.

## Running

Requires Node.js ≥ 22.12 and a C++ toolchain to build the native addon during `npm ci`.

```bash
npm ci --omit=dev
CORE_SECRET='<at least 32 random characters>' EPHE_PATH=/path/to/ephe node server.cjs
```

| Variable | Default | Purpose |
|---|---|---|
| `CORE_SECRET` | required | Shared secret sent as `x-core-secret`. |
| `EPHE_PATH` | required | Directory of `.se1` files; checked at startup. |
| `HOST` | `127.0.0.1` | Listen address. |
| `CORE_ALLOW_NON_LOOPBACK` | off | `1` permits a non-loopback host. |
| `PORT` | `3010` | Listen port; `0` selects a free port. |
| `SOURCE_URL` | repository URL | Published source, sent as `X-Source-Code`. |
| `GIT_COMMIT`, `GIT_TAG` | unset | Optional build identity in `/version`. |
| `MAX_BODY_BYTES` | `65536` | Request body limit in bytes. |
| `LOG_REQUESTS` | off | `1` logs method, path, status and duration; never bodies. |
| `COMPUTE_SLICE_MS` | `10` | Computation slice budget (1–1000 ms). |

## API

All endpoints except `/health` require `x-core-secret`. Requests and responses use JSON.

- `GET /health` — liveness.
- `GET /version` — service, build, engine and data versions.
- `POST /v1/calc` — planetary positions.
- `POST /v1/houses` — house cusps and angles.
- `POST /v1/chart` — date conversion, positions and houses.
- `POST /v1/julday` — dates to Julian days.
- `POST /v1/revjul` — Julian day to calendar date.
- `POST /v1/date/valid` — calendar date validation.
- `POST /v1/deltat` — ET minus UT.
- `POST /v1/sun-crossing` — next solar longitude crossing.
- `POST /v1/eclipse/solar/global` — next global solar eclipse.
- `POST /v1/eclipse/solar/local` — next local solar eclipse.
- `POST /v1/eclipse/lunar/next` — next lunar eclipse.
- `POST /v1/eclipse/lunar/at` — lunar eclipse at an instant.
- `POST /v1/rise-set` — rise or set time.
- `POST /v1/batch` — ordered computation calls.

## Tests

Install development dependencies with `npm ci`; tests require `.se1` files for the tested epochs, including `sepl_18.se1`, `semo_18.se1` and `seas_18.se1`.
Run `EPHE_PATH=/path/to/ephe npm test`; in PowerShell: `$env:EPHE_PATH="/path/to/ephe"; npm test`.
Tests cover HTTP, validation, known positions, reference parity, observer isolation, slicing and startup.

## Operations

Run one process per server under a restarting process manager; start it before the client. See [release and deployment](docs/RELEASE.md).
Update data in a new directory, change `EPHE_PATH`, restart and verify the `/version` file count and digest.
To update `sweph`, change its version in `package.json`, update the lockfile, run `npm ci`, test with `EPHE_PATH`, then restart.

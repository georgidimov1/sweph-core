# Changelog

## 1.0.0 - 2026-11-13

- Raw Swiss Ephemeris HTTP endpoints for positions, houses, charts, Julian/calendar
  conversion, date validation, delta-T, solar crossings, solar/lunar eclipses,
  rise/set and batch computation; health and authenticated version endpoints.
- Loopback defaults, shared-secret authentication, input limits, tagged numeric
  encoding, sliced computation and cancellation on disconnect.
- Explicit EPHE_PATH for tests; no dependency on another application's checkout.
- Source URL derived from repository metadata, with SOURCE_URL override and the
  existing X-Source-Code header. Optional GIT_COMMIT/GIT_TAG identity in /version.
- Privacy cleanup of comments, fixture description and documentation; original
  numerical reference cases and test coverage retained.
- AGPL-3.0-only SPDX notices, dependency inventory, broader ignore rules and
  release/deployment instructions. History is preserved.

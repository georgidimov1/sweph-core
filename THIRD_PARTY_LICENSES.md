# Third-party licenses

Runtime dependencies (including the native binding dependency):

| Package | Locked version | License |
|---|---|---|
| sweph | 2.10.3-b-1 | (AGPL-3.0-or-later OR LGPL-3.0-or-later) |
| node-addon-api | 8.9.2 | MIT |

For sweph, this project uses the AGPL-3.0-or-later option at version 3,
compatible with this project’s AGPL-3.0-only grant. Its LGPL alternative is
not relied on. Swiss Ephemeris © Astrodienst AG is used under its AGPL option.
[Official licensing terms](https://www.astro.com/swisseph/swephinfo_e.htm#proflic).
Preserve upstream notices when redistributing dependencies, including their
bundled native sources. See `node_modules/sweph/LICENSE`, the notices in
`node_modules/sweph/swisseph/`, and `node_modules/node-addon-api/LICENSE.md`.

Development and platform-optional dependencies from package-lock.json:

| Package | Version | License |
|---|---|---|
| @emnapi/core | 2.0.0-beta.2 | MIT |
| @emnapi/runtime | 2.0.0-beta.2 | MIT |
| @emnapi/wasi-threads | 2.2.0 | MIT |
| @jridgewell/resolve-uri | 3.1.3 | MIT |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT |
| @jridgewell/trace-mapping | 0.3.31 | MIT |
| @napi-rs/wasm-runtime | 1.2.6 | MIT |
| @oxc-project/types | 0.156.0 | MIT |
| @rolldown/binding-android-arm-eabi | 1.2.19 | MIT |
| @rolldown/binding-android-arm64 | 1.2.19 | MIT |
| @rolldown/binding-darwin-arm64 | 1.2.19 | MIT |
| @rolldown/binding-darwin-x64 | 1.2.19 | MIT |
| @rolldown/binding-freebsd-x64 | 1.2.19 | MIT |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.19 | MIT |
| @rolldown/binding-linux-arm64-gnu | 1.2.19 | MIT |
| @rolldown/binding-linux-arm64-musl | 1.2.19 | MIT |
| @rolldown/binding-linux-ppc64-gnu | 1.2.19 | MIT |
| @rolldown/binding-linux-s390x-gnu | 1.2.19 | MIT |
| @rolldown/binding-linux-x64-gnu | 1.2.19 | MIT |
| @rolldown/binding-linux-x64-musl | 1.2.19 | MIT |
| @rolldown/binding-openharmony-arm64 | 1.2.19 | MIT |
| @rolldown/binding-wasm32-wasi | 1.2.19 | MIT |
| @rolldown/binding-win32-arm64-msvc | 1.2.19 | MIT |
| @rolldown/binding-win32-x64-msvc | 1.2.19 | MIT |
| @rolldown/pluginutils | 1.1.0 | MIT |
| @tybys/wasm-util | 0.10.4 | MIT |
| @types/chai | 5.2.3 | MIT |
| @types/deep-eql | 4.0.2 | MIT |
| @types/estree | 1.0.10 | MIT |
| @vitest/mocker | 5.1.0 | MIT |
| @vitest/spy | 5.1.0 | MIT |
| assertion-error | 2.0.1 | MIT |
| chai | 6.3.0 | MIT |
| detect-libc | 2.1.2 | Apache-2.0 |
| es-module-lexer | 2.3.2 | MIT |
| estree-walker | 3.0.3 | MIT |
| expect-type | 1.4.0 | Apache-2.0 |
| fdir | 6.5.0 | MIT |
| fsevents | 2.3.3 | MIT |
| lightningcss | 1.33.0 | MPL-2.0 |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 |
| magic-string | 1.4.5 | MIT |
| nanoid | 3.3.20 | MIT |
| obug | 3.0.0 | MIT |
| picocolors | 1.1.1 | ISC |
| picomatch | 4.0.7 | MIT |
| postcss | 8.5.32 | MIT |
| rolldown | 1.2.19 | MIT |
| source-map-js | 1.2.2 | BSD-3-Clause |
| std-env | 4.3.0 | MIT |
| tinybench | 6.2.3 | MIT |
| tinyexec | 1.3.1 | MIT |
| tinyglobby | 0.2.17 | MIT |
| tslib | 2.9.1 | 0BSD |
| vite | 8.3.8 | MIT |
| vitest | 5.1.0 | MIT |
| why-is-node-running | 3.2.1 | MIT |

The lockfile contains MIT, Apache-2.0, MPL-2.0, ISC, BSD-3-Clause and
0BSD packages, in addition to sweph’s dual license. These permit use with
AGPLv3; preserve their notices and any source obligations when distributing
them. MPL-2.0 remains a file-level license; no MPL source has been copied
into this project. Development tools are not runtime service dependencies.
The inventory is based on locked package metadata and installed notices,
not a claim that dependency metadata alone proves all distribution obligations.

License references: [GNU license compatibility list](https://www.gnu.org/licenses/license-list.html) and [Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/).

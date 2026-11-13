// SPDX-License-Identifier: AGPL-3.0-only
const { statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");
const data = process.env.EPHE_PATH;
let valid = false;
try { valid = !!data?.trim() && statSync(data).isDirectory(); } catch {}
if (!valid) {
  console.error("EPHE_PATH is required and must name a directory of .se1 files. Download from https://github.com/aloistr/swisseph/tree/master/ephe (see README).\nPOSIX: EPHE_PATH=/path/to/ephe npm test\nPowerShell: $env:EPHE_PATH='/path/to/ephe'; npm test");
  process.exit(1);
}
const result = spawnSync(process.execPath, [resolve(__dirname, "../node_modules/vitest/vitest.mjs"), "run", ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

// SPDX-License-Identifier: AGPL-3.0-only
// Configuration from the environment. Returns { config, errors, warnings };
// any error means the process must not start.
//
//   CORE_SECRET         required; clients send it as x-core-secret (>= 32 chars recommended)
//   EPHE_PATH           required; directory with the Swiss Ephemeris .se1 files
//   HOST                default 127.0.0.1; anything but loopback also needs
//                       CORE_ALLOW_NON_LOOPBACK=1
//   PORT                default 3010 (0 = any free port, for tests)
//   SOURCE_URL          where this service's source code is published (AGPL-3.0
//                       section 13); sent as X-Source-Code on every answer
//   MAX_BODY_BYTES      default 65536
//   LOG_REQUESTS        1 = one line per request (method, path, status, time --
//                       never the body); default off
//   COMPUTE_SLICE_MS    a large request gives the event loop a turn after
//                       this many ms of computing; default 10
const { repository } = require("../package.json");
const DEFAULT_SOURCE_URL = repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
const MIN_RECOMMENDED_SECRET_LENGTH = 32;

function readConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const secret = env.CORE_SECRET;
  if (typeof secret !== "string" || secret.trim() === "") {
    errors.push("CORE_SECRET is not set: refusing to start without a secret.");
  } else if (secret.length < MIN_RECOMMENDED_SECRET_LENGTH) {
    warnings.push(`CORE_SECRET is ${secret.length} characters; ${MIN_RECOMMENDED_SECRET_LENGTH} or more recommended.`);
  }

  const host = env.HOST && env.HOST.trim() ? env.HOST.trim() : "127.0.0.1";
  if (!LOOPBACK.has(host) && env.CORE_ALLOW_NON_LOOPBACK !== "1") {
    errors.push(`HOST=${host} is not a loopback address; sweph-core is meant for 127.0.0.1 only (set CORE_ALLOW_NON_LOOPBACK=1 to override).`);
  }

  const port = env.PORT === undefined || env.PORT === "" ? 3010 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push(`PORT=${env.PORT} is not a valid port.`);

  const maxBodyBytes = env.MAX_BODY_BYTES ? Number(env.MAX_BODY_BYTES) : 65536;
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1024) errors.push(`MAX_BODY_BYTES=${env.MAX_BODY_BYTES} must be an integer >= 1024.`);

  const sliceMs = env.COMPUTE_SLICE_MS ? Number(env.COMPUTE_SLICE_MS) : 10;
  if (!Number.isFinite(sliceMs) || sliceMs < 1 || sliceMs > 1000) errors.push(`COMPUTE_SLICE_MS=${env.COMPUTE_SLICE_MS} must be a number from 1 to 1000.`);

  const sourceUrl = env.SOURCE_URL && env.SOURCE_URL.trim() ? env.SOURCE_URL.trim() : DEFAULT_SOURCE_URL;
  if (!env.SOURCE_URL) warnings.push(`SOURCE_URL is not set; advertising ${DEFAULT_SOURCE_URL}.`);

  return {
    config: {
      secret,
      ephePath: env.EPHE_PATH,
      host,
      port,
      maxBodyBytes,
      sourceUrl,
      logRequests: env.LOG_REQUESTS === "1",
      sliceMs,
      gitCommit: env.GIT_COMMIT?.trim() || undefined,
      gitTag: env.GIT_TAG?.trim() || undefined,
    },
    errors,
    warnings,
  };
}

module.exports = { readConfig, DEFAULT_SOURCE_URL };

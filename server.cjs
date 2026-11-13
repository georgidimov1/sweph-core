// SPDX-License-Identifier: AGPL-3.0-only
// sweph-core -- raw Swiss Ephemeris computations over HTTP, for localhost.
// Copyright (C) the sweph-core authors. Licensed under the GNU Affero General
// Public License v3.0 (see LICENSE). Uses the Swiss Ephemeris by Astrodienst
// AG (AGPL-3.0 edition) through the `sweph` bindings.
//
// Start: CORE_SECRET=... EPHE_PATH=/path/to/ephe node server.cjs
// (all settings in src/config.cjs). Refuses to start on any configuration
// problem, including a missing or unusable ephemeris directory.
const http = require("node:http");
const { readConfig } = require("./src/config.cjs");
const ephemeris = require("./src/ephemeris.cjs");
const { createHandler } = require("./src/app.cjs");

function fatal(message) {
  console.error(`[sweph-core] ${message}`);
  process.exit(1);
}

const { config, errors, warnings } = readConfig();
warnings.forEach((message) => console.warn(`[sweph-core] ${message}`));
if (errors.length) fatal(errors.join(" "));

let info;
try {
  // Once, for the life of the process: never re-set per request.
  info = ephemeris.init({ ephePath: config.ephePath });
} catch (err) {
  fatal(err.message);
}

const server = http.createServer(
  {
    keepAlive: true,
    keepAliveTimeout: 65_000,
    headersTimeout: 10_000,
    requestTimeout: 30_000,
  },
  createHandler(config),
);

server.on("clientError", (err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n");
});

server.listen(config.port, config.host, () => {
  const { address, port } = server.address();
  console.log(
    `[sweph-core] listening on http://${address.includes(":") ? `[${address}]` : address}:${port} ` +
      `(Swiss Ephemeris ${info.swissEphemeris}, ${info.files} ephemeris files)`,
  );
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}

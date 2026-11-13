// SPDX-License-Identifier: AGPL-3.0-only
// Starts the real server (node server.cjs) as a child process on a free port.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const { encode, decode } = require("../src/codec.cjs");

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

// Tests require an explicit directory of Swiss Ephemeris data files.
export const EPHE_PATH = process.env.EPHE_PATH;
if (!EPHE_PATH || !existsSync(EPHE_PATH)) {
  throw new Error(`Ephemeris files not found at ${EPHE_PATH}; set EPHE_PATH to a directory containing .se1 files from https://github.com/aloistr/swisseph/tree/master/ephe`);
}

// Runs server.cjs with `env` on top of a valid default configuration.
// -> { url, secret, child, output(), stop() }, or rejects with the output if
// it exits before listening.
export function startServer(env = {}) {
  const secret = randomBytes(24).toString("hex");
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: ROOT,
    env: { ...process.env, CORE_SECRET: secret, EPHE_PATH, HOST: "127.0.0.1", PORT: "0", SOURCE_URL: "https://example.invalid/sweph-core", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      output += chunk;
      const match = /listening on (http:\/\/\S+)/.exec(output);
      if (match) {
        resolve({
          url: match[1],
          secret: env.CORE_SECRET ?? secret,
          child,
          output: () => output,
          stop: () =>
            new Promise((done) => {
              if (child.exitCode !== null || child.signalCode !== null) return done();
              child.once("exit", done);
              child.kill();
            }),
        });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => reject(Object.assign(new Error(`exited with ${code}: ${output}`), { code, output })));
  });
}

// Runs server.cjs expecting it to refuse to start. -> { code, output }
export function expectStartupFailure(env) {
  return startServer(env).then(
    async (server) => {
      await server.stop();
      throw new Error(`server started although it should not have:\n${server.output()}`);
    },
    (err) => ({ code: err.code, output: err.output }),
  );
}

// POST JSON (codec-encoded) and decode the answer.
export async function post(server, path, body, { secret = server.secret, headers = {} } = {}) {
  const res = await fetch(server.url + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(secret === null ? {} : { "x-core-secret": secret }), ...headers },
    body: typeof body === "string" ? body : encode(body),
  });
  return { status: res.status, headers: res.headers, body: decode(await res.text()) };
}

// Deep equality where every number must be the same double (Object.is).
export function sameBits(a, b, path = "$") {
  if (typeof a === "number" || typeof b === "number") {
    if (!Object.is(a, b)) throw new Error(`${path}: ${a} !== ${b}`);
    return;
  }
  if (a === null || b === null || typeof a !== "object") {
    if (a !== b) throw new Error(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.join() !== kb.join()) throw new Error(`${path}: keys ${ka} !== ${kb}`);
  for (const key of ka) sameBits(a[key], b[key], `${path}.${key}`);
}

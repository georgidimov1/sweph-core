// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { startServer, post, decode, sameBits } from "./helpers.mjs";

// Swiss Ephemeris reference calls with their results/errors. Answers must match
// identically: same doubles, same keys in the same order, same error type,
// code and message. Each call goes through its own endpoint (batches through
// /v1/batch), so the routes' argument mapping is covered too.
//
// Bit for bit on the platform the fixture was recorded on (meta.platform).
// Elsewhere Swiss Ephemeris is built by another compiler and differs in the
// last bits -- measured win32-x64 vs linux-x64: positions, houses and angles
// <= 1.2e-13, speeds (computed numerically) <= 1.5e-8 deg/day -- so there
// numbers must agree within 1e-9, speeds within 1e-7, and strings, keys and
// errors exactly.
const fixture = decode(readFileSync(new URL("./fixtures/parity-7a.json", import.meta.url), "utf8"));
const HERE = `${process.platform}-${process.arch}`;
const SAME_PLATFORM = fixture.meta.platform === HERE;
const SPEED_KEYS = new Set(["longitudeSpeed", "latitudeSpeed", "distanceSpeed"]);
const crossPlatform = { numbers: 0, inexact: 0, maxDiff: 0, maxSpeedDiff: 0 };

function closeEnough(actual, expected, path = "$", key = "") {
  if (typeof expected === "number" || typeof actual === "number") {
    crossPlatform.numbers++;
    if (Object.is(actual, expected)) return;
    const diff = Math.abs(actual - expected);
    const speed = SPEED_KEYS.has(key);
    crossPlatform.inexact++;
    if (speed) crossPlatform.maxSpeedDiff = Math.max(crossPlatform.maxSpeedDiff, diff);
    else crossPlatform.maxDiff = Math.max(crossPlatform.maxDiff, diff);
    if (!(diff <= (speed ? 1e-7 : 1e-9))) throw new Error(`${path}: ${actual} vs ${expected}`);
    return;
  }
  if (actual === null || expected === null || typeof expected !== "object") {
    expect(actual, path).toBe(expected);
    return;
  }
  expect(Object.keys(actual), path).toEqual(Object.keys(expected));
  for (const k of Object.keys(expected)) closeEnough(actual[k], expected[k], `${path}.${k}`, Array.isArray(expected) ? key : k);
}

// fn + args -> [endpoint, body]
const ENDPOINTS = {
  positions: (args) => ["/v1/calc", args[0]],
  houses: (args) => ["/v1/houses", args[0]],
  chart: (args) => ["/v1/chart", args[0]],
  julianDay: (args) => ["/v1/julday", args[0]],
  julianDays: (args) => ["/v1/julday", { dates: args[0] }],
  isValidDate: (args) => ["/v1/date/valid", args[0]],
  calendarDate: ([jd, options = {}]) => ["/v1/revjul", { jd, ...options }],
  deltaT: ([jd]) => ["/v1/deltat", { jd }],
  sunCrossing: (args) => ["/v1/sun-crossing", args[0]],
  nextSolarEclipseGlobal: (args) => ["/v1/eclipse/solar/global", args[0]],
  nextSolarEclipseLocal: (args) => ["/v1/eclipse/solar/local", args[0]],
  nextLunarEclipse: (args) => ["/v1/eclipse/lunar/next", args[0]],
  lunarEclipseAt: (args) => ["/v1/eclipse/lunar/at", args[0]],
  riseSet: (args) => ["/v1/rise-set", args[0]],
  // No endpoint of its own: through /v1/batch.
  position: (args) => ["/v1/batch", { calls: [{ fn: "position", args }] }],
  batch: (args) => ["/v1/batch", { calls: args[0] }],
};

let server;
beforeAll(async () => {
  server = await startServer();
});
afterAll(async () => {
  await server?.stop();
  if (!SAME_PLATFORM) {
    console.log(
      `[parity-7a] fixture from ${fixture.meta.platform}, running on ${HERE}: ${crossPlatform.inexact}/${crossPlatform.numbers} numbers not bit-identical, ` +
        `max diff ${crossPlatform.maxDiff} (speeds ${crossPlatform.maxSpeedDiff})`,
    );
  }
});

test("the fixture covers the reference computation functions", () => {
  expect(fixture.calls.length).toBeGreaterThan(100);
  const fns = new Set(fixture.calls.map((c) => c.fn));
  for (const fn of ["positions", "chart", "julianDay", "julianDays", "isValidDate", "calendarDate", "deltaT", "batch", "nextLunarEclipse", "nextSolarEclipseLocal", "nextSolarEclipseGlobal", "lunarEclipseAt"]) {
    expect(fns.has(fn), fn).toBe(true);
  }
  expect(fixture.calls.some((c) => c.error)).toBe(true);
});

test.each(fixture.calls.map((call, i) => [i, call.fn, call]))("call #%i (%s) answers exactly as in 7a", async (_i, fn, call) => {
  const [path, body] = ENDPOINTS[fn](call.args);
  const { status, body: answer } = await post(server, path, body);
  const result = fn === "position" ? answer.result?.[0] : answer.result;

  if (call.error) {
    expect(status).toBe(422);
    expect(answer.error).toEqual(call.error);
  } else {
    expect(status).toBe(200);
    if (SAME_PLATFORM) sameBits(result, call.result);
    else closeEnough(result, call.result);
  }
});

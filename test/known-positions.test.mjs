// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, beforeAll, afterAll } from "vitest";
import { startServer, post } from "./helpers.mjs";

// Sanity against published values (not just against ourselves).
let server;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server?.stop());

const result = async (path, body) => {
  const res = await post(server, path, body);
  expect(res.status).toBe(200);
  return res.body.result;
};

const isoOf = async (jd, timescale) => {
  const { year, month, day, hour, minute, second } = await result("/v1/revjul", { jd, timescale });
  return new Date(Date.UTC(year, month - 1, day, hour, minute, Math.floor(second))).toISOString().slice(0, 19);
};

test("J2000.0: apparent Sun 280.37 deg, Moon 223.315 deg (Astronomical Almanac 2000)", async () => {
  const [{ bodies }] = await result("/v1/calc", { moments: [2451545], timescale: "et", bodies: ["Sun", "Moon"] });
  expect(bodies.Sun.longitude).toBeCloseTo(280.37, 2);
  expect(bodies.Moon.longitude).toBeCloseTo(223.315, 2);
  expect(bodies.Sun.distance).toBeCloseTo(0.9833, 4);
});

test("March equinox 2026: 2026-03-20 14:46 UTC (USNO)", async () => {
  const start = (await result("/v1/julday", { year: 2026, month: 3, day: 18 })).jdEt;
  const jd = await result("/v1/sun-crossing", { longitude: 0, jd: start, timescale: "et" });
  expect(await isoOf(jd, "et")).toMatch(/^2026-03-20T14:4[56]/);
});

test("Total solar eclipse 2024-04-08, greatest eclipse 18:17 UT (NASA)", async () => {
  const start = (await result("/v1/julday", { year: 2024, month: 4, day: 1 })).jdUt;
  const eclipse = await result("/v1/eclipse/solar/global", { jdUt: start });
  expect(eclipse.type).toBe("total");
  expect(await isoOf(eclipse.maximumJdUt, "ut")).toMatch(/^2024-04-08T18:1[67]/);
});

test("Total lunar eclipse 2026-03-03, maximum 11:33 UT (NASA)", async () => {
  const start = (await result("/v1/julday", { year: 2026, month: 2, day: 20 })).jdUt;
  const eclipse = await result("/v1/eclipse/lunar/next", { jdUt: start });
  expect(eclipse.type).toBe("total");
  expect(await isoOf(eclipse.maximumJdUt, "ut")).toMatch(/^2026-03-03T11:3[34]/);
  expect(Object.keys(eclipse.contacts)).toEqual(["penumbralStart", "partialStart", "totalStart", "maximum", "totalEnd", "partialEnd", "penumbralEnd"]);
});

test("Mercury is retrograde on 2026-03-01 and direct on 2026-04-01", async () => {
  const [{ jdEt: a }, { jdEt: b }] = await result("/v1/julday", { dates: [{ year: 2026, month: 3, day: 1 }, { year: 2026, month: 4, day: 1 }] });
  const [march, april] = await result("/v1/calc", { moments: [a, b], timescale: "et", bodies: ["Mercury"] });
  expect(march.bodies.Mercury.retrograde).toBe(true);
  expect(april.bodies.Mercury.retrograde).toBe(false);
});

test("midnight sun: no sunset at Longyearbyen on 2026-06-21 -> null", async () => {
  const { jdUt } = await result("/v1/julday", { year: 2026, month: 6, day: 21 });
  expect(await result("/v1/rise-set", { jdUt, event: "set", observer: { longitude: 15.65, latitude: 78.22 } })).toBeNull();
});

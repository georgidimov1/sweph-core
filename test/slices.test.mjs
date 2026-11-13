// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
import { startServer, post, sameBits, EPHE_PATH } from "./helpers.mjs";

// Large requests are computed in slices with the event loop free in between
// (batchInSlices in src/ephemeris.cjs): the result is exactly batch()'s, a
// small request is answered while a large one is still computing, and two
// large topocentric requests for different observers, interleaved slice by
// slice, still get exactly their own numbers.
const require = createRequire(import.meta.url);
const ephemeris = require("../src/ephemeris.cjs");
ephemeris.init({ ephePath: EPHE_PATH });

const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
  "NNode", "TrueNode", "Lilith", "OscuLilith", "Chiron", "Pholus", "Ceres", "Pallas", "Juno", "Vesta"];
const SOFIA = { longitude: 23.32, latitude: 42.7, elevation: 550 };
const SYDNEY = { longitude: 151.21, latitude: -33.87, elevation: 20 };
const moments = (n, start = 2461000.5) => Array.from({ length: n }, (_, i) => start + i * 0.25);

let server;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server?.stop());

test("batchInSlices gives exactly batch()'s result: split positions, many small calls, mixed", async () => {
  const cases = [
    [{ fn: "positions", args: [{ moments: moments(2000), bodies: BODIES, timescale: "et" }] }],
    [{ fn: "positions", args: [{ moments: moments(300), bodies: ["Moon", "Sun"], timescale: "et", observer: SOFIA }] }],
    Array.from({ length: 200 }, (_, i) => ({ fn: "nextSolarEclipseGlobal", args: [{ jdUt: 2461000.5 + i * 30 }] })),
    [
      { fn: "deltaT", args: [2461000.5] },
      { fn: "positions", args: [{ moments: moments(150), bodies: BODIES.slice(0, 10) }] },
      { fn: "riseSet", args: [{ jdUt: 2461000.5, event: "rise", observer: SOFIA }] },
      { fn: "positions", args: [{ moments: moments(40), bodies: ["Moon"], observer: SYDNEY }] },
      { fn: "calendarDate", args: [2461000.5, { timescale: "et" }] },
    ],
  ];

  for (const calls of cases) {
    sameBits(await ephemeris.batchInSlices(calls, { sliceMs: 1 }), ephemeris.batch(calls));
  }
});

test("batchInSlices throws batch()'s first error, also from the middle of a split positions call", async () => {
  // Chiron's ephemeris ends at JD 3419437.5: the 2nd chunk of moments is out of range.
  const late = Array.from({ length: 30 }, (_, i) => 3419430.5 + i);
  const calls = [{ fn: "deltaT", args: [2461000.5] }, { fn: "positions", args: [{ moments: late, bodies: ["Sun", "Chiron"], timescale: "et" }] }];

  let expected;
  try {
    ephemeris.batch(calls);
  } catch (err) {
    expected = err;
  }
  expect(expected).toBeDefined();
  await expect(ephemeris.batchInSlices(calls, { sliceMs: 1 })).rejects.toMatchObject({ code: expected.code, message: expected.message });
});

test("encodeResultInSlices writes exactly encode({ result }), NaN/Infinity/-0 included", async () => {
  const { encode, encodeResultInSlices } = require("../src/codec.cjs");
  const big = ephemeris.batch([{ fn: "positions", args: [{ moments: moments(500), bodies: BODIES, timescale: "et" }] }]);
  const results = [
    big,
    big[0],
    [1, NaN, -0, Infinity, -Infinity, null, "x", [2, [NaN]], { a: -0 }],
    [],
    [[]],
    { jdUt: 1, jdEt: 2 },
    0.1,
    null,
    false,
    [undefined, 1],
  ];
  for (const result of results) {
    expect(await encodeResultInSlices(result, { sliceMs: 1 })).toBe(encode({ result }));
  }
});

test("a client gone mid-computation stops the rest (ComputationCancelled)", async () => {
  let units = 0;
  const calls = Array.from({ length: 100 }, (_, i) => ({ fn: "nextSolarEclipseGlobal", args: [{ jdUt: 2461000.5 + i * 30 }] }));
  await expect(
    ephemeris.batchInSlices(calls, {
      sliceMs: 1,
      isCancelled: () => ++units > 1,
    }),
  ).rejects.toBeInstanceOf(ephemeris.ComputationCancelled);
});

test("over HTTP: a small request is answered while a large one (~1.5 s, topocentric) is computing", async () => {
  const large = post(server, "/v1/calc", { moments: moments(2000), bodies: BODIES, timescale: "et", observer: SOFIA });

  await new Promise((r) => setTimeout(r, 50)); // the large one has started
  const startedAt = performance.now();
  const small = await post(server, "/v1/deltat", { jd: 2461000.5 });
  const smallMs = performance.now() - startedAt;
  const health = await fetch(`${server.url}/health`);

  expect(small.status).toBe(200);
  expect(health.status).toBe(200);
  expect((await large).status).toBe(200);
  // Without slicing it would wait for the large one (well over a second).
  expect(smallMs).toBeLessThan(200);
});

test("over HTTP: two large topocentric requests for different observers, interleaved, each get exactly their own positions", async () => {
  const request = (observer) => ({ moments: moments(600), bodies: ["Moon", "Sun", "Mars"], timescale: "et", observer });
  const expected = {
    sofia: ephemeris.positions(request(SOFIA)),
    sydney: ephemeris.positions(request(SYDNEY)),
  };

  const [sofia, sydney] = await Promise.all([post(server, "/v1/calc", request(SOFIA)), post(server, "/v1/calc", request(SYDNEY))]);
  sameBits(sofia.body.result, expected.sofia);
  sameBits(sydney.body.result, expected.sydney);
});

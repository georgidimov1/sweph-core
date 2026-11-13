// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect, beforeAll, afterAll } from "vitest";
import { startServer, post, sameBits } from "./helpers.mjs";

// Swiss Ephemeris keeps the topocentric observer in global state (set_topo).
// sweph-core sets it and computes in one synchronous run per request, so
// concurrent requests for different observers must never see each other's.
// Also covers the calls that set it internally (rise/set, local eclipses).
let server;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server?.stop());

const OBSERVERS = {
  sofia: { longitude: 23.32, latitude: 42.7, elevation: 550 },
  sydney: { longitude: 151.21, latitude: -33.87, elevation: 20 },
  tromso: { longitude: 18.96, latitude: 69.65, elevation: 10 },
};
const MOMENTS = [2461087.0008, 2461087.25, 2461087.5];

const topocentric = (observer) => ({ moments: MOMENTS, timescale: "et", bodies: ["Moon", "Sun"], observer });

test("parallel requests for different observers get exactly their own topocentric positions", async () => {
  // References, one at a time.
  const reference = {};
  for (const [name, observer] of Object.entries(OBSERVERS)) {
    reference[name] = (await post(server, "/v1/calc", topocentric(observer))).body.result;
  }

  // The observers must actually differ (the Moon's parallax is ~1 degree).
  expect(Math.abs(reference.sofia[0].bodies.Moon.longitude - reference.sydney[0].bodies.Moon.longitude)).toBeGreaterThan(0.1);

  // 150 interleaved requests in flight at once, mixed with calls that set the
  // observer internally (rise/set, local eclipse search) and geocentric ones.
  const names = Object.keys(OBSERVERS);
  const requests = [];
  for (let i = 0; i < 150; i++) {
    const name = names[i % names.length];
    requests.push(post(server, "/v1/calc", topocentric(OBSERVERS[name])).then((res) => ({ name, res })));
    if (i % 10 === 0) {
      requests.push(post(server, "/v1/rise-set", { jdUt: 2461087, event: "rise", observer: OBSERVERS[names[(i + 1) % 3]] }).then(() => null));
      requests.push(post(server, "/v1/eclipse/solar/local", { jdUt: 2461087, observer: OBSERVERS[names[(i + 2) % 3]] }).then(() => null));
      requests.push(post(server, "/v1/calc", { moments: MOMENTS, bodies: ["Moon"] }).then(() => null));
    }
  }

  for (const outcome of await Promise.all(requests)) {
    if (outcome === null) continue;
    expect(outcome.res.status).toBe(200);
    sameBits(outcome.res.body.result, reference[outcome.name]);
  }
});

test("a batch mixing observers keeps each call's own observer", async () => {
  const calls = Object.values(OBSERVERS).map((observer) => ({ fn: "positions", args: [topocentric(observer)] }));
  const { body } = await post(server, "/v1/batch", { calls: [...calls, ...calls.reverse()] });
  const separate = [];
  for (const call of [...calls].reverse()) separate.push((await post(server, "/v1/calc", call.args[0])).body.result);

  sameBits(body.result.slice(0, 3), separate);
  sameBits(body.result.slice(3), [...separate].reverse());
});

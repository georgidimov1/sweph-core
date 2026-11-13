// SPDX-License-Identifier: AGPL-3.0-only
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const { readConfig, DEFAULT_SOURCE_URL } = require("../src/config.cjs");
import { startServer, post } from "./helpers.mjs";

// The HTTP contract: auth, headers, limits, validation, error format.
let server;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server?.stop());

const J2000 = 2451545;
const calc = (body, options) => post(server, "/v1/calc", body, options);

describe("health, version, headers", () => {
  test("GET /health needs no secret and computes nothing", async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("every answer: JSON, no-store, X-Source-Code, no CORS", async () => {
    for (const res of [
      await fetch(`${server.url}/health`),
      await fetch(`${server.url}/v1/calc`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }),
    ]) {
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-source-code")).toBe("https://example.invalid/sweph-core");
      expect([...res.headers.keys()].filter((h) => h.startsWith("access-control-"))).toEqual([]);
    }
  });

  test("GET /version: service, Swiss Ephemeris and ephemeris files -- never the path", async () => {
    const res = await fetch(`${server.url}/version`, { headers: { "x-core-secret": server.secret } });
    const { result } = await res.json();
    expect(res.status).toBe(200);
    expect(result.service).toMatchObject({ name: "sweph-core", license: "AGPL-3.0-only", version: pkg.version });
    expect(result.ephemeris.swissEphemeris).toMatch(/^2\.\d+/);
    expect(result.ephemeris.files).toBeGreaterThan(3);
    expect(result.ephemeris.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/ephemeris[\\/]|[A-Z]:\\|\/home\/|\/opt\//);
  });
});

describe("authentication", () => {
  test("no secret -> 401", async () => {
    const { status, body } = await calc({ moments: [J2000], bodies: ["Sun"] }, { secret: null });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("wrong secret (also: same length, a prefix, a longer one) -> 401", async () => {
    for (const secret of ["nope", "x".repeat(server.secret.length), server.secret.slice(0, -1), `${server.secret}x`]) {
      expect((await calc({ moments: [J2000], bodies: ["Sun"] }, { secret })).status).toBe(401);
    }
  });

  test("/version needs the secret too", async () => {
    expect((await fetch(`${server.url}/version`)).status).toBe(401);
  });
});

describe("protocol errors", () => {
  test("unknown path 404, wrong method 405, not JSON 415, malformed JSON 400", async () => {
    expect((await post(server, "/v1/nope", {})).status).toBe(404);
    expect((await fetch(`${server.url}/v1/calc`, { headers: { "x-core-secret": server.secret } })).status).toBe(405);
    expect((await post(server, "/v1/calc", "moments=1", { headers: { "content-type": "text/plain" } })).status).toBe(415);
    const malformed = await post(server, "/v1/calc", "{not json");
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("INVALID_REQUEST");
  });

  test("a body over 64 KB -> 413, declared or streamed", async () => {
    const big = JSON.stringify({ moments: new Array(9000).fill(J2000), bodies: ["Sun"] });
    expect(big.length).toBeGreaterThan(65536);
    const declared = await post(server, "/v1/calc", big);
    expect(declared.status).toBe(413);
    expect(declared.body.error.code).toBe("PAYLOAD_TOO_LARGE");

    // Chunked, no content-length.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const res = await fetch(`${server.url}/v1/calc`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-core-secret": server.secret },
      body: stream,
      duplex: "half",
    });
    expect(res.status).toBe(413);
  });

  test("size limits: 2000 moments, 20 bodies, batch cost", async () => {
    expect((await calc({ moments: new Array(2000).fill(J2000), bodies: ["Sun"] })).status).toBe(200);
    expect((await calc({ moments: new Array(2001).fill(J2000), bodies: ["Sun"] })).status).toBe(400);
    expect((await calc({ moments: [J2000], bodies: [...new Array(21)].map(() => "Sun") })).status).toBe(400);

    const calls = new Array(25).fill({ fn: "positions", args: [{ moments: new Array(100).fill(J2000), bodies: ["Sun", "Moon", "Mars", "Venus", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto", "Mercury", "Chiron", "Ceres", "NNode", "Lilith", "TrueNode", "Pholus", "Pallas"] }] });
    const tooMuch = await post(server, "/v1/batch", { calls });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/too large/);
  });
});

describe("validation: 400 INVALID_REQUEST before anything is computed", () => {
  const cases = [
    ["NaN moment", "/v1/calc", { moments: [NaN], bodies: ["Sun"] }],
    ["Infinity moment", "/v1/calc", { moments: [Infinity], bodies: ["Sun"] }],
    ["string moment", "/v1/calc", { moments: ["2451545"], bodies: ["Sun"] }],
    ["JD beyond any ephemeris file", "/v1/calc", { moments: [1e9], bodies: ["Sun"] }],
    ["unknown body", "/v1/calc", { moments: [J2000], bodies: ["Vulcan"] }],
    ["repeated body", "/v1/calc", { moments: [J2000], bodies: ["Sun", "Sun"] }],
    ["unknown field", "/v1/calc", { moments: [J2000], bodies: ["Sun"], ayanamsa: 1 }],
    ["sidereal zodiac", "/v1/calc", { moments: [J2000], bodies: ["Sun"], zodiac: "sidereal" }],
    ["unknown time scale", "/v1/calc", { moments: [J2000], bodies: ["Sun"], timescale: "tai" }],
    ["observer latitude 91", "/v1/calc", { moments: [J2000], bodies: ["Moon"], observer: { longitude: 0, latitude: 91 } }],
    ["latitude 90.5", "/v1/houses", { jdUt: J2000, latitude: 90.5, longitude: 0, system: "P" }],
    ["longitude 181", "/v1/houses", { jdUt: J2000, latitude: 0, longitude: 181, system: "P" }],
    ["unknown house system", "/v1/houses", { jdUt: J2000, latitude: 0, longitude: 0, system: "G" }],
    ["fractional hour", "/v1/julday", { year: 2026, month: 1, day: 1, hour: 1.5 }],
    ["month 13", "/v1/julday", { year: 2026, month: 13, day: 1 }],
    ["year 20000", "/v1/julday", { year: 20000, month: 1, day: 1 }],
    ["unknown calendar", "/v1/julday", { year: 2026, month: 1, day: 1, calendar: "hebrew" }],
    ["unknown rise/set event", "/v1/rise-set", { jdUt: J2000, event: "transit", observer: { longitude: 0, latitude: 0 } }],
    ["unknown batch function", "/v1/batch", { calls: [{ fn: "set_ephe_path", args: ["/tmp"] }] }],
    ["array body", "/v1/houses", [1, 2]],
  ];

  test.each(cases)("%s", async (_name, path, body) => {
    const { status, body: answer } = await post(server, path, body);
    expect(status).toBe(400);
    expect(answer).toMatchObject({ error: { type: "InvalidRequestError", code: "INVALID_REQUEST" } });
  });
});

describe("computation errors: our types, Swiss Ephemeris' message verbatim", () => {
  test("Chiron before 675 -> 422 OUT_OF_RANGE", async () => {
    const { status, body } = await calc({ moments: [1967000], bodies: ["Sun", "Chiron"] });
    expect(status).toBe(422);
    expect(body).toEqual({
      error: { type: "OutOfRangeError", code: "OUT_OF_RANGE", message: "Chiron's ephemeris is restricted to JD 1967601.5 - JD 3419437.5" },
    });
  });

  test("30 February -> 422 INVALID_DATE", async () => {
    const { status, body } = await post(server, "/v1/julday", { year: 2026, month: 2, day: 30 });
    expect(status).toBe(422);
    expect(body.error).toEqual({ type: "InvalidDateError", code: "INVALID_DATE", message: "invalid date: year = 2026, month = 2, day = 30" });
  });

  test("inside the polar circle Placidus falls back to Porphyry: a normal 200 result", async () => {
    const { status, body } = await post(server, "/v1/houses", { jdUt: 2461395, latitude: 69.65, longitude: 18.96, system: "P" });
    expect(status).toBe(200);
    expect(body.result).toMatchObject({ system: "P", systemUsed: "O", fallbackReason: "within polar circle, switched to Porphyry" });
    expect(body.result.cusps).toHaveLength(12);
  });

  test("isValidDate answers false (not an error) for any integers, like the local implementation", async () => {
    expect((await post(server, "/v1/date/valid", { year: 1100, month: 13, day: 1, calendar: "julian" })).body).toEqual({ result: false });
    expect((await post(server, "/v1/date/valid", { year: 1100, month: 2, day: 29, calendar: "julian" })).body).toEqual({ result: true });
  });
});

describe("shapes", () => {
  test("/v1/chart = julianDay + positions (ET) + houses (UT) in one call", async () => {
    const date = { year: 2026, month: 2, day: 15, hour: 12, minute: 0, second: 0, calendar: "gregorian" };
    const { body } = await post(server, "/v1/chart", { date, bodies: ["Sun", "Moon"], latitude: 42.7, longitude: 23.32, system: "W" });
    const { result: jd } = (await post(server, "/v1/julday", date)).body;
    const { result: [positions] } = (await calc({ moments: [jd.jdEt], timescale: "et", bodies: ["Sun", "Moon"] })).body;
    const { result: houses } = (await post(server, "/v1/houses", { jdUt: jd.jdUt, latitude: 42.7, longitude: 23.32, system: "W" })).body;

    expect(body.result).toEqual({ jdUt: jd.jdUt, jdEt: jd.jdEt, bodies: positions.bodies, houses });
    expect(Object.keys(houses.angles)).toEqual(["ascendant", "mc", "armc", "vertex", "equatorialAscendant", "coAscendantKoch", "coAscendantMunkasey", "polarAscendant"]);
  });

  test("/v1/batch answers in order and fails with the first error, like separate calls", async () => {
    const ok = await post(server, "/v1/batch", { calls: [{ fn: "deltaT", args: [J2000] }, { fn: "julianDays", args: [[{ year: 2000, month: 1, day: 1, hour: 12 }]] }] });
    expect(ok.status).toBe(200);
    expect(ok.body.result).toHaveLength(2);

    const failing = await post(server, "/v1/batch", { calls: [{ fn: "deltaT", args: [J2000] }, { fn: "julianDay", args: [{ year: 2026, month: 2, day: 30 }] }] });
    expect(failing.status).toBe(422);
    expect(failing.body.error.code).toBe("INVALID_DATE");
  });

  test("numbers JSON can't carry travel tagged: NaN angles at the pole stay NaN, not null", async () => {
    const { body, status } = await post(server, "/v1/houses", { jdUt: 2461087, latitude: -90, longitude: 0, system: "P" });
    expect(status).toBe(200);
    const values = [...Object.values(body.result.angles), ...body.result.cusps];
    expect(values.every((v) => typeof v === "number")).toBe(true);
  });
});


test("source address follows package metadata and supports an override", () => {
  expect(DEFAULT_SOURCE_URL).toBe(pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""));
  expect(readConfig({ CORE_SECRET: "test", SOURCE_URL: "https://example.invalid/modified" }).config.sourceUrl).toBe("https://example.invalid/modified");
});

test("version reports supplied build identity without changing existing fields", async () => {
  const instance = await startServer({ GIT_COMMIT: "0123456789abcdef", GIT_TAG: "v1.0.0" });
  try {
    const response = await fetch(`${instance.url}/version`, { headers: { "x-core-secret": instance.secret } });
    const { result } = await response.json();
    expect(result.service).toMatchObject({ version: pkg.version, gitCommit: "0123456789abcdef", gitTag: "v1.0.0" });
    expect(result).toHaveProperty("sweph");
    expect(result).toHaveProperty("ephemeris");
  } finally { await instance.stop(); }
  const noBuild = await startServer({ GIT_COMMIT: "", GIT_TAG: "" });
  try {
    const response = await fetch(`${noBuild.url}/version`, { headers: { "x-core-secret": noBuild.secret } });
    const { result } = await response.json();
    expect(result.service).not.toHaveProperty("gitCommit");
    expect(result.service).not.toHaveProperty("gitTag");
  } finally { await noBuild.stop(); }
});

// SPDX-License-Identifier: AGPL-3.0-only
// sweph-core's HTTP layer (plain node:http, no framework).
//
//   GET  /health                 liveness, no secret, no computation
//   GET  /version                service / Swiss Ephemeris / ephemeris files
//   POST /v1/calc                positions        (moments x bodies)
//   POST /v1/houses              houses
//   POST /v1/chart               julianDay + positions (ET) + houses (UT) in one call
//   POST /v1/julday              julianDay(date) | julianDays({ dates })
//   POST /v1/revjul              calendarDate({ jd, timescale, calendar })
//   POST /v1/date/valid          isValidDate
//   POST /v1/deltat              deltaT({ jd })
//   POST /v1/sun-crossing        sunCrossing
//   POST /v1/eclipse/solar/global, /v1/eclipse/solar/local,
//        /v1/eclipse/lunar/next,   /v1/eclipse/lunar/at
//   POST /v1/rise-set            riseSet
//   POST /v1/batch               { calls: [{ fn, args }] } -> results in order
//
// Every answer is JSON: { "result": ... } or { "error": { "type", "code",
// "message" } }, with Cache-Control: no-store, X-Source-Code and no CORS
// headers. Everything but /health needs the x-core-secret header. Numbers
// use the codec in ./codec.cjs (NaN/Infinity/-0 tagged).
//
// Each request is validated first, then computed in slices (see
// batchInSlices in ./ephemeris.cjs): the event loop is free every ~10 ms
// (COMPUTE_SLICE_MS), so a large request doesn't hold up the others. Every
// unit sets the global state it needs (the topocentric observer) and
// computes with it in one synchronous run. A client that goes away before the
// answer is ready (e.g. its timeout) stops the rest of the work.
const crypto = require("node:crypto");
const ephemeris = require("./ephemeris.cjs");
const { encode, decode, encodeResultInSlices } = require("./codec.cjs");
const { validateCall, validateBatch, checkCost } = require("./validate.cjs");
const { EphemerisError, InvalidRequestError, HTTP_STATUS_BY_CODE } = require("./errors.cjs");
const { ComputationCancelled } = ephemeris;

const SERVICE = require("../package.json");

// path -> [function name, body -> args]
const ROUTES = Object.freeze({
  "/v1/calc": ["positions", (body) => [body]],
  "/v1/houses": ["houses", (body) => [body]],
  "/v1/chart": ["chart", (body) => [body]],
  "/v1/julday": [
    (body) => (body && typeof body === "object" && "dates" in body ? "julianDays" : "julianDay"),
    (body) => ("dates" in body ? (onlyDates(body), [body.dates]) : [body]),
  ],
  "/v1/revjul": ["calendarDate", (body) => splitJd(body)],
  "/v1/date/valid": ["isValidDate", (body) => [body]],
  "/v1/deltat": ["deltaT", (body) => {
    if (Object.keys(body).some((key) => key !== "jd")) throw new InvalidRequestError('deltaT: only the field "jd" is allowed');
    return [body.jd];
  }],
  "/v1/sun-crossing": ["sunCrossing", (body) => [body]],
  "/v1/eclipse/solar/global": ["nextSolarEclipseGlobal", (body) => [body]],
  "/v1/eclipse/solar/local": ["nextSolarEclipseLocal", (body) => [body]],
  "/v1/eclipse/lunar/next": ["nextLunarEclipse", (body) => [body]],
  "/v1/eclipse/lunar/at": ["lunarEclipseAt", (body) => [body]],
  "/v1/rise-set": ["riseSet", (body) => [body]],
});

function onlyDates(body) {
  if (Object.keys(body).some((key) => key !== "dates")) throw new InvalidRequestError('julianDays: only the field "dates" is allowed');
}

function splitJd(body) {
  const { jd, ...options } = body;
  return [jd, options];
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest();

function createHandler({ secret, sourceUrl, maxBodyBytes, logRequests = false, sliceMs = 10, gitCommit, gitTag }) {
  const secretDigest = sha256(secret);

  // Fixed-length digests: timingSafeEqual without leaking the secret's length.
  const authorized = (req) => {
    const provided = req.headers["x-core-secret"];
    return typeof provided === "string" && crypto.timingSafeEqual(sha256(provided), secretDigest);
  };

  const send = (res, status, payload) => sendText(res, status, encode(payload));

  function sendText(res, status, body) {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-source-code": sourceUrl,
    });
    res.end(body);
  }

  const sendError = (res, status, type, code, message) => send(res, status, { error: { type, code, message } });

  function sendEphemerisError(res, err) {
    const status = HTTP_STATUS_BY_CODE[err.code] ?? 500;
    if (status >= 500) console.error(`[sweph-core] ${err.name} (${err.code}): ${err.message}`);
    sendError(res, status, err.name, err.code, err.message);
  }

  // Validation is synchronous (and throws before anything is computed); the
  // computation itself runs in slices.
  async function compute(path, body, isCancelled) {
    if (path === "/v1/batch") {
      checkCost(validateBatch(body));
      return ephemeris.batchInSlices(body.calls, { sliceMs, isCancelled });
    }

    const [fnOrPicker, toArgs] = ROUTES[path];
    if (body === null || typeof body !== "object" || Array.isArray(body)) throw new InvalidRequestError("request body must be a JSON object");
    const fn = typeof fnOrPicker === "function" ? fnOrPicker(body) : fnOrPicker;
    const args = toArgs(body);
    checkCost(validateCall(fn, args));
    return (await ephemeris.batchInSlices([{ fn, args }], { sliceMs, isCancelled }))[0];
  }

  // Reads the body up to maxBodyBytes; calls back with (null, text) or an error status.
  function readBody(req, res, done) {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      sendError(res, 413, "InvalidRequestError", "PAYLOAD_TOO_LARGE", `request body larger than ${maxBodyBytes} bytes`);
      req.resume();
      return;
    }

    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        aborted = true;
        sendError(res, 413, "InvalidRequestError", "PAYLOAD_TOO_LARGE", `request body larger than ${maxBodyBytes} bytes`);
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) done(Buffer.concat(chunks).toString("utf8"));
    });
  }

  return function handler(req, res) {
    const startedAt = process.hrtime.bigint();
    if (logRequests) {
      // Method, path, status and duration only -- never the body.
      res.on("finish", () => {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        console.log(`[sweph-core] ${req.method} ${req.url.split("?")[0]} ${res.statusCode} ${ms.toFixed(1)}ms`);
      });
    }

    const path = req.url.split("?")[0];

    if (path === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") return sendError(res, 405, "InvalidRequestError", "METHOD_NOT_ALLOWED", "use GET");
      return send(res, 200, { status: "ok" });
    }

    if (!authorized(req)) {
      req.resume();
      return sendError(res, 401, "AuthenticationError", "UNAUTHORIZED", "missing or wrong x-core-secret");
    }

    if (path === "/version") {
      if (req.method !== "GET") return sendError(res, 405, "InvalidRequestError", "METHOD_NOT_ALLOWED", "use GET");
      return send(res, 200, {
        result: {
          service: { name: SERVICE.name, version: SERVICE.version, license: SERVICE.license, source: sourceUrl, ...(gitCommit ? { gitCommit } : {}), ...(gitTag ? { gitTag } : {}) },
          sweph: SERVICE.dependencies.sweph,
          node: process.version,
          ephemeris: ephemeris.ephemerisInfo(),
        },
      });
    }

    if (path !== "/v1/batch" && !Object.prototype.hasOwnProperty.call(ROUTES, path)) {
      req.resume();
      return sendError(res, 404, "InvalidRequestError", "NOT_FOUND", `no endpoint ${path}`);
    }
    if (req.method !== "POST") {
      req.resume();
      return sendError(res, 405, "InvalidRequestError", "METHOD_NOT_ALLOWED", "use POST");
    }
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
      req.resume();
      return sendError(res, 415, "InvalidRequestError", "UNSUPPORTED_MEDIA_TYPE", "content-type must be application/json");
    }

    readBody(req, res, (text) => {
      let body;
      try {
        body = decode(text);
      } catch {
        return sendError(res, 400, "InvalidRequestError", "INVALID_REQUEST", "malformed JSON");
      }

      // The client is gone once the response closes before it was sent.
      let gone = false;
      res.on("close", () => {
        if (!res.writableFinished) gone = true;
      });

      // The answer is written in slices too (a large one is ~10 MB of JSON).
      compute(path, body, () => gone)
        .then((result) => encodeResultInSlices(result, { sliceMs }))
        .then(
          (text) => {
            if (!gone) sendText(res, 200, text);
          },
          (err) => {
            if (err instanceof ComputationCancelled || gone) return;
            if (err instanceof EphemerisError) return sendEphemerisError(res, err);
            console.error("[sweph-core] internal error:", err);
            sendError(res, 500, "InternalError", "INTERNAL", "internal error");
          },
        );
    });
  };
}

module.exports = { createHandler, ROUTES };

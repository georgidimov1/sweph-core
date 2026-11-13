// SPDX-License-Identifier: AGPL-3.0-only
// Error types of sweph-core. Every failure the service reports is one of
// these, sent as { "error": { "type", "code", "message" } }.
//
// `message` is Swiss Ephemeris' own text, unchanged: clients (the client application)
// rebuild the same error type with the same message, and some of those
// messages reach their users verbatim. Branch on `code`, never the message.

class EphemerisError extends Error {
  constructor(message, { code = "EPHEMERIS_ERROR", details, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.code = code;
    // Non-enumerable: available to code, never printed when logged (it can
    // contain dates and coordinates).
    if (details !== undefined) {
      Object.defineProperty(this, "details", { value: details, enumerable: false, writable: true, configurable: true });
    }
  }
}

// A calendar date/time that doesn't exist (e.g. 30 February).
class InvalidDateError extends EphemerisError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "INVALID_DATE" });
  }
}

// The moment lies outside the span a body's ephemeris covers (e.g. Chiron
// before 675 or after 4650).
class OutOfRangeError extends EphemerisError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "OUT_OF_RANGE" });
  }
}

// An ephemeris file the computation needs isn't in EPHE_PATH. Swiss
// Ephemeris would silently fall back to its lower-precision Moshier model for
// the major planets; sweph-core refuses instead.
class EphemerisFileError extends EphemerisError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "EPHEMERIS_FILE_MISSING" });
  }
}

// A house computation that failed outright. (Quadrant systems inside the
// polar circle are NOT this: Swiss Ephemeris substitutes Porphyry and the
// result says so in systemUsed/fallbackReason.)
class HouseCalculationError extends EphemerisError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "HOUSES_FAILED" });
  }
}

// A request the service won't run: malformed, out of range, unknown body /
// house system / calendar / ..., too large.
class InvalidRequestError extends EphemerisError {
  constructor(message, options = {}) {
    super(message, { ...options, code: "INVALID_REQUEST" });
  }
}

// code -> HTTP status. 4xx: the input; 5xx: the service.
const HTTP_STATUS_BY_CODE = Object.freeze({
  INVALID_REQUEST: 400,
  INVALID_DATE: 422,
  OUT_OF_RANGE: 422,
  HOUSES_FAILED: 422,
  EPHEMERIS_FILE_MISSING: 500,
  EPHEMERIS_ERROR: 500,
});

module.exports = {
  EphemerisError,
  InvalidDateError,
  OutOfRangeError,
  EphemerisFileError,
  HouseCalculationError,
  InvalidRequestError,
  HTTP_STATUS_BY_CODE,
};

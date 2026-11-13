// SPDX-License-Identifier: AGPL-3.0-only
// Strict validation of every call, before anything reaches Swiss Ephemeris.
// validateCall(fn, args) throws InvalidRequestError (-> 400) or returns the
// call's cost (body positions it will compute), which bounds a request.
//
// Rules: plain JSON objects with no unknown fields; finite numbers only (no
// NaN/Infinity, even in the tagged wire form); latitudes -90..90, longitudes
// -180..180; Julian days inside what Swiss Ephemeris files can cover at all
// (13200 BC .. AD 17191 -- whether the files for a given date are actually
// installed is then Swiss Ephemeris' call: EphemerisFileError); only known
// bodies, house systems, calendars, time scales, events.
const contract = require("./contract.cjs");
const { InvalidRequestError } = require("./errors.cjs");

const LIMITS = Object.freeze({
  maxMoments: 2000,
  maxBodies: 20,
  maxDates: 2000,
  maxBatchCalls: 1000,
  // Body positions per request (moments x bodies, summed over a batch;
  // a chart counts its bodies plus one for the houses).
  maxCost: 40000,
});

const JD_RANGE = Object.freeze({ min: -3100242.5, max: 8000308.5 }); // 13200-01-01 BC (Julian) .. 17191-12-31
const YEAR_RANGE = Object.freeze({ min: -13200, max: 17191 });

const fail = (message) => {
  throw new InvalidRequestError(message);
};

function plainObject(value, what) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${what} must be an object`);
  return value;
}

function onlyKeys(object, allowed, what) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) fail(`${what}: unknown field ${JSON.stringify(key)} (allowed: ${allowed.join(", ")})`);
  }
}

function finite(value, what, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${what} must be a finite number`);
  if (value < min || value > max) fail(`${what} must be between ${min} and ${max}`);
  return value;
}

function integer(value, what, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value)) fail(`${what} must be an integer`);
  if (value < min || value > max) fail(`${what} must be between ${min} and ${max}`);
  return value;
}

const julianDay = (value, what) => finite(value, what, JD_RANGE);
const latitude = (value, what) => finite(value, what, { min: -90, max: 90 });
const longitude = (value, what) => finite(value, what, { min: -180, max: 180 });

function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) fail(`${what} must be one of ${allowed.join(", ")}`);
  return value;
}

function optional(object, key, check) {
  if (object[key] !== undefined) check(object[key]);
}

function boolean(value, what) {
  if (typeof value !== "boolean") fail(`${what} must be true or false`);
}

function observer(value, what = "observer") {
  plainObject(value, what);
  onlyKeys(value, ["longitude", "latitude", "elevation"], what);
  longitude(value.longitude, `${what}.longitude`);
  latitude(value.latitude, `${what}.latitude`);
  optional(value, "elevation", (v) => finite(v, `${what}.elevation`, { min: -1000, max: 20000 }));
}

function bodyList(value, what = "bodies") {
  if (!Array.isArray(value)) fail(`${what} must be an array of body names`);
  if (value.length > LIMITS.maxBodies) fail(`${what}: at most ${LIMITS.maxBodies} bodies per request`);
  value.forEach((body, i) => oneOf(body, contract.BODIES, `${what}[${i}]`));
  if (new Set(value).size !== value.length) fail(`${what} must not repeat a body`);
  return value.length;
}

function date(value, what = "date") {
  plainObject(value, what);
  onlyKeys(value, ["year", "month", "day", "hour", "minute", "second", "calendar"], what);
  integer(value.year, `${what}.year`, YEAR_RANGE);
  integer(value.month, `${what}.month`, { min: 1, max: 12 });
  integer(value.day, `${what}.day`, { min: 1, max: 31 });
  optional(value, "hour", (v) => integer(v, `${what}.hour`, { min: 0, max: 23 }));
  optional(value, "minute", (v) => integer(v, `${what}.minute`, { min: 0, max: 59 }));
  // 60.x: a leap second.
  optional(value, "second", (v) => finite(v, `${what}.second`, { min: 0, max: 60.999999 }));
  optional(value, "calendar", (v) => oneOf(v, contract.CALENDARS, `${what}.calendar`));
}

const timescaleOption = (object, what) => optional(object, "timescale", (v) => oneOf(v, contract.TIMESCALES, `${what}.timescale`));
const houseSystem = (object, what) => optional(object, "system", (v) => oneOf(v, contract.HOUSE_SYSTEM_CODES, `${what}.system`));

// fn -> (args) => cost
const CHECKS = {
  positions([request]) {
    const what = "positions";
    plainObject(request, what);
    onlyKeys(request, ["moments", "bodies", "timescale", "speed", "zodiac", "observer"], what);
    if (!Array.isArray(request.moments)) fail(`${what}.moments must be an array of Julian days`);
    if (request.moments.length > LIMITS.maxMoments) fail(`${what}.moments: at most ${LIMITS.maxMoments} moments per request`);
    request.moments.forEach((jd, i) => julianDay(jd, `${what}.moments[${i}]`));
    const bodies = bodyList(request.bodies, `${what}.bodies`);
    timescaleOption(request, what);
    optional(request, "speed", (v) => boolean(v, `${what}.speed`));
    optional(request, "zodiac", (v) => oneOf(v, contract.ZODIACS, `${what}.zodiac`));
    optional(request, "observer", (v) => observer(v, `${what}.observer`));
    return request.moments.length * bodies;
  },

  position([request]) {
    const what = "position";
    plainObject(request, what);
    onlyKeys(request, ["jd", "body", "timescale", "speed", "zodiac", "observer"], what);
    julianDay(request.jd, `${what}.jd`);
    oneOf(request.body, contract.BODIES, `${what}.body`);
    timescaleOption(request, what);
    optional(request, "speed", (v) => boolean(v, `${what}.speed`));
    optional(request, "zodiac", (v) => oneOf(v, contract.ZODIACS, `${what}.zodiac`));
    optional(request, "observer", (v) => observer(v, `${what}.observer`));
    return 1;
  },

  houses([request]) {
    const what = "houses";
    plainObject(request, what);
    onlyKeys(request, ["jdUt", "latitude", "longitude", "system"], what);
    julianDay(request.jdUt, `${what}.jdUt`);
    latitude(request.latitude, `${what}.latitude`);
    longitude(request.longitude, `${what}.longitude`);
    houseSystem(request, what);
    return 1;
  },

  chart([request]) {
    const what = "chart";
    plainObject(request, what);
    onlyKeys(request, ["date", "bodies", "latitude", "longitude", "system"], what);
    date(request.date, `${what}.date`);
    const bodies = bodyList(request.bodies, `${what}.bodies`);
    latitude(request.latitude, `${what}.latitude`);
    longitude(request.longitude, `${what}.longitude`);
    houseSystem(request, what);
    return bodies + 1;
  },

  julianDay([value]) {
    date(value, "julianDay");
    return 1;
  },

  julianDays([dates]) {
    if (!Array.isArray(dates)) fail("julianDays: dates must be an array");
    if (dates.length > LIMITS.maxDates) fail(`julianDays: at most ${LIMITS.maxDates} dates per request`);
    dates.forEach((value, i) => date(value, `dates[${i}]`));
    return dates.length;
  },

  // Like the local implementation: any integers, answered true/false.
  isValidDate([request]) {
    const what = "isValidDate";
    plainObject(request, what);
    onlyKeys(request, ["year", "month", "day", "calendar"], what);
    integer(request.year, `${what}.year`);
    integer(request.month, `${what}.month`);
    integer(request.day, `${what}.day`);
    optional(request, "calendar", (v) => oneOf(v, contract.CALENDARS, `${what}.calendar`));
    return 1;
  },

  calendarDate([jd, options = {}]) {
    julianDay(jd, "calendarDate.jd");
    plainObject(options, "calendarDate options");
    onlyKeys(options, ["timescale", "calendar"], "calendarDate");
    timescaleOption(options, "calendarDate");
    optional(options, "calendar", (v) => oneOf(v, contract.CALENDARS, "calendarDate.calendar"));
    return 1;
  },

  deltaT([jd]) {
    julianDay(jd, "deltaT.jd");
    return 1;
  },

  sunCrossing([request]) {
    const what = "sunCrossing";
    plainObject(request, what);
    onlyKeys(request, ["longitude", "jd", "timescale"], what);
    finite(request.longitude, `${what}.longitude`, { min: 0, max: 360 });
    julianDay(request.jd, `${what}.jd`);
    timescaleOption(request, what);
    return 1;
  },

  nextSolarEclipseGlobal([request]) {
    return eclipseSearch(request, "nextSolarEclipseGlobal", { withObserver: false });
  },

  nextSolarEclipseLocal([request]) {
    return eclipseSearch(request, "nextSolarEclipseLocal", { withObserver: true });
  },

  nextLunarEclipse([request]) {
    return eclipseSearch(request, "nextLunarEclipse", { withObserver: false });
  },

  lunarEclipseAt([request]) {
    const what = "lunarEclipseAt";
    plainObject(request, what);
    onlyKeys(request, ["jdUt", "observer"], what);
    julianDay(request.jdUt, `${what}.jdUt`);
    observer(request.observer, `${what}.observer`);
    return 1;
  },

  riseSet([request]) {
    const what = "riseSet";
    plainObject(request, what);
    onlyKeys(request, ["jdUt", "body", "event", "observer", "disc"], what);
    julianDay(request.jdUt, `${what}.jdUt`);
    optional(request, "body", (v) => oneOf(v, contract.BODIES, `${what}.body`));
    oneOf(request.event, contract.RISE_SET_EVENTS, `${what}.event`);
    observer(request.observer, `${what}.observer`);
    optional(request, "disc", (v) => oneOf(v, contract.RISE_SET_DISCS, `${what}.disc`));
    return 1;
  },
};

function eclipseSearch(request, what, { withObserver }) {
  plainObject(request, what);
  onlyKeys(request, withObserver ? ["jdUt", "observer", "backwards"] : ["jdUt", "backwards"], what);
  julianDay(request.jdUt, `${what}.jdUt`);
  if (withObserver) observer(request.observer, `${what}.observer`);
  optional(request, "backwards", (v) => boolean(v, `${what}.backwards`));
  // An eclipse search is far heavier than one position.
  return 100;
}

function validateCall(fn, args) {
  if (!Object.prototype.hasOwnProperty.call(CHECKS, fn)) fail(`Unknown function ${JSON.stringify(fn)}`);
  if (!Array.isArray(args)) fail(`${fn}: args must be an array`);
  return CHECKS[fn](args);
}

// A batch: { calls: [{ fn, args }] }. Every call is validated before any runs.
function validateBatch(request) {
  plainObject(request, "batch");
  onlyKeys(request, ["calls"], "batch");
  if (!Array.isArray(request.calls)) fail("batch.calls must be an array of { fn, args }");
  if (request.calls.length > LIMITS.maxBatchCalls) fail(`batch: at most ${LIMITS.maxBatchCalls} calls per request`);

  let cost = 0;
  request.calls.forEach((call, i) => {
    plainObject(call, `batch.calls[${i}]`);
    onlyKeys(call, ["fn", "args"], `batch.calls[${i}]`);
    cost += validateCall(call.fn, call.args);
  });
  return cost;
}

function checkCost(cost) {
  if (cost > LIMITS.maxCost) fail(`request too large: ${cost} body positions (limit ${LIMITS.maxCost})`);
}

module.exports = { LIMITS, JD_RANGE, YEAR_RANGE, validateCall, validateBatch, checkCost };

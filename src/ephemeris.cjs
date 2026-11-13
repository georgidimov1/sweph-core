// SPDX-License-Identifier: AGPL-3.0-only
// sweph-core's computations: Swiss Ephemeris (Astrodienst, via the `sweph`
// bindings) behind plain data -- body names, house-system letters, calendar
// names, Julian days in "ut" or "et" -- and never a Swiss Ephemeris
// constant, flag or result object. Failures are the types in ./errors.cjs,
// with Swiss Ephemeris' messages verbatim. No business logic: what to do with
// the numbers is the client's business.
//
// Public functions use the input/output shapes defined by this service.
//
// Time scales: every moment is a Julian day, either in Universal Time ("ut",
// the default) or in Ephemeris/Terrestrial Time ("et"); they differ by
// delta-T. Iterative searches on the client work in ET, so both are offered
// rather than converting back and forth, which is not bit-for-bit reversible.
//
// Global state: Swiss Ephemeris keeps the ephemeris path (set once, by init())
// and the topocentric observer (set_topo) globally. Every positions() call
// sets the observer and computes in one synchronous run -- nothing can
// interleave in between on Node's single thread, so concurrent requests never
// mix observers (test/topocentric.test.mjs). swe_set_topo also discards
// Swiss Ephemeris' saved positions, so a call never reuses a position
// computed for another observer.
//
// Large requests (batchInSlices below) are run as many such self-contained
// calls, with the event loop free between slices of ~10 ms: the observer
// rule above holds for each of them.

const sweph = require("sweph");
const fs = require("node:fs");
const path = require("node:path");
const {
  EphemerisError,
  InvalidDateError,
  OutOfRangeError,
  EphemerisFileError,
  HouseCalculationError,
  InvalidRequestError,
} = require("./errors.cjs");
const contract = require("./contract.cjs");

const { constants } = sweph;


// Our body names -> Swiss Ephemeris body numbers. NNode/Lilith are the MEAN
// lunar node / mean lunar apogee (the conventional "North Node" and "Black
// Moon Lilith"); TrueNode / OscuLilith are the osculating variants.
const BODY_IDS = Object.freeze({
  Sun: constants.SE_SUN,
  Moon: constants.SE_MOON,
  Mercury: constants.SE_MERCURY,
  Venus: constants.SE_VENUS,
  Mars: constants.SE_MARS,
  Jupiter: constants.SE_JUPITER,
  Saturn: constants.SE_SATURN,
  Uranus: constants.SE_URANUS,
  Neptune: constants.SE_NEPTUNE,
  Pluto: constants.SE_PLUTO,
  NNode: constants.SE_MEAN_NODE,
  TrueNode: constants.SE_TRUE_NODE,
  Lilith: constants.SE_MEAN_APOG,
  OscuLilith: constants.SE_OSCU_APOG,
  Chiron: constants.SE_CHIRON,
  Pholus: constants.SE_PHOLUS,
  Ceres: constants.SE_CERES,
  Pallas: constants.SE_PALLAS,
  Juno: constants.SE_JUNO,
  Vesta: constants.SE_VESTA,
});
const { BODIES, HOUSE_SYSTEM_CODES, CALENDARS, TIMESCALES, ZODIACS, ANGLE_NAMES } = contract;

// Swiss Ephemeris' substitute for a quadrant system it can't compute.
const POLAR_FALLBACK_SYSTEM = "O";

const RISE_SET_EVENTS = Object.freeze({ rise: constants.SE_CALC_RISE, set: constants.SE_CALC_SET });
// upperLimb: the almanac convention (upper limb touching the refracted
// horizon); center: the centre of the disc.
const RISE_SET_DISCS = Object.freeze({ upperLimb: 0, center: constants.SE_BIT_DISC_CENTER });

// --- validation & error translation ---------------------------------------

const has = (object, key) => typeof key === "string" && Object.prototype.hasOwnProperty.call(object, key);

function oneOf(value, allowed, what) {
  if (!allowed.includes(value)) {
    throw new InvalidRequestError(`Unknown ${what} ${JSON.stringify(value)}; expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function bodyId(name) {
  if (!has(BODY_IDS, name)) {
    throw new InvalidRequestError(`Unknown body ${JSON.stringify(name)}; expected one of ${BODIES.join(", ")}`);
  }
  return BODY_IDS[name];
}

function toGeopos(observer, what = "observer") {
  if (observer === null || typeof observer !== "object") {
    throw new InvalidRequestError(`${what} must be { longitude, latitude, elevation }`);
  }
  const { longitude, latitude, elevation = 0 } = observer;
  return [longitude, latitude, elevation];
}

const calendarCode = (calendar) =>
  oneOf(calendar, CALENDARS, "calendar") === "julian" ? constants.SE_JUL_CAL : constants.SE_GREG_CAL;

// Swiss Ephemeris reports failures as a negative flag plus a message. The
// message is kept verbatim (see errors.cjs); only the type is ours.
function translateFailure(message, details) {
  if (/restricted to JD|outside .*range|out of .*range/i.test(message)) {
    return new OutOfRangeError(message, { details });
  }
  if (/not found in PATH|could not open|cannot open/i.test(message)) {
    return new EphemerisFileError(message, { details });
  }
  return new EphemerisError(message, { details });
}

function translateCalcFailure(result, iflag, details) {
  // A missing planet/moon file is not reported as an error by calc(): it
  // falls back to the Moshier model and says so only in the returned flag.
  const fellBackToMoshier =
    result.flag >= 0 && (result.flag & constants.SEFLG_MOSEPH) && !(iflag & constants.SEFLG_MOSEPH);

  return fellBackToMoshier ? new EphemerisFileError(result.error, { details }) : translateFailure(result.error, details);
}

const orNull = (jd) => (jd > 0 ? jd : null);

// --- positions --------------------------------------------------------------

// Positions of `bodies` at each of `moments` (Julian days in `timescale`).
//
//   positions({ moments: [jd, ...], bodies: ["Sun", "Moon", ...],
//               timescale: "ut" | "et" = "ut", speed = true,
//               zodiac: "tropical", observer?: { longitude, latitude, elevation } })
//   -> [{ jd, bodies: { Sun: BodyState, ... } }, ...]   (same order as moments)
//
// BodyState = { longitude, latitude, distance (AU), longitudeSpeed,
//   latitudeSpeed, distanceSpeed (per day), retrograde (longitudeSpeed < 0;
//   null when speed: false), warning ("" unless Swiss Ephemeris attached a
//   note to an otherwise successful result) }.
// Ecliptic of date, geocentric -- or topocentric for `observer` (degrees,
// metres above sea level). Longitudes are exactly as Swiss Ephemeris returns
// them (not re-normalised), so callers that normalise keep their own rounding.
function positions({ moments, bodies, timescale = "ut", speed = true, zodiac = "tropical", observer } = {}) {
  if (!Array.isArray(moments)) throw new InvalidRequestError("moments must be an array of Julian days");
  if (!Array.isArray(bodies)) throw new InvalidRequestError("bodies must be an array of body names");
  oneOf(timescale, TIMESCALES, "timescale");
  oneOf(zodiac, ZODIACS, "zodiac");

  const ids = bodies.map(bodyId);
  let iflag = constants.SEFLG_SWIEPH;
  if (speed) iflag |= constants.SEFLG_SPEED;

  if (observer !== undefined) {
    const [longitude, latitude, elevation] = toGeopos(observer);
    sweph.set_topo(longitude, latitude, elevation);
    iflag |= constants.SEFLG_TOPOCTR;
  }

  const compute = timescale === "ut" ? sweph.calc_ut : sweph.calc;

  return moments.map((jd) => {
    const states = {};

    bodies.forEach((name, i) => {
      const result = compute(jd, ids[i], iflag);

      if (result.flag !== iflag) {
        throw translateCalcFailure(result, iflag, { body: name, jd, timescale });
      }

      const [longitude, latitude, distance, longitudeSpeed, latitudeSpeed, distanceSpeed] = result.data;
      states[name] = {
        longitude,
        latitude,
        distance,
        longitudeSpeed,
        latitudeSpeed,
        distanceSpeed,
        retrograde: speed ? longitudeSpeed < 0 : null,
        warning: result.error,
      };
    });

    return { jd, bodies: states };
  });
}

// One body at one moment: position({ jd, body, ...same options }) -> BodyState.
function position({ jd, body, ...options }) {
  return positions({ ...options, moments: [jd], bodies: [body] })[0].bodies[body];
}

// --- houses -----------------------------------------------------------------

// houses({ jdUt, latitude, longitude, system: "P" | "W" | "K" | "E" | "R" | "C" | "O" | "T" = "P" })
// -> { system, systemUsed, fallbackReason, cusps: [12], cuspSpeeds: [12],
//      angles: { ascendant, mc, armc, vertex, equatorialAscendant,
//                coAscendantKoch, coAscendantMunkasey, polarAscendant },
//      angleSpeeds: { ...same keys } }
// Inside the polar circle quadrant systems have no solution for some moments;
// Swiss Ephemeris then computes Porphyry instead. That is a normal result
// here: systemUsed "O" and fallbackReason (its message), never an error.
function houses({ jdUt, latitude, longitude, system = "P" }) {
  oneOf(system, HOUSE_SYSTEM_CODES, "house system");

  const result = sweph.houses_ex2(jdUt, 0, latitude, longitude, system);
  let systemUsed = system;
  let fallbackReason = null;

  if (result.flag !== constants.OK) {
    // Every "goto porphyry" site in swehouse.c uses this wording; anything
    // else is a genuine failure.
    if (!/switched to Porphyry/i.test(result.error)) {
      throw new HouseCalculationError(result.error, { details: { jdUt, latitude, longitude, system } });
    }
    systemUsed = POLAR_FALLBACK_SYSTEM;
    fallbackReason = result.error;
  }

  const { houses: cusps, housesSpeed, points, pointsSpeed } = result.data;
  const named = (values) => Object.fromEntries(ANGLE_NAMES.map((name, i) => [name, values[i]]));

  return {
    system,
    systemUsed,
    fallbackReason,
    cusps,
    cuspSpeeds: housesSpeed,
    angles: named(points),
    angleSpeeds: named(pointsSpeed),
  };
}

// --- calendar & time ----------------------------------------------------------

// julianDay({ year, month, day, hour = 0, minute = 0, second = 0, calendar = "gregorian" })
// -> { jdUt, jdEt }. The date/time is UTC (leap seconds handled by Swiss
// Ephemeris); jdUt is UT1, which differs from UTC by under 0.9 s. Throws
// InvalidDateError for a date that doesn't exist.
function julianDay({ year, month, day, hour = 0, minute = 0, second = 0, calendar = "gregorian" }) {
  const result = sweph.utc_to_jd(year, month, day, hour, minute, second, calendarCode(calendar));

  if (result.flag !== constants.OK) {
    throw new InvalidDateError(result.error, { details: { year, month, day, hour, minute, second, calendar } });
  }

  const [jdEt, jdUt] = result.data;
  return { jdUt, jdEt };
}

const julianDays = (dates) => dates.map(julianDay);

// Whether year-month-day exists in that calendar (29 February 1100 does only
// in the Julian one).
function isValidDate({ year, month, day, calendar = "gregorian" }) {
  if (![year, month, day].every(Number.isInteger)) return false;
  const code = oneOf(calendar, CALENDARS, "calendar") === "julian" ? "j" : "g";
  return sweph.date_conversion(year, month, day, 12, code).flag === constants.OK;
}

// calendarDate(jd, { timescale = "ut", calendar = "gregorian" })
// -> { year, month, day, hour, minute, second } in UTC (second fractional).
function calendarDate(jd, { timescale = "ut", calendar = "gregorian" } = {}) {
  oneOf(timescale, TIMESCALES, "timescale");
  const code = calendarCode(calendar);
  const { year, month, day, hour, minute, second } =
    timescale === "et" ? sweph.jdet_to_utc(jd, code) : sweph.jdut1_to_utc(jd, code);
  return { year, month, day, hour, minute, second };
}

// Delta-T (ET - UT) in days at `jd`.
const deltaT = (jd) => sweph.deltat(jd);

// The next moment (Julian day in `timescale`, searching forward from `jd`)
// when the Sun's apparent longitude reaches `longitude`.
function sunCrossing({ longitude, jd, timescale = "et" }) {
  oneOf(timescale, TIMESCALES, "timescale");
  const solve = timescale === "et" ? sweph.solcross : sweph.solcross_ut;
  const result = solve(longitude, jd, constants.SEFLG_SWIEPH);

  if (result.error) throw translateFailure(result.error, { longitude, jd, timescale });
  return result.date;
}

// --- eclipses, rise/set ----------------------------------------------------------

function solarEclipseType(flag) {
  if (flag & constants.SE_ECL_ANNULAR_TOTAL) return "hybrid";
  if (flag & constants.SE_ECL_TOTAL) return "total";
  if (flag & constants.SE_ECL_ANNULAR) return "annular";
  if (flag & constants.SE_ECL_PARTIAL) return "partial";
  return null;
}

function eclipseCheck(result, details) {
  if (result.flag === constants.ERR) throw translateFailure(result.error, details);
  return result;
}

// Next solar eclipse anywhere on Earth whose maximum is after jdUt (before
// it, with backwards: true). All times UT.
// -> { maximumJdUt, beginJdUt, endJdUt, totalityBeginJdUt, totalityEndJdUt, type }
function nextSolarEclipseGlobal({ jdUt, backwards = false }) {
  // ifltype 0 = any type (expanded internally to every type bit).
  const result = eclipseCheck(
    sweph.sol_eclipse_when_glob(jdUt, constants.SEFLG_SWIEPH, 0, Boolean(backwards)),
    { jdUt, backwards },
  );
  const [maximum, , begin, end, totalityBegin, totalityEnd] = result.data;

  return {
    maximumJdUt: maximum,
    beginJdUt: orNull(begin),
    endJdUt: orNull(end),
    totalityBeginJdUt: orNull(totalityBegin),
    totalityEndJdUt: orNull(totalityEnd),
    type: solarEclipseType(result.flag),
  };
}

// Next solar eclipse with any local relevance to `observer` after jdUt. Note
// Swiss Ephemeris skips eclipses not visible there at all, and clips the
// maximum/magnitude to the horizon when the true maximum isn't visible.
// -> { maximumJdUt, firstContactJdUt, secondContactJdUt, thirdContactJdUt,
//      fourthContactJdUt, magnitude, visible, maximumVisible, type }
function nextSolarEclipseLocal({ jdUt, observer, backwards = false }) {
  const geopos = toGeopos(observer);
  const result = eclipseCheck(
    sweph.sol_eclipse_when_loc(jdUt, constants.SEFLG_SWIEPH, geopos, Boolean(backwards)),
    { jdUt, observer, backwards },
  );
  const [maximum, first, second, third, fourth] = result.data;

  return {
    maximumJdUt: maximum,
    firstContactJdUt: orNull(first),
    secondContactJdUt: orNull(second),
    thirdContactJdUt: orNull(third),
    fourthContactJdUt: orNull(fourth),
    magnitude: result.attributes[0],
    visible: Boolean(result.flag & constants.SE_ECL_VISIBLE),
    maximumVisible: Boolean(result.flag & constants.SE_ECL_MAX_VISIBLE),
    type: solarEclipseType(result.flag),
  };
}

// Next lunar eclipse (any type) whose maximum is after jdUt. Contacts are in
// chronological order, UT, null for a phase this eclipse doesn't have.
// -> { maximumJdUt, type: "total" | "partial" | "penumbral",
//      contacts: { penumbralStart, partialStart, totalStart, maximum,
//                  totalEnd, partialEnd, penumbralEnd } }
function nextLunarEclipse({ jdUt, backwards = false }) {
  const result = eclipseCheck(
    sweph.lun_eclipse_when(jdUt, constants.SEFLG_SWIEPH, 0, Boolean(backwards)),
    { jdUt, backwards },
  );
  const d = result.data;

  let type = "penumbral";
  if (result.flag & constants.SE_ECL_TOTAL) type = "total";
  else if (result.flag & constants.SE_ECL_PARTIAL) type = "partial";

  return {
    maximumJdUt: d[0],
    type,
    contacts: {
      penumbralStart: orNull(d[6]),
      partialStart: orNull(d[2]),
      totalStart: orNull(d[4]),
      maximum: orNull(d[0]),
      totalEnd: orNull(d[5]),
      partialEnd: orNull(d[3]),
      penumbralEnd: orNull(d[7]),
    },
  };
}

// Lunar eclipse circumstances at jdUt for `observer`. The magnitudes are
// geocentric (the observer only matters for the altitude); umbralMagnitude is
// 0 for a penumbral-only eclipse.
// -> { umbralMagnitude, penumbralMagnitude, moonApparentAltitude }
function lunarEclipseAt({ jdUt, observer }) {
  const result = eclipseCheck(
    sweph.lun_eclipse_how(jdUt, constants.SEFLG_SWIEPH, toGeopos(observer)),
    { jdUt, observer },
  );

  return {
    umbralMagnitude: result.data[0],
    penumbralMagnitude: result.data[1],
    moonApparentAltitude: result.data[6],
  };
}

// riseSet({ jdUt, body = "Sun", event: "rise" | "set", observer, disc: "upperLimb" | "center" = "upperLimb" })
// -> Julian day (UT) of the next such event at or after jdUt, or null when
// there is none (circumpolar body). Atmospheric refraction applied.
function riseSet({ jdUt, body = "Sun", event, observer, disc = "upperLimb" }) {
  const id = bodyId(body);
  if (!has(RISE_SET_EVENTS, event)) {
    throw new InvalidRequestError(`Unknown event ${JSON.stringify(event)}; expected rise or set`);
  }
  if (!has(RISE_SET_DISCS, disc)) {
    throw new InvalidRequestError(`Unknown disc ${JSON.stringify(disc)}; expected upperLimb or center`);
  }

  const result = sweph.rise_trans(
    jdUt,
    id,
    null,
    constants.SEFLG_SWIEPH,
    RISE_SET_EVENTS[event] | RISE_SET_DISCS[disc],
    toGeopos(observer),
    0,
    0,
  );

  if (result.flag === constants.ERR) throw translateFailure(result.error, { jdUt, body, event, observer, disc });
  return result.flag === constants.OK ? result.data : null;
}

// --- composites -------------------------------------------------------------

// A chart in one call: chart({ date: { year, month, day, hour, minute,
// second, calendar }, bodies, latitude, longitude, system })
// -> { jdUt, jdEt, bodies: { Sun: BodyState, ... }, houses: <houses() result> }.
// Positions at the ET instant, houses at the UT one -- the way the natal
// chart has always been computed.
function chart({ date, bodies, latitude, longitude, system }) {
  const { jdUt, jdEt } = julianDay(date);
  const [{ bodies: states }] = positions({ moments: [jdEt], timescale: "et", bodies });

  return { jdUt, jdEt, bodies: states, houses: houses({ jdUt, latitude, longitude, system }) };
}

// Several calls at once: batch([{ fn: "positions", args: [{ ... }] }, ...])
// -> their results, in order. Runs them one after another and throws the
// first error, exactly as the same calls made separately would. Exists so the
// remote implementation can send many small calls in one round trip.
function batch(calls) {
  if (!Array.isArray(calls)) throw new InvalidRequestError("calls must be an array of { fn, args }");

  return calls.map((call) => {
    const fn = call && call.fn;
    if (!contract.FUNCTIONS.includes(fn)) {
      throw new InvalidRequestError(`Unknown function ${JSON.stringify(fn)}; expected one of ${contract.FUNCTIONS.join(", ")}`);
    }
    if (!Array.isArray(call.args)) throw new InvalidRequestError(`${fn}: args must be an array`);
    return IMPLEMENTATION[fn](...call.args);
  });
}

const IMPLEMENTATION = {
  positions,
  position,
  houses,
  chart,
  julianDay,
  julianDays,
  isValidDate,
  calendarDate,
  deltaT,
  sunCrossing,
  nextSolarEclipseGlobal,
  nextSolarEclipseLocal,
  nextLunarEclipse,
  lunarEclipseAt,
  riseSet,
};

// --- startup -------------------------------------------------------------------

// Files that must be present whatever the deployment: the 1800-2399 planet,
// Moon and asteroid files (today's dates).
const REQUIRED_FILES = Object.freeze(["sepl_18.se1", "semo_18.se1", "seas_18.se1"]);
const PROBE_BODIES = Object.freeze(["Sun", "Moon", "Mercury", "Pluto", "Chiron", "Ceres"]);
const J2000 = 2451545;

let info = null;

// Points Swiss Ephemeris at `ephePath` ONCE, for the life of the process, and
// proves it works: the directory exists, holds .se1 files including
// REQUIRED_FILES, and the probe bodies at J2000 come from those files (no
// Moshier fallback). Throws an Error with a clear message otherwise -- the
// server then refuses to start.
function init({ ephePath }) {
  if (typeof ephePath !== "string" || ephePath.trim() === "") {
    throw new Error("EPHE_PATH is not set: point it at the directory with the Swiss Ephemeris .se1 files");
  }

  const dir = path.resolve(ephePath);
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new Error(`EPHE_PATH ${dir} does not exist`);
  }
  if (!stat.isDirectory()) throw new Error(`EPHE_PATH ${dir} is not a directory`);

  const files = fs
    .readdirSync(dir)
    .filter((name) => /\.se1$/i.test(name))
    .sort()
    .map((name) => ({ name, size: fs.statSync(path.join(dir, name)).size }));

  if (files.length === 0) throw new Error(`EPHE_PATH ${dir} contains no Swiss Ephemeris .se1 files`);
  const missing = REQUIRED_FILES.filter((name) => !files.some((file) => file.name === name));
  if (missing.length) throw new Error(`EPHE_PATH ${dir} is missing ${missing.join(", ")}`);

  sweph.set_ephe_path(dir);

  const iflag = constants.SEFLG_SWIEPH | constants.SEFLG_SPEED;
  for (const name of PROBE_BODIES) {
    const result = sweph.calc(J2000, BODY_IDS[name], iflag);
    if (result.flag !== iflag) {
      throw new Error(`EPHE_PATH ${dir}: ${name} at J2000 can't be computed from the files (${result.error.trim() || `flag ${result.flag}`})`);
    }
  }

  // Years covered by the planet files (sepl_18 = 1800-2399, seplm06 = -600..-1).
  const starts = files
    .map(({ name }) => /^sepl(_|m)(\d+)\.se1$/i.exec(name))
    .filter(Boolean)
    .map(([, sign, century]) => (sign === "m" ? -1 : 1) * Number(century) * 100);

  info = {
    swissEphemeris: sweph.version(),
    files: files.length,
    planetFilesCoverYears: starts.length ? { from: Math.min(...starts), to: Math.max(...starts) + 599 } : null,
    digest: require("node:crypto")
      .createHash("sha256")
      .update(files.map(({ name, size }) => `${name}:${size}\n`).join(""))
      .digest("hex"),
  };
  return info;
}

// What /version reports about the ephemeris (never the path).
const ephemerisInfo = () => info;

// --- large requests in slices -------------------------------------------------
//
// One request can ask for a lot: 2000 moments x 20 bodies (~250 ms
// geocentric, ~1.5 s topocentric on a laptop) or 1000 eclipse searches
// (~0.8 s). Computed in one go, that would hold up every other request for
// that long. batchInSlices() runs the same work as batch() as a list of
// small units -- each batch call on its own, and a positions() call with many
// moments split into consecutive runs of moments -- and gives the event loop
// a turn (setImmediate) whenever a slice of units has run for `sliceMs`.
//
// The result is exactly batch()'s: the same calls on the same inputs in the
// same order (a split positions() is the same per-moment computation, its
// parts concatenated in order), and the first error is thrown as batch()
// would throw it -- no unit after it runs. Small requests finish in their
// first slice, without yielding at all.

// A positions() call is split into units of at most this many body positions.
const POSITIONS_PER_UNIT = 200;

class ComputationCancelled extends Error {}

// calls -> { units: [() => void], results } where running every unit in
// order fills `results` (one entry per call).
function sliceUnits(calls) {
  if (!Array.isArray(calls)) throw new InvalidRequestError("calls must be an array of { fn, args }");

  const results = new Array(calls.length);
  const units = [];

  calls.forEach((call, i) => {
    const request = call && call.fn === "positions" && Array.isArray(call.args) ? call.args[0] : null;
    const splittable =
      request !== null &&
      typeof request === "object" &&
      Array.isArray(request.moments) &&
      Array.isArray(request.bodies) &&
      request.bodies.length > 0 &&
      request.moments.length * request.bodies.length > POSITIONS_PER_UNIT;

    if (!splittable) {
      units.push(() => {
        results[i] = batch([call])[0];
      });
      return;
    }

    const step = Math.max(1, Math.floor(POSITIONS_PER_UNIT / request.bodies.length));
    results[i] = [];
    for (let start = 0; start < request.moments.length; start += step) {
      const moments = request.moments.slice(start, start + step);
      units.push(() => {
        results[i].push(...positions({ ...request, moments }));
      });
    }
  });

  return { units, results };
}

// batch(calls), with the event loop free every `sliceMs`. isCancelled() is
// checked at each yield: when it says the client has gone, the rest is
// skipped (ComputationCancelled).
async function batchInSlices(calls, { sliceMs = 10, isCancelled = () => false } = {}) {
  const { units, results } = sliceUnits(calls);
  let sliceStartedAt = performance.now();

  for (const unit of units) {
    if (performance.now() - sliceStartedAt >= sliceMs) {
      await new Promise((resolve) => setImmediate(resolve));
      if (isCancelled()) throw new ComputationCancelled("the client went away");
      sliceStartedAt = performance.now();
    }
    unit();
  }

  return results;
}

module.exports = { ...IMPLEMENTATION, batch, batchInSlices, ComputationCancelled, POSITIONS_PER_UNIT, init, ephemerisInfo };

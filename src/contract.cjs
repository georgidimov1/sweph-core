// SPDX-License-Identifier: AGPL-3.0-only
// The names the sweph-core interface speaks in. No Swiss Ephemeris numbers
// here. Mirrors src/ephemeris/contract.cjs in the client application (its client).
const BODIES = Object.freeze([
  "Sun",
  "Moon",
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Pluto",
  "NNode",
  "TrueNode",
  "Lilith",
  "OscuLilith",
  "Chiron",
  "Pholus",
  "Ceres",
  "Pallas",
  "Juno",
  "Vesta",
]);

// Placidus, whole sign, Koch, equal, Regiomontanus, Campanus, Porphyry, topocentric.
const HOUSE_SYSTEM_CODES = Object.freeze(["P", "W", "K", "E", "R", "C", "O", "T"]);
const CALENDARS = Object.freeze(["gregorian", "julian"]);
const TIMESCALES = Object.freeze(["ut", "et"]);
const ZODIACS = Object.freeze(["tropical"]);
const RISE_SET_EVENTS = Object.freeze(["rise", "set"]);
const RISE_SET_DISCS = Object.freeze(["upperLimb", "center"]);

const ANGLE_NAMES = Object.freeze([
  "ascendant",
  "mc",
  "armc",
  "vertex",
  "equatorialAscendant",
  "coAscendantKoch",
  "coAscendantMunkasey",
  "polarAscendant",
]);

// Every function of the interface, i.e. everything batch() can run.
const FUNCTIONS = Object.freeze([
  "positions",
  "position",
  "houses",
  "chart",
  "julianDay",
  "julianDays",
  "isValidDate",
  "calendarDate",
  "deltaT",
  "sunCrossing",
  "nextSolarEclipseGlobal",
  "nextSolarEclipseLocal",
  "nextLunarEclipse",
  "lunarEclipseAt",
  "riseSet",
]);

module.exports = {
  BODIES,
  HOUSE_SYSTEM_CODES,
  CALENDARS,
  TIMESCALES,
  ZODIACS,
  RISE_SET_EVENTS,
  RISE_SET_DISCS,
  ANGLE_NAMES,
  FUNCTIONS,
};

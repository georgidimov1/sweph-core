// SPDX-License-Identifier: AGPL-3.0-only
// JSON for the sweph-core wire format, without losing numbers plain JSON
// can't carry: NaN, Infinity, -Infinity and -0 travel as { "$f": "NaN" } etc.
// (JSON.stringify would turn NaN/Infinity into null -- which then silently
// becomes 0 in arithmetic -- and -0 into 0). Every finite number round-trips
// exactly: V8 writes the shortest decimal that parses back to the same double.
// The same codec lives in the client application (src/ephemeris/codec.cjs), the client.

const TAG = "$f";
const SPECIAL = Object.freeze({ NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 });

function replacer(_key, value) {
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { [TAG]: "NaN" };
    if (value === Infinity) return { [TAG]: "Infinity" };
    if (value === -Infinity) return { [TAG]: "-Infinity" };
    if (Object.is(value, -0)) return { [TAG]: "-0" };
  }
  return value;
}

function reviver(_key, value) {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof value[TAG] === "string") {
    const keys = Object.keys(value);
    if (keys.length === 1 && Object.prototype.hasOwnProperty.call(SPECIAL, value[TAG])) return SPECIAL[value[TAG]];
  }
  return value;
}

const encode = (value) => JSON.stringify(value, replacer);
// Fast path: without a tag anywhere in the text, plain JSON.parse gives the same result.
const decode = (text) => (text.includes(`"${TAG}"`) ? JSON.parse(text, reviver) : JSON.parse(text));

// encode({ result }), byte for byte, but with the event loop free every
// `sliceMs`: arrays (the result, and arrays inside it -- e.g. a batch of
// positions calls) are written element by element. A 2000 x 20 positions
// answer is ~10 MB of JSON, ~100 ms to write in one go.
// (The replacer ignores the key, so an element encodes the same on its own as
// inside its array; an element JSON can't write -- undefined -- is "null"
// there, as JSON.stringify writes it in an array.)
async function encodeResultInSlices(result, { sliceMs = 10 } = {}) {
  if (!Array.isArray(result)) return encode({ result });

  let sliceStartedAt = performance.now();
  async function maybeYield() {
    if (performance.now() - sliceStartedAt >= sliceMs) {
      await new Promise((resolve) => setImmediate(resolve));
      sliceStartedAt = performance.now();
    }
  }

  async function write(value, depth) {
    if (!Array.isArray(value) || depth > 1) {
      const text = encode(value);
      return text === undefined ? "null" : text;
    }
    const parts = [];
    for (const element of value) {
      parts.push(await write(element, depth + 1));
      await maybeYield();
    }
    return `[${parts.join(",")}]`;
  }

  return `{"result":${await write(result, 0)}}`;
}

module.exports = { encode, decode, encodeResultInSlices };

// SPDX-License-Identifier: AGPL-3.0-only
import { test, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { startServer, expectStartupFailure } from "./helpers.mjs";

// The service refuses to start on any configuration problem, and listens on
// loopback only.

test("no CORE_SECRET -> refuses to start", async () => {
  const { code, output } = await expectStartupFailure({ CORE_SECRET: "" });
  expect(code).toBe(1);
  expect(output).toMatch(/CORE_SECRET is not set/);
});

test("no EPHE_PATH -> refuses to start", async () => {
  const { code, output } = await expectStartupFailure({ EPHE_PATH: "" });
  expect(code).toBe(1);
  expect(output).toMatch(/EPHE_PATH is not set/);
});

test("EPHE_PATH that doesn't exist, is empty, or lacks the current files -> refuses to start", async () => {
  const empty = mkdtempSync(join(tmpdir(), "sweph-core-empty-"));
  const partial = mkdtempSync(join(tmpdir(), "sweph-core-partial-"));
  writeFileSync(join(partial, "sepl_18.se1"), "not really an ephemeris file");
  try {
    expect((await expectStartupFailure({ EPHE_PATH: join(empty, "nope") })).output).toMatch(/does not exist/);
    expect((await expectStartupFailure({ EPHE_PATH: empty })).output).toMatch(/no Swiss Ephemeris \.se1 files/);
    expect((await expectStartupFailure({ EPHE_PATH: partial })).output).toMatch(/missing semo_18\.se1, seas_18\.se1/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
    rmSync(partial, { recursive: true, force: true });
  }
});

test("a corrupt ephemeris file is caught by the startup probe (no silent Moshier fallback)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sweph-core-corrupt-"));
  for (const name of ["sepl_18.se1", "semo_18.se1", "seas_18.se1"]) writeFileSync(join(dir, name), "garbage");
  try {
    const { code, output } = await expectStartupFailure({ EPHE_PATH: dir });
    expect(code).toBe(1);
    expect(output).toMatch(/at J2000 can't be computed from the files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-loopback HOST is refused unless explicitly allowed", async () => {
  const { code, output } = await expectStartupFailure({ HOST: "0.0.0.0" });
  expect(code).toBe(1);
  expect(output).toMatch(/not a loopback address/);
});

test("listens on 127.0.0.1 only: not reachable on the machine's other addresses", async () => {
  const server = await startServer();
  try {
    const { hostname, port } = new URL(server.url);
    expect(hostname).toBe("127.0.0.1");

    const external = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a && !a.internal && a.family === "IPv4")
      .map((a) => a.address);

    for (const address of external) {
      const reachable = await new Promise((resolve) => {
        const socket = net.connect({ host: address, port: Number(port), timeout: 1000 });
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
      });
      expect(reachable, `reachable on ${address}:${port}`).toBe(false);
    }
  } finally {
    await server.stop();
  }
});

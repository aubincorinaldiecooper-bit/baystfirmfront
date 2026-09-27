/**
 * The client bundle must never contain the backend credential: not the
 * variable names, not a value. This test builds the app with sentinel values
 * and greps everything Next.js emits for the browser (`.next/static`). It also
 * checks the server output does read the variable, so the assertion is not
 * vacuous. It is the slow test in the suite (one `next build`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const STATIC_DIR = join(ROOT, ".next", "static");
const SERVER_DIR = join(ROOT, ".next", "server");
const SENTINEL_KEY = "bay-bundle-sentinel-key-4f9c2e71d0b3";
const SENTINEL_HOST = "bundle-sentinel-7a1e.invalid";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("client bundle", () => {
  beforeAll(() => {
    execFileSync(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
      cwd: ROOT,
      env: {
        ...process.env,
        BAY_API_KEY: SENTINEL_KEY,
        BAY_API_URL: `http://${SENTINEL_HOST}/api/v1`,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: "pipe",
      timeout: 600_000,
    });
  }, 600_000);

  it("contains neither the BAY_* variable names nor their values", () => {
    expect(existsSync(STATIC_DIR)).toBe(true);
    const files = walk(STATIC_DIR);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "latin1");
      for (const needle of ["BAY_API_KEY", "BAY_API_URL", SENTINEL_KEY, SENTINEL_HOST]) {
        if (text.includes(needle)) offenders.push(`${relative(ROOT, file)} contains ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is read by the server output only", () => {
    const serverText = walk(SERVER_DIR)
      .filter((f) => /\.(js|mjs|cjs)$/.test(f))
      .map((f) => readFileSync(f, "latin1"))
      .join("\n");
    expect(serverText).toContain("BAY_API_KEY");
    expect(serverText).not.toContain(SENTINEL_KEY); /* read at runtime, never inlined */
  });
});

/**
 * Static guarantees about the proxy boundary: the backend key and URL are
 * read only on the server, nothing client-side references them, and no
 * NEXT_PUBLIC_ variant exists anywhere in the source tree.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SKIP = new Set(["node_modules", ".next", ".git", "out", "coverage", "test"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|css|md|json|example)$/.test(entry) || entry === ".env.example") out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const read = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => relative(ROOT, file);

const SERVER_ONLY_FILES = ["lib/server/env.ts", "lib/server/proxy.ts", "lib/server/baystEnv.ts", "lib/server/baystProxy.ts", "lib/auth/session.ts"];

describe("proxy boundary", () => {
  it("has no NEXT_PUBLIC_ backend configuration anywhere", () => {
    const offenders = files.filter((f) => /NEXT_PUBLIC_BAY|NEXT_PUBLIC_FINANCE/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("reads BAY_API_KEY / BAY_API_URL only in the server-only env module", () => {
    const offenders = files.filter((f) => {
      const path = rel(f);
      if (path === "lib/server/env.ts") return false;
      /* a read, not a mention in a comment */
      return /\benv\.BAY_API_(KEY|URL)\b|env\[\s*["']BAY_API_/.test(read(f));
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("client-side modules never touch process.env", () => {
    const clientDirs = ["lib/api", "lib/analysis", "lib/markets", "components", "app/(workspace)", "app/layout.tsx"];
    const offenders = files.filter((f) => {
      const path = rel(f);
      return clientDirs.some((d) => path === d || path.startsWith(`${d}/`)) && /process\.env\.BAY|process\.env\[/.test(read(f));
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it("guards the server modules with `server-only`", () => {
    for (const path of SERVER_ONLY_FILES) {
      expect(read(join(ROOT, path)).startsWith('import "server-only";'), path).toBe(true);
    }
  });

  it("keeps the session anonymous with no password anywhere", () => {
    const session = read(join(ROOT, "lib/auth/session.ts"));
    expect(session).toContain('kind: "anonymous"');
    expect(session).toContain("credentialId: string");
    const offenders = files.filter((f) => !rel(f).endsWith(".md") && /password/i.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

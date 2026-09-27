/**
 * Guard: no demo content ships. The upstream Beautiful UI gallery fills its
 * primitives with an ice-cream shop's fabricated figures, records, sources and
 * progress. None of it may reach app/, components/ or lib/, and shipped code
 * may not reference external assets. This file lives under test/, which is the
 * only place the vocabulary below is allowed to appear.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const SHIPPED_DIRS = ["app", "components", "lib"];
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|css|json|md|svg|html)$/;

/* substring match on purpose: "flavored", "scoops", "IceCream" all count */
const DEMO_VOCABULARY =
  /flavor|flavour|scoop|creamery|popsicle|pistachio|gelato|ice[\s_-]?cream|vanilla|sorbet|invite users/i;
const EXTERNAL_ASSET_HOSTS = /vercel-storage|blob\.vercel/i;
/* the only URL shipped UI code may contain is the upstream attribution */
const URL_LITERAL = /https?:\/\/[^\s"'`)<>]+/gi;
const ALLOWED_URLS = new Set(["https://github.com/slev12397/beautiful-ui"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SOURCE_FILE.test(entry)) out.push(full);
  }
  return out;
}

const files = SHIPPED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

function offenders(pattern: RegExp, only: (path: string) => boolean = () => true): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const path = relative(ROOT, file);
    if (!only(path)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        const match = line.match(pattern);
        if (match) hits.push(`${path}:${index + 1}: ${match[0]}`);
      });
  }
  return hits;
}

describe("shipped code carries no demo content", () => {
  it("scans the shipped directories", () => {
    expect(files.some((f) => relative(ROOT, f).startsWith("components/primitives/"))).toBe(true);
    expect(files.some((f) => relative(ROOT, f) === "app/globals.css")).toBe(true);
  });

  it("the patterns catch the upstream demo strings", () => {
    for (const sample of ["Pistachio is your fastest-growing flavor", "Scoop Data", "Creamery Ops", "IconPopsicle2", "ice-cream", "Invite users", "Sorbet", "Gelato"]) {
      expect(DEMO_VOCABULARY.test(sample), sample).toBe(true);
    }
    expect(EXTERNAL_ASSET_HOSTS.test("https://x.public.blob.vercel-storage.com/a.mp4")).toBe(true);
  });

  it("contains no demo vocabulary in app/, components/ or lib/", () => {
    expect(offenders(DEMO_VOCABULARY)).toEqual([]);
  });

  it("references no externally hosted assets", () => {
    expect(offenders(EXTERNAL_ASSET_HOSTS)).toEqual([]);
  });

  it("UI code contains no URLs other than the upstream attribution", () => {
    const hits: string[] = [];
    for (const file of files) {
      const path = relative(ROOT, file);
      if (!path.startsWith("app/") && !path.startsWith("components/")) continue;
      for (const url of readFileSync(file, "utf8").match(URL_LITERAL) ?? []) {
        if (!ALLOWED_URLS.has(url.replace(/[.,;]+$/, ""))) hits.push(`${path}: ${url}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("components run no timers of their own, except the LoadingState wall clock", () => {
    const hits = offenders(/\bset(Timeout|Interval)\s*\(/, (path) => path.startsWith("components/")).filter(
      (hit) => !hit.startsWith("components/primitives/LoadingState.tsx:"),
    );
    expect(hits).toEqual([]);
  });

  it("no image or video element loads a remote source", () => {
    expect(offenders(/<(img|video|source)\b[^>]*\bsrc=\{?["'`]https?:/i)).toEqual([]);
  });
});

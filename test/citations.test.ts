/**
 * Spark's citation markers: single `[src_x]` and multi-id `[src_a, src_b]`
 * blocks, one chip per known id, unknown ids kept verbatim.
 */
import { describe, expect, it } from "vitest";
import { citationSegments, citedSourceIds } from "@/lib/analysis/citations";

const known = new Set(["src_a1", "src_b2", "src_c3"]);

describe("citationSegments", () => {
  it("turns a single marker into one citation", () => {
    expect(citationSegments("Margins widened [src_a1].", known)).toEqual([{ text: "Margins widened " }, { cite: "src_a1" }, { text: "." }]);
  });

  it("turns a multi-id block into one citation per id, in order", () => {
    expect(citationSegments("Demand held up [src_a1, src_b2,src_c3] overall.", known)).toEqual([
      { text: "Demand held up " },
      { cite: "src_a1" },
      { cite: "src_b2" },
      { cite: "src_c3" },
      { text: " overall." },
    ]);
  });

  it("keeps a block of unknown ids verbatim and an unknown id inside a mixed block as text", () => {
    expect(citationSegments("See [src_zz9, src_yy8].", known)).toEqual([{ text: "See [src_zz9, src_yy8]." }]);
    expect(citationSegments("See [src_a1, src_zz9].", known)).toEqual([{ text: "See " }, { cite: "src_a1" }, { text: "[src_zz9]." }]);
  });

  it("leaves other bracketed text alone", () => {
    expect(citationSegments("[scripted] text [1] and [src_a1 extra]", known)).toEqual([{ text: "[scripted] text [1] and [src_a1 extra]" }]);
    expect(citationSegments("", known)).toEqual([]);
  });
});

describe("citedSourceIds", () => {
  it("lists known ids from single and multi-id blocks once, in first-appearance order", () => {
    expect(citedSourceIds("[src_b2] then [src_a1, src_b2] and [src_c3, src_zz9]", known)).toEqual(["src_b2", "src_a1", "src_c3"]);
  });
});

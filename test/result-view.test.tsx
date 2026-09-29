/** @vitest-environment jsdom */
/**
 * The structured result as the backend provides it: rendered from the real
 * results of backend main (no optional fields) and of the PR #3 branch
 * (thesis_diff, valuation reconciliation), plus PR #4 requirement labels.
 * Every figure on the page must be a backend display string or value, and no
 * Laya internals (questions, digests, raw scores) may reach the page.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ResultView from "@/components/finance/result/ResultView";
import type { AnalysisResult } from "@/lib/api/types";
import { cancelledRun, clone, completedRun, failedRun, thesisRun, thesisScopeRun } from "./fixtures/backend";

afterEach(cleanup);

function renderResult(result: AnalysisResult) {
  return render(<ResultView result={result} />);
}

const section = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

describe("completed result on backend main (no optional fields)", () => {
  const result = completedRun.result;

  it("renders the assessment, horizons, calculations, sources and uncertainties", () => {
    const { container } = renderResult(result);
    expect(section("Assessment").textContent).toContain("Scripted synthesis for Apple Inc. (AAPL)");
    const horizons = section("By horizon");
    expect(within(horizons).getAllByRole("article")).toHaveLength(4);
    expect(within(horizons).getByRole("article", { name: "Near term (days to several weeks)" }).textContent).toContain(
      "Decision confidence 0.5",
    );
    expect(section("Calculations").textContent).toContain(result.calculations[0].formula);
    expect(section("Sources").querySelectorAll("li[id^=source-]")).toHaveLength(result.sources.length);
    for (const text of result.assessment.uncertainties) expect(section("Uncertainties").textContent).toContain(text);
    expect(container.textContent).not.toContain("Since the prior assessment");
    expect(container.textContent).not.toContain("Valuation vs fundamentals");
    expect(screen.queryByLabelText("What this question needs")).toBeNull();
  });

  it("shows every computed figure as the backend's display string", () => {
    renderResult(result);
    const table = screen.getByRole("table", { name: "Deterministic calculations" });
    for (const calc of result.calculations) {
      const row = table.querySelector(`[id="calc-${calc.calc_id}"]`)!.closest("tr")!;
      expect(row.textContent).toContain(calc.display);
      if (calc.period_label) expect(row.textContent).toContain(calc.period_label);
      for (const missing of calc.missing_inputs) expect(row.textContent).toContain(missing);
      for (const input of calc.inputs) {
        expect(row.textContent).toContain(input.name);
        if (input.value !== null) expect(row.textContent).toContain(String(input.value));
      }
      expect(row.textContent).toContain(calc.status === "computed" ? "Computed" : "Unavailable");
    }
  });

  it("gives each source its provenance, dates, freshness and terms", () => {
    renderResult(result);
    for (const source of result.sources) {
      const card = document.getElementById(`source-${source.source_id}`)!;
      expect(card.textContent).toContain(source.title);
      if (source.publisher) expect(card.textContent).toContain(source.publisher);
      expect(card.textContent).toContain(`Retrieved ${source.retrieved_at.slice(0, 10)}`);
      if (source.published_at) expect(card.textContent).toContain(`Published ${source.published_at.slice(0, 10)}`);
      if (source.terms_note) expect(card.textContent).toContain(source.terms_note);
      if (source.freshness === "stale") expect(card.textContent).toContain("Stale");
      /* excerpts only where the terms allow redistribution */
      if (source.excerpt) expect(card.textContent?.includes(source.excerpt)).toBe(source.redistribution === "allowed");
    }
    const stale = result.sources.filter((s) => s.freshness === "stale").length;
    expect(section("Sources").textContent).toContain(`${stale} stale`);
  });

  it("never renders Laya internals", () => {
    const { container } = renderResult(result);
    const text = container.textContent ?? "";
    expect(result.laya_decisions.length).toBeGreaterThan(0);
    for (const decision of result.laya_decisions) {
      expect(text).not.toContain(decision.question.instructions);
      expect(text).not.toContain(decision.state_digest);
      expect(text).not.toContain(decision.decision_id);
    }
    /* a numeric classification score (growth_durability: 2.0) is not shown, its category labels are */
    expect(result.assessment.fundamentals.growth_durability).toMatchObject({ decision: 2 });
    expect(section("Fundamentals").textContent).not.toContain("Growth durability");
    expect(section("Fundamentals").textContent).toContain("Guidance trend");
  });

  it("shows the backend's freshness summary as reported", () => {
    renderResult(result);
    const facts = result.freshness_summary.facts as Record<string, unknown>;
    const panel = section("Evidence freshness");
    expect(panel.textContent).toContain(`${facts.latest_quarter_end} · Current · ${facts.latest_quarter_age_days} days old`);
    expect(panel.textContent).toContain(`Stale ${facts.stale}`);
    expect(panel.textContent).toContain(`${result.telemetry.research.queries_issued} queries`);
  });

  it("preserves conflicting values with their basis, units and sources", () => {
    /* the doubles' fixture has no conflicts; this one is built from schemas/evidence.py Conflict */
    const withConflict = clone(result);
    const sourceId = result.sources[0].source_id;
    withConflict.assessment.conflicts = [
      {
        metric: "revenue",
        period_label: "Q3 FY2026",
        status: "unresolved",
        reason: "basis_mismatch",
        values: [
          { value: 87362000000, basis: "gaap", unit: "USD", source_id: sourceId, published_at: null, period_label: "Q3 FY2026" },
          { value: 87100000000, basis: "adjusted", unit: "USD", source_id: "src_not_in_this_result", published_at: null, period_label: "Q3 FY2026" },
        ],
        material: true,
        note: "Reported and adjusted revenue differ.",
      },
    ];
    renderResult(withConflict);
    const conflicts = section("Conflicting sources");
    expect(conflicts.textContent).toContain("Revenue · Q3 FY2026");
    expect(conflicts.textContent).toContain("Material");
    expect(conflicts.textContent).toContain("Unresolved");
    expect(conflicts.textContent).toContain("Reason: Basis mismatch");
    expect(conflicts.textContent).toContain("87362000000 USD");
    expect(conflicts.textContent).toContain("87100000000 USD");
    expect(conflicts.textContent).toContain("GAAP");
    expect(within(conflicts).getByRole("link", { name: result.sources[0].publisher! }).getAttribute("href")).toBe(`#source-${sourceId}`);
    expect(conflicts.textContent).toContain("src_not_in_this_result");
  });

  it("marks a completed but cut-off synthesis as incomplete", () => {
    renderResult({ ...clone(result), partial: true });
    expect(screen.getByRole("status").textContent).toContain("This assessment is incomplete.");
  });
});

describe("partial results of runs that stopped", () => {
  it("shows the preserved text of a cancelled run as cut off, without inventing sections", () => {
    const result = cancelledRun.result;
    const { container } = renderResult(result);
    expect(section("Partial synthesis").textContent).toContain(result.streamed_text.replace(/\[src_[a-z0-9]+\]/g, "").trim().slice(0, 20));
    expect(container.textContent).not.toContain("By horizon");
    expect(screen.getByRole("table", { name: "Deterministic calculations" })).toBeTruthy();
    expect(section("Sources")).toBeTruthy();
  });

  it("shows what research recorded before a failure", () => {
    const result = failedRun.result;
    const { container } = renderResult(result);
    expect(section("Sources").querySelectorAll("li[id^=source-]")).toHaveLength(result.sources.length);
    expect(container.textContent).not.toContain("Calculations");
    expect(container.textContent).not.toContain("Partial synthesis");
  });
});

describe("thesis diff and reconciliation (backend PR #3, optional)", () => {
  it("shows what changed since the prior assessment", () => {
    const result = thesisRun.result;
    const diff = result.thesis_diff!;
    renderResult(result);
    const card = section("Since the prior assessment");
    expect(card.textContent).toContain("Stance unchanged");
    expect(within(card).getByRole("link", { name: diff.previous_analysis_id }).getAttribute("href")).toBe(
      `/analyses/${diff.previous_analysis_id}`,
    );
    for (const metric of diff.metrics) {
      expect(card.textContent).toContain(`${metric.previous_display} → ${metric.current_display}`);
    }
    expect(within(card).queryByRole("note")).toBeNull();
  });

  it("explains a change of horizon scope instead of reporting a change of thesis", () => {
    const diff = thesisScopeRun.result.thesis_diff!;
    expect(diff.horizon_scope_changed).toBe(true);
    renderResult(thesisScopeRun.result);
    const card = section("Since the prior assessment");
    expect(within(card).getByRole("note").textContent).toBe(
      "The two assessments covered different horizons. The overall stance is compared only over the horizons both assessed: Near term (days to several weeks).",
    );
    expect(card.textContent).toContain("not assessed");
  });

  it("shows the reconciliation verdict, its rule and the backend's statement", () => {
    const result = thesisRun.result;
    const headline = result.calculations.find((c) => c.name === "valuation_reconciliation_1y")!;
    const record = headline.meta.reconciliation as { verdict: string; verdict_rule: string };
    renderResult(result);
    const card = within(section("Valuation vs fundamentals")).getByRole("article");
    expect(card.textContent).toContain(record.verdict);
    expect(card.textContent).toContain(`Rule: ${record.verdict_rule}`);
    expect(card.textContent).toContain(headline.notes[headline.notes.length - 1]);
    expect(card.textContent).toContain(headline.display);
    /* the unavailable 3-year window and the component records get no verdict card */
    expect(within(section("Valuation vs fundamentals")).getAllByRole("article")).toHaveLength(1);
  });

  it("ignores malformed optional fields", () => {
    const result = clone(thesisRun.result);
    (result as unknown as { thesis_diff: unknown }).thesis_diff = { unexpected: true };
    for (const calc of result.calculations) calc.meta = { reconciliation: "valuation_reconciliation_1y" };
    const { container } = renderResult(result);
    expect(container.textContent).not.toContain("Since the prior assessment");
    expect(container.textContent).not.toContain("Valuation vs fundamentals");
  });
});

describe("requirement labels (backend PR #4, optional)", () => {
  it("renders product-level labels as plain chips and nothing plan-like", () => {
    const plan = "Plan: fetch the 10-K first, then compare the multiple with its five-year median";
    const result = { ...clone(completedRun.result), requirements: ["Valuation history", "Earnings trajectory", plan, { label: "Price performance" }] };
    renderResult(result);
    const chips = screen.getByLabelText("What this question needs");
    expect(within(chips).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Valuation history",
      "Earnings trajectory",
      "Price performance",
    ]);
    expect(document.body.textContent).not.toContain(plan);
  });
});

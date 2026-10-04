"use client";

/* The start page: the question composer. */

import AnalysisComposer from "./AnalysisComposer";
import PageHeader from "./PageHeader";

export default function NewAnalysis() {
  return (
    <>
      <PageHeader title="New analysis" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-10 sm:px-8 sm:pt-14">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Ask about a public company</h1>
          <p className="mt-2 max-w-[560px] text-[14px] leading-[1.6] text-ink-2">
            Sourced, multi-horizon assessments built from public filings, market data and current coverage. Every
            number is a recorded calculation; every claim points at its source.
          </p>
          <div className="mt-8">
            <AnalysisComposer />
          </div>
        </div>
      </div>
    </>
  );
}

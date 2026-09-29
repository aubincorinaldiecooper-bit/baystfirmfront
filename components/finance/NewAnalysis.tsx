"use client";

/* The start page: the question composer and the backend's real capabilities. */

import AnalysisComposer from "./AnalysisComposer";
import BackendStatus from "./BackendStatus";
import PageHeader from "./PageHeader";
import { useWorkspace } from "./workspace";

export default function NewAnalysis() {
  const { capabilities } = useWorkspace();
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
          <div className="mt-12">
            <BackendStatus capabilities={capabilities} />
          </div>
        </div>
      </div>
    </>
  );
}

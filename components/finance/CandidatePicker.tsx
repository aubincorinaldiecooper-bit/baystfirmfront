"use client";

/* "Which company did you mean?": the backend's own candidates from a 422
 * AMBIGUOUS_INSTRUMENT (or the same code on the stream). Choosing one reruns
 * the question with that instrument. The candidate score is not shown. */

import { Building2, X } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import type { InstrumentCandidate } from "@/lib/api/types";

export default function CandidatePicker({
  message,
  candidates,
  onChoose,
  onDismiss,
  busy = false,
}: {
  message: string;
  candidates: InstrumentCandidate[];
  onChoose: (candidate: InstrumentCandidate) => void;
  onDismiss?: () => void;
  busy?: boolean;
}) {
  return (
    <div role="group" aria-labelledby="candidate-picker-heading" className="rounded-[12px] bg-surface p-3 shadow-card">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <p id="candidate-picker-heading" className="text-[13.5px] font-medium text-ink">
            {message}
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            {candidates.length > 0
              ? "Choose the company to analyse. The question stays the same."
              : "No candidates were found. Include the company's ticker symbol in the question and try again."}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-hover-2 hover:text-ink"
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </div>
      {candidates.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {candidates.map((candidate) => (
            <li key={`${candidate.symbol}:${candidate.exchange ?? ""}`}>
              <Button
                variant="quiet"
                size="md"
                disabled={busy}
                onClick={() => onChoose(candidate)}
                className="h-auto w-full justify-start rounded-[8px] px-2 py-2 text-left"
                aria-label={`Analyse ${candidate.name} (${candidate.symbol}${candidate.exchange ? `, ${candidate.exchange}` : ""})`}
              >
                <Building2 size={15} aria-hidden className="shrink-0 text-ink-2" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{candidate.name}</span>
                <span className="shrink-0 font-mono text-[12px] text-ink-2">
                  {candidate.symbol}
                  {candidate.exchange ? ` · ${candidate.exchange}` : ""}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

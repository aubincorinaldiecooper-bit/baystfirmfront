"use client";

/* The question composer: free text, the Fast | Deep profile (availability and
 * reasons from GET /capabilities) and the horizon (CreateAnalysisRequest
 * `horizon`, "auto" lets the backend read it from the question). Sending is
 * POST /analyses through the proxy; the new analysis opens at its own URL. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import LoadingState from "@/components/primitives/LoadingState";
import PromptBar, { type PromptOption } from "@/components/primitives/PromptBar";
import { profileUnavailableMessage, type CapabilitiesView } from "@/lib/api/capabilities";
import { HORIZON_LABELS, SINGLE_HORIZONS, type Horizon, type Profile } from "@/lib/api/types";
import { useSubmitAnalysis } from "@/lib/analysis/useSubmitAnalysis";
import CandidatePicker from "./CandidatePicker";
import { RequestErrorPanel } from "./ErrorPanels";
import { Notice } from "./ui";
import { useWorkspace } from "./workspace";

const PROFILE_COPY: Record<Profile, { name: string; description: string }> = {
  fast: { name: "Fast", description: "Faster everyday analysis" },
  deep: { name: "Deep", description: "More context for heavier research" },
};

export const HORIZON_OPTIONS: { value: Horizon; label: string }[] = [
  { value: "auto", label: "Horizon: from the question" },
  ...SINGLE_HORIZONS.map((h) => ({ value: h as Horizon, label: HORIZON_LABELS[h] })),
  { value: "multi_horizon", label: HORIZON_LABELS.multi_horizon },
];

export function profileOptions(view: CapabilitiesView): PromptOption[] {
  return (["fast", "deep"] as const).map((profile) => {
    const availability = view.profiles[profile];
    return {
      key: profile,
      name: PROFILE_COPY[profile].name,
      description: PROFILE_COPY[profile].description,
      disabled: !availability.available,
      disabledReason: availability.available
        ? undefined
        : availability.reason ?? profileUnavailableMessage(availability) ?? undefined,
    };
  });
}

export default function AnalysisComposer({ initialQuery = "" }: { initialQuery?: string }) {
  const router = useRouter();
  const { capabilities, history } = useWorkspace();
  const [draft, setDraft] = useState(initialQuery);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [horizon, setHorizon] = useState<Horizon>("auto");

  const { state, submit, choose, dismiss } = useSubmitAnalysis((response) => {
    history.refreshHead();
    router.push(`/analyses/${encodeURIComponent(response.analysis_id)}`);
  });

  const view = capabilities.status === "ready" ? capabilities.capabilities : null;

  /* keep the selection on an available profile; the backend decides availability */
  useEffect(() => {
    if (!view) return;
    if (profile === null || !view.profiles[profile].available) setProfile(view.defaultProfile);
  }, [view, profile]);

  /* a rejected question goes back into the composer for editing */
  useEffect(() => {
    if (state.status === "ambiguous" || state.status === "error") setDraft(state.request.query);
  }, [state]);

  const submitting = state.status === "submitting";
  const canSend = Boolean(view && view.anyProfileAvailable && profile) && !submitting;

  return (
    <div className="flex flex-col gap-3">
      <PromptBar
        tall
        placeholder="Ask about a listed company, e.g. its outlook over the next earnings"
        ariaLabel="Question"
        value={draft}
        onValueChange={setDraft}
        sendDisabled={!canSend}
        options={view ? profileOptions(view) : []}
        selectedOption={profile ?? undefined}
        onSelectOption={(key) => setProfile(key as Profile)}
        optionsLabel="Analysis profile"
        onSend={(text) => {
          if (!profile) return;
          submit({ query: text, profile, horizon });
        }}
      />

      <div className="flex flex-wrap items-center gap-3 px-1">
        <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
          <span className="sr-only">Horizon</span>
          <select
            value={horizon}
            onChange={(event) => setHorizon(event.target.value as Horizon)}
            aria-label="Horizon"
            className="h-7 max-w-full rounded-full bg-field px-2.5 text-[12.5px] font-medium text-ink-2 shadow-hairline outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {HORIZON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {submitting && <LoadingState label="Submitting" variant="Dots" showElapsed={false} />}
        {capabilities.status === "loading" && (
          <LoadingState label="Checking which profiles are available" variant="Dots" showElapsed={false} />
        )}
      </div>

      {capabilities.status === "error" && capabilities.error && (
        <RequestErrorPanel error={capabilities.error} onRetry={capabilities.reload} />
      )}

      {view && !view.anyProfileAvailable && (
        <Notice kind="warn" role="status" title="No analysis profile is available on this backend right now.">
          {(["fast", "deep"] as const).map((p) => (
            <p key={p}>
              {PROFILE_COPY[p].name}: {view.profiles[p].reason ?? profileUnavailableMessage(view.profiles[p])}
            </p>
          ))}
        </Notice>
      )}

      {state.status === "ambiguous" && (
        <CandidatePicker message={state.message} candidates={state.candidates} onChoose={choose} onDismiss={dismiss} />
      )}

      {state.status === "error" && (
        <RequestErrorPanel error={state.error} onRetry={() => submit(state.request)} busy={submitting} />
      )}
    </div>
  );
}

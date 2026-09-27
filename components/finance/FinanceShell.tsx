"use client";
/* Shell layout adapted from Beautiful UI's harness (https://github.com/slev12397/beautiful-ui) — MIT License,
 * Copyright (c) 2026 Shane Levine. Full notice in LICENSE-THIRD-PARTY at the repo root. */

import type { ReactNode } from "react";
import { AlertCircle, Globe, Layers, Mic, RefreshCw, Server, Zap } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { profileUnavailableMessage, useCapabilities, type ProfileAvailability } from "@/lib/api/capabilities";
import type { ApiError } from "@/lib/api/client";

/* ─────────────────────────────────────────────────────────
 * FINANCE SHELL
 * The Beautiful UI harness frame (canvas, rounded page pane,
 * tab bar) without the demo scenarios. This build renders the
 * product identity and the backend's real capabilities only;
 * the prompt, the analysis thread and the evidence pane arrive
 * with the analysis workspace.
 * ───────────────────────────────────────────────────────── */

export default function FinanceShell() {
  return (
    <main className="flex h-[100dvh] gap-0 bg-canvas p-2.5 text-ink">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-h-0 flex-1 gap-2.5">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-page">
            <header className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
              <span className="text-[13px] font-semibold text-ink">BayAnalytics</span>
              <ThemeToggle />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-14 sm:px-8">
                <h1 className="text-[22px] font-semibold tracking-tight text-ink">Ask about a public company</h1>
                <p className="mt-2 max-w-[560px] text-[14px] leading-[1.6] text-ink-2">
                  Sourced, multi-horizon assessments built from public filings, market data and current
                  coverage. Every number is a recorded calculation; every claim points at its source.
                </p>
                <div className="mt-10">
                  <BackendStatus />
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

/* ── backend status (real /capabilities only) ─────────────── */

function BackendStatus() {
  const { status, capabilities, error, reload } = useCapabilities();

  return (
    <section aria-labelledby="backend-status-heading" aria-live="polite" aria-busy={status === "loading"}>
      <div className="mb-3 flex items-center justify-between">
        <h2 id="backend-status-heading" className="text-[12.5px] font-medium uppercase tracking-[0.04em] text-ink-3">
          Backend
        </h2>
        {status !== "loading" && (
          <Button variant="quiet" size="xs" onClick={reload} aria-label="Reload backend capabilities">
            <RefreshCw size={12} aria-hidden />
            Refresh
          </Button>
        )}
      </div>

      {status === "loading" && (
        <div className="flex min-h-10 items-center">
          <LoadingState label="Checking backend capabilities" variant="Dots" />
        </div>
      )}

      {status === "error" && error && <StatusError error={error} onRetry={reload} />}

      {status === "ready" && capabilities && (
        <div className="rounded-[10px] bg-surface shadow-card">
          <ProfileRow icon={<Zap size={15} aria-hidden />} label="Fast" hint="faster everyday analysis" availability={capabilities.profiles.fast} />
          <ProfileRow icon={<Layers size={15} aria-hidden />} label="Deep" hint="more context for heavier research" availability={capabilities.profiles.deep} />
          <Row icon={<Mic size={15} aria-hidden />} label="Voice input" value={capabilities.voice ? "Available" : "Not available"} muted={!capabilities.voice} />
          <Row
            icon={<Globe size={15} aria-hidden />}
            label="Web search"
            value={capabilities.execution.search_configured ? "Configured" : "Not configured — filings and prices only"}
            muted={!capabilities.execution.search_configured}
          />
          <Row icon={<Server size={15} aria-hidden />} label="Deployment" value={capabilities.deployment} mono last />
        </div>
      )}
    </section>
  );
}

function ProfileRow({
  icon,
  label,
  hint,
  availability,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  availability: ProfileAvailability;
}) {
  const message = profileUnavailableMessage(availability);
  return (
    <Row
      icon={icon}
      label={label}
      hint={hint}
      value={availability.available ? "Available" : "Unavailable"}
      detail={availability.available ? null : message ?? availability.reason}
      warn={!availability.available}
    />
  );
}

function Row({
  icon,
  label,
  hint,
  value,
  detail,
  muted = false,
  warn = false,
  mono = false,
  last = false,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  value: string;
  detail?: string | null;
  muted?: boolean;
  warn?: boolean;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${last ? "" : "border-b border-line"}`}>
      <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center ${warn ? "text-orange" : "text-ink-2"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13.5px] font-medium text-ink">
            {label}
            {hint && <span className="ml-2 text-[12.5px] font-normal text-ink-3">{hint}</span>}
          </span>
          <span className={`shrink-0 text-[13px] ${mono ? "font-mono" : ""} ${warn ? "text-orange" : muted ? "text-ink-3" : "text-ink-2"}`}>
            {value}
          </span>
        </div>
        {detail && <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">{detail}</p>}
      </div>
    </div>
  );
}

function StatusError({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  const unreachable = error.code === "NETWORK_ERROR" || error.details?.reason === "upstream_unreachable";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[10px] bg-surface px-4 py-3 shadow-card">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-red">
        <AlertCircle size={15} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium text-ink">
          {unreachable ? "The analysis backend can't be reached." : "The backend reported an error."}
        </p>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-ink-2">{error.message}</p>
        <p className="mt-1 font-mono text-[11.5px] text-ink-3">
          {error.code}
          {error.httpStatus ? ` · HTTP ${error.httpStatus}` : ""}
        </p>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <RefreshCw size={12} aria-hidden />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

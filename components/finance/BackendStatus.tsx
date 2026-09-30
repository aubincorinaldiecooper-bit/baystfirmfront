"use client";

/* The backend's real capabilities (GET /capabilities through the proxy): Fast / Deep
 * availability with the backend's reasons, voice, web search and the deployment.
 * Nothing here is a placeholder; when the backend is down the panel says so. */

import type { ReactNode } from "react";
import { AlertCircle, Globe, Layers, Mic, RefreshCw, Server, Zap } from "lucide-react";
import { Button } from "@/components/atoms/Button";
import LoadingState from "@/components/primitives/LoadingState";
import { profileUnavailableMessage, type ProfileAvailability, type UseCapabilitiesResult } from "@/lib/api/capabilities";
import type { ApiError } from "@/lib/api/client";

/* ── backend status (real /capabilities only) ─────────────── */

export default function BackendStatus({ capabilities: result }: { capabilities: UseCapabilitiesResult }) {
  const { status, capabilities, error, reload } = result;

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
            value={(capabilities.webSearch ?? capabilities.execution.search_configured) ? "Configured" : "Not configured — analyses can't run"}
            muted={!(capabilities.webSearch ?? capabilities.execution.search_configured)}
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

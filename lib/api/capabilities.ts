/**
 * Capability detection (frontend spec section 21).
 *
 * `GET /capabilities` is loaded once per client and shared by every component
 * that asks. The view it produces is what drives the Fast | Deep control:
 * availability comes from the backend, never from a default, and an
 * unavailable profile carries the backend's reason and code.
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, bayApi, isAbortError, isApiError, type BayApiClient } from "./client";
import type { Capabilities, ErrorCode, ExecutionInfo, Profile, ProfileCapability } from "./types";
import { PROFILES } from "./types";

export interface ProfileAvailability {
  profile: Profile;
  available: boolean;
  contextCeiling: number | null;
  reason: string | null;
  code: ErrorCode | null;
}

export interface CapabilitiesView {
  profiles: Record<Profile, ProfileAvailability>;
  voice: boolean;
  deployment: string;
  research: boolean;
  execution: ExecutionInfo;
  /** Whether any profile can run at all. */
  anyProfileAvailable: boolean;
  /** The profile to preselect: fast when available, else deep, else null. */
  defaultProfile: Profile | null;
}

function fromCapability(profile: Profile, capability: ProfileCapability | undefined): ProfileAvailability {
  if (!capability) {
    return { profile, available: false, contextCeiling: null, reason: "not reported by the backend", code: null };
  }
  return {
    profile,
    available: capability.available,
    contextCeiling: capability.context_ceiling,
    reason: capability.reason ?? null,
    code: capability.code ?? null,
  };
}

export function toCapabilitiesView(capabilities: Capabilities): CapabilitiesView {
  const profiles = Object.fromEntries(
    PROFILES.map((profile) => [profile, fromCapability(profile, capabilities.profiles[profile])]),
  ) as Record<Profile, ProfileAvailability>;
  const defaultProfile = profiles.fast.available ? "fast" : profiles.deep.available ? "deep" : null;
  return {
    profiles,
    voice: capabilities.voice,
    deployment: capabilities.deployment,
    research: capabilities.research,
    execution: capabilities.execution,
    anyProfileAvailable: defaultProfile !== null,
    defaultProfile,
  };
}

/** Concise, product-facing explanation for a disabled profile (spec section 18). */
export function profileUnavailableMessage(availability: ProfileAvailability): string | null {
  if (availability.available) return null;
  switch (availability.code) {
    case "DEEP_PROFILE_UNAVAILABLE":
    case "MEMORY_PRESSURE":
      return "Deep analysis isn't available on this machine right now. Try Fast.";
    case "FAST_PROFILE_UNAVAILABLE":
      return "Fast analysis isn't available on this backend right now.";
    case "SPARK_START_FAILED":
      return "The synthesis model isn't available on this backend right now.";
    default:
      return availability.profile === "deep"
        ? "Deep analysis isn't available right now."
        : "Fast analysis isn't available right now.";
  }
}

/* ── one shared load per client ──────────────────────────── */

const cache = new WeakMap<BayApiClient, Promise<Capabilities>>();

export function loadCapabilities(client: BayApiClient = bayApi, options: { force?: boolean } = {}): Promise<Capabilities> {
  const existing = options.force ? undefined : cache.get(client);
  if (existing) return existing;
  const promise = client.getCapabilities().catch((error: unknown) => {
    cache.delete(client); /* a failed load is retried next time, not memoised */
    throw error;
  });
  cache.set(client, promise);
  return promise;
}

export function clearCapabilitiesCache(client: BayApiClient = bayApi): void {
  cache.delete(client);
}

export type CapabilitiesStatus = "loading" | "ready" | "error";

export interface UseCapabilitiesResult {
  status: CapabilitiesStatus;
  capabilities: CapabilitiesView | null;
  error: ApiError | null;
  reload: () => void;
}

/** Load `/capabilities` once and expose profile availability with reasons. */
export function useCapabilities(client: BayApiClient = bayApi): UseCapabilitiesResult {
  const [status, setStatus] = useState<CapabilitiesStatus>("loading");
  const [capabilities, setCapabilities] = useState<CapabilitiesView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError(null);
    loadCapabilities(client, { force: generation > 0 })
      .then((raw) => {
        if (!active) return;
        setCapabilities(toCapabilitiesView(raw));
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (!active || isAbortError(cause)) return;
        setError(
          isApiError(cause)
            ? cause
            : new ApiError({
                code: "NETWORK_ERROR",
                message: "Could not load backend capabilities.",
                retryable: true,
                httpStatus: 0,
                cause,
              }),
        );
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [client, generation]);

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { status, capabilities, error, reload };
}

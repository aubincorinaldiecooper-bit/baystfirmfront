import "server-only";

/**
 * Server-only configuration for the BayAnalytics proxy.
 *
 * Both values are read from the process environment on the server. They are
 * never prefixed NEXT_PUBLIC_, never imported from client code (the
 * `server-only` guard above fails the build if that happens) and never echoed
 * into a response.
 */

export const DEFAULT_BAY_API_URL = "http://127.0.0.1:8000/api/v1";

export interface BayServerConfig {
  /** Base URL of the backend including the `/api/v1` prefix, no trailing slash. */
  apiUrl: string;
  /** Bearer key for the backend, or null when the backend needs none (loopback). */
  apiKey: string | null;
}

export function readBayServerConfig(env: Record<string, string | undefined> = process.env): BayServerConfig {
  const raw = (env.BAY_API_URL ?? "").trim() || DEFAULT_BAY_API_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BAY_API_URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("BAY_API_URL must use http or https.");
  }
  const apiUrl = parsed.toString().replace(/\/+$/, "");
  const key = (env.BAY_API_KEY ?? "").trim();
  return { apiUrl, apiKey: key.length > 0 ? key : null };
}

import "server-only";

/**
 * Server-only configuration for the Markets proxy to the Baystfirm crypto
 * backend. Like the BayAnalytics values, these are never NEXT_PUBLIC_, never
 * read by client code and never echoed into a response.
 */

export const DEFAULT_BAYST_API_URL = "http://127.0.0.1:8100";

export interface BaystServerConfig {
  /** Base URL of the Baystfirm service (routes are /health and /v1/...), no trailing slash. */
  apiUrl: string;
  /** Bearer key for the service, or null when it runs without one. */
  apiKey: string | null;
}

export function readBaystServerConfig(env: Record<string, string | undefined> = process.env): BaystServerConfig {
  const raw = (env.BAYST_API_URL ?? "").trim() || DEFAULT_BAYST_API_URL;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BAYST_API_URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("BAYST_API_URL must use http or https.");
  }
  const key = (env.BAYST_API_KEY ?? "").trim();
  return { apiUrl: parsed.toString().replace(/\/+$/, ""), apiKey: key.length > 0 ? key : null };
}

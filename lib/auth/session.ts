import "server-only";

/**
 * Server session seam.
 *
 * There is no authentication in this build: every request is anonymous and the
 * proxy attaches the server-side backend key regardless of who is asking. The
 * shape below reserves the seat for the chosen model (email + WebAuthn/device
 * credential + a secure server session) without implementing any of it.
 * See docs/AUTH.md. Nothing here stores or checks a secret, and nothing will.
 */
export type Session =
  | { kind: "anonymous" }
  | { kind: "user"; email: string; credentialId: string };

export const ANONYMOUS_SESSION: Session = { kind: "anonymous" };

/**
 * Resolve the session for the current server request. Always anonymous today;
 * a later change reads the session cookie here and nowhere else, so the proxy
 * and the pages keep calling this one function.
 */
export async function getServerSession(): Promise<Session> {
  return ANONYMOUS_SESSION;
}

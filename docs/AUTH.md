# Authentication

**BayAnalytics doesn't store your password because there isn't one.**

This build has no authentication. Every request is anonymous, and the only
credential in the system is the backend API key, which lives on the Next.js
server (`BAY_API_KEY`) and is attached by the proxy. The browser never sees it.

## The seam that is reserved

`lib/auth/session.ts` fixes the shape the rest of the app will build on:

```ts
type Session =
  | { kind: "anonymous" }
  | { kind: "user"; email: string; credentialId: string };

getServerSession(): Promise<Session>   // always anonymous today
```

`getServerSession()` is called by both proxy handlers (`lib/server/proxy.ts`)
on every request. It is the single place a future session lookup goes, so
adding authentication does not change the route handlers, the API client, the
SSE client or any finance component.

## The chosen model (not implemented)

Email + WebAuthn/device credential + a secure server session:

1. **Identify** — the person enters an email address. Nothing is sent to the
   backend yet.
2. **Register a credential** — the browser creates a WebAuthn credential
   (platform authenticator: Touch ID, Windows Hello, a passkey manager) bound
   to this origin. The server stores the public key and `credentialId` next to
   the email. Email ownership is confirmed with a one-time link or code before
   the credential is trusted.
3. **Sign in** — the server issues a WebAuthn challenge; the browser signs it
   with the credential; the server verifies the signature.
4. **Session** — on success the server sets an `HttpOnly`, `Secure`,
   `SameSite=Lax` session cookie holding an opaque session id (no JWT in the
   browser, no token in JavaScript). `getServerSession()` resolves that cookie
   to `{ kind: "user", email, credentialId }`.
5. **Proxy** — the proxy keeps attaching the server-side backend key exactly as
   it does now; the session decides whether a request is allowed and, later,
   which analyses a person can list (`GET /analyses` is prepared for an owner
   filter on the backend side).

Because the session is a same-origin cookie, the native `EventSource` used for
`/api/bay/analyses/{id}/events` sends it automatically; the SSE transport does
not change.

## What will never be added

- A password field, password reset, or password hashing.
- A bearer token in `localStorage`, `sessionStorage` or a JavaScript-readable cookie.
- Any `NEXT_PUBLIC_` credential.

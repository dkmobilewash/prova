### The Expo field-reports client, and the auth seam that actually lets a phone in (Diego)
`diego/expo-client`

PRs 1–2 built the phone's API but the auth seam only read the web cookie —
a phone's bearer token was ignored, so nothing mobile could sign in. This
adds a real Expo (React Native) app in `apps/mobile` and makes the API
accept it: `requireApiContext` now reads `Authorization: Bearer` via
Clerk's `auth()` instead of `currentUser()`, and maps the backend user into
the same adoption logic the web path uses (behavior unchanged for web). The
app signs in with Clerk, lists a job's field reports, and queues create/edit
offline — a retried create reuses its `clientOperationId`, and a stale edit
resolves last-write-wins against `clientUpdatedAt`. Checked by:
typecheck/lint across all five workspaces, the web auth tests still green,
and `expo export` bundling the mobile app. A real phone still needs a
reachable `EXPO_PUBLIC_API_URL` and the dev Clerk publishable key.

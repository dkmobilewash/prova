### The phone app: an Expo client for a job's field work, and the auth seam that lets it in (Diego)
`diego/expo-client`

PRs 1–2 built the phone's API but the auth seam only read the web cookie —
a phone's bearer token was ignored, so nothing mobile could sign in. This
adds a real Expo (React Native) app in `apps/mobile` and makes the API
accept it: `requireApiContext` now reads `Authorization: Bearer` via
Clerk's `auth()` instead of `currentUser()`, and maps the backend user into
the same adoption logic the web path uses (behavior unchanged for web). The
app signs in with Clerk and covers a job's field work end to end: field
reports (queued offline — a retried create reuses its `clientOperationId`,
a stale edit resolves last-write-wins against `clientUpdatedAt`), site
photos, safety (toolbox talks and incidents), time entries, material
orders, and punch lists (add an item and tick it off; `completedAt` is
stamped alongside `isDone`, and cleared when unticked). Checked by:
typecheck/lint, the web auth tests still green, `expo export` bundling the
app, and a Maestro click-through in the iOS simulator — punch lists verified
by adding an item, ticking it off, and reading `isDone`/`completedAt` back
from Postgres. A real phone still needs a reachable `EXPO_PUBLIC_API_URL`
and the dev Clerk publishable key.

### The mobile auth seam: /api/v1/field-reports, backed by one shared core (Diego)
`worktree-diego+api-auth-seam`

The Expo app needs an HTTP surface, and it cannot call the web Server
Action — a phone has no page, no FormData, and no server cache. The
sign-in adoption logic moved out of `loadCompanyContext` into
`adoptCompanyContext` (verbatim, including the verified-email gate and
the Prisma concurrency re-read), with a new `requireApiContext` that
returns null so a phone gets a 401 instead of a redirect to /sign-in.
The field-report logic moved into `lib/field-reports-core.ts`, which the
web action and the new `GET`/`POST` handlers at `/api/v1/field-reports`
both call — the web path is unchanged. Checked by: typecheck/lint green,
2595 tests green, and the four click-list cases (401 unauthenticated,
403 without MANAGE_FIELD, 400 duplicate date with the exact existing
sentence, 201 create + read-back).

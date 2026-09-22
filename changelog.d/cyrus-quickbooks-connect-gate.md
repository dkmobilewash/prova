### "Connect QuickBooks" no longer offers a button that cannot possibly work (Cyrus)
`cyrus/quickbooks-connect-gate`

Every other OAuth integration in this app — Jobber, Procore, DocuSign,
CompanyCam — already refuses to render a Connect control when the
install lacks that provider's env vars, via `requiredEnv` on
`lib/integrations/registry.tsx`'s `ProviderImplementation` and each
provider's own `*CardState` function. QuickBooks never got the same
treatment, because it predates that framework: its Connect button lives
on `/settings` (not `/settings/integrations`, where its card is a plain
`kind: "external"` link to `/settings`) and reads only whether a
`QuickBooksConnection` row exists — never whether `QUICKBOOKS_CLIENT_ID`,
`_CLIENT_SECRET` or `_REDIRECT_URI` are actually set.

`readQuickBooksConfig()` (packages/integrations/src/quickbooks.ts) throws
when those are missing. So on any install without them — a laptop, a
preview, any environment other than production today — pressing "Connect
QuickBooks" sent the browser to `/api/quickbooks/start`, which called
that function unguarded and 500'd. A dead button with extra steps, on the
one integration the product currently treats as its working example.

New `apps/web/lib/quickbooks-setup.ts` (`QUICKBOOKS_REQUIRED_ENV`,
`quickBooksSetup`, `quickBooksConnectCardState`) mirrors
`lib/jobber/setup.ts`'s shape rather than inventing a new one. Only three
variables, not four: QuickBooks stores tokens in `QuickBooksConnection`'s
own plaintext columns (the open plaintext-token issue #353, unaffected by
this change), never through `lib/crypto.ts`'s envelope, so it has no
`INTEGRATION_TOKEN_KEY` dependency to check. `/settings` now renders an
honest "Not set up on this install yet" sentence instead of the Connect
link when unconfigured, and `/api/quickbooks/start` refuses before
leaving the app in the same situation — the same discipline
`/api/jobber/start` already applies for Jobber — rather than reaching
`getAuthorizeUrl` and throwing.

**Deliberately not touched: `lib/integrations/registry.tsx` and
`/settings/integrations/page.tsx`.** Two other open PRs (#373 Bluebeam,
#374 ACC) are mid-review on exactly those files, and QuickBooks' card
there is not an OAuth-start control — it only links to `/settings`, where
the actual gate now lives. No schema change, no migration.

Never reads or logs a variable's VALUE anywhere in this change — only
whether each of the three names is present and non-blank. Nothing on
`/settings` or in `/api/quickbooks/start`'s redirect can carry one, which
`quickbooks-setup.test.ts` and `start/route.test.ts` both assert directly
with fixture "secret" strings.

Mutation-tested, 3 requested and 3 caught: `quickBooksSetup` forced to
report everything configured (RED — 6 tests across both new files),
`quickBooksConnectCardState`'s `!configured` check removed (RED — 1
test), and the route's early-refusal block disabled (RED — 3 tests, incl.
proof `getAuthorizeUrl` is never called, not merely its result discarded).
All three restored and reconfirmed green. No fourth mutation on the
`/settings` JSX wiring itself — this codebase has no precedent anywhere
for testing a `page.tsx` render directly (checked: none of Jobber's,
Procore's, DocuSign's or CompanyCam's sibling `*Controls.tsx` have one
either), so that one ternary is covered by `typecheck` + `build` +
the click-list, same depth as its four siblings.

Full `apps/web` suite: 322 files / 5235 tests green (15 new).
`typecheck`, `lint` (zero new warnings), `build`, `./scripts/preflight.sh`
all green. `dbtest` not run — no Postgres in this session, scratch-only
per CLAUDE.md.

**(a) vs (b), argued rather than picked**: chose (b) — render visibly
unavailable, honest sentence, no clickable control — matching what
Jobber/Procore/DocuSign/CompanyCam already do, for consistency across the
one page a contractor evaluating the product is most likely to ask about
("does this work with QuickBooks?"). Hiding the section outright (a)
would read as the feature not existing at all, which is false — it is
built and working in production. QuickBooks is not "obscure."

Fact this whole change turns on: **QuickBooks is the only integration
with real credentials behind it in production today** (Intuit sandbox).
Jobber, Procore, DocuSign and CompanyCam already render "Not set up" in
production right now, correctly, on `main` before this PR — this fix
closes the one remaining gap, on the one install (a laptop, or any
preview) where QuickBooks' own keys are the ones missing.

### Forward an email to your intake tray (Cyrus)
`cyrus/intake-email`

Onboarding paper arrives by email, and the tray now meets it there: every
company gets its own unguessable inbound address
(`docs-<32-hex-token>@<INTAKE_INBOUND_DOMAIN>`), shown on /intake with a
copy button. Anything forwarded to it lands in the tray exactly as a
drag-and-drop does — same `document-intake/<companyId>/` blob prefix, same
classifier, same "nothing files until a person confirms" — with the
sender and subject stored as display-only provenance on the row.

Provider is Resend, because it already sends this app's email and its
webhooks already carry the svix scheme the delivery route verifies — zero
new vendors. The receiving route
(`/api/intake/inbound/resend`) fails closed: 503 with no
`RESEND_INBOUND_WEBHOOK_SECRET`, 401 unsigned or mis-signed, and the ONLY
thing trusted in a verified payload is the recipient token — the From
header steers nothing. An unknown token answers a 200 byte-identical to
success, so the route is not an oracle for which addresses exist.
Resend's inbound webhook carries attachment METADATA only; the bytes are
fetched back from Resend's own API with our key, capped per file (the
tray's existing 25MB) and per email, with refusals named in the server
log rather than half-imported silently. A replay guard on the provider's
email id makes redelivery write nothing.

The owner can regenerate the address (two-step confirm) if it leaks; the
old token stops routing in the same UPDATE that mints the new one. The
confirm itself went through two shapes: it first hand-rolled its own
`useState` armed flag, and the armed-delete census
(`rowActionsCensus.test.ts`) caught it — that state matches the same
`(?:onfirm|rmed)` pattern issue #152 catalogued twenty times over,
because it is the same mechanism: an ordinary action next to a
hand-rolled arm/disarm with nothing stopping a sibling button from
sitting in the gap unguarded. It is `<RowActions>`/`<ConfirmDelete>` now
(`IntakeForwardBox.tsx`), `label="New address"` at 11 characters against
the census's 12-char ceiling, `pinned` left at its default "start" for
the left-aligned cluster, and `key={address}` on `<RowActions>` so a
successful regenerate — which changes the `address` prop it receives —
remounts the control disarmed instead of leaving it stuck armed with a
dead confirm button.

The specific checks: 23 tests drive the handler over real signed
requests with injected transport (22 on the inbound path, 3 on the
action's owner gate, one test doing double duty), and twelve guards were
mutation-tested this session, one at a time, each reverted before the
next — secret configured, svix headers present, bad signature, stale
timestamp, token-only company resolution (an attacker-supplied `from`/
`companyId`/`accountId` in the payload is never read), the declared-size
cap, the content-type allowlist, the cid-inline skip, the replay guard,
the unknown-token no-oracle drop, and both halves of the regenerate gate
(`MANAGE_JOBS` and owner). Every mutation failed exactly the test written
for it, and the suite was 23/23 green again after each revert.

One of the twelve caught a real gap rather than confirming the code:
disabling the "svix headers present" guard still passed its own test,
because that test removes ALL THREE headers and the timestamp check
downstream (`Number(null)` is far outside the skew window) already
answers 401 for that case — so the header guard was accidentally
unfalsifiable by the test that was supposed to pin it. A second case,
only the `svix-signature` header missing with a real `svix-id` and
current `svix-timestamp`, does fall through to
`verifyResendSignature(secret, id, timestamp, raw, signature)` with
`signature` null, which throws (`Cannot read properties of null (reading
'split')`) rather than returning 401 — an unhandled exception in a
webhook receiver, not a clean refusal. The guard as shipped already
prevents this (`!id || !timestamp || !signature`), so there was no
runtime bug; the gap was only that no test was capable of catching a
regression that removed it. `lib/intake/inbound.test.ts` now has that
case as its own test.

Migration `20260919150000_add_intake_email` is additive only: the token
column + unique index on Company, three nullable provenance columns and
one index on DocumentIntake, and a token backfill for existing companies.
No foreign keys, so the cleanup scripts and the FK census are untouched.

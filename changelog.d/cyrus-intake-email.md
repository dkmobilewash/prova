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
old token stops routing in the same UPDATE that mints the new one.

The specific checks: 22 tests drive the handler over real signed
requests with injected transport, and all ten guards were
mutation-tested — signature, headers, secret, timestamp, token-only
company resolution, both size caps, type allowlist, replay, owner gate,
and the no-oracle response identity — each mutation failing exactly the
test written for it, 22/22 green on restore.

Migration `20260919150000_add_intake_email` is additive only: the token
column + unique index on Company, three nullable provenance columns and
one index on DocumentIntake, and a token backfill for existing companies.
No foreign keys, so the cleanup scripts and the FK census are untouched.

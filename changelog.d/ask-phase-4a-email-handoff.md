### The Ask box drafts an email to a contact and opens the composer — phase 4a, the first outward command, and it never sends (Diego)
`claude/prova-ai-task-completion-96pjes`

"Email Turner that the studs are three weeks late" and "send the GC on
Riverside a note that pay app 3 went out Tuesday" now produce a card. The
tap is a link to `/messages?draft=<card>`, the composer opens with the
recipient, job, subject and message filled in, and the person presses Send
there — the same button, the same `sendOutboundEmail`, the same sentence on
failure as typing it by hand. Nothing about the card sends anything.

**HANDOFF by design, not by the redaction rule.** Every earlier HANDOFF
existed because the action behind it throws and production redacts thrown
messages. `sendOutboundEmail` returns `ActionResult`, so nothing stopped
this one being DIRECT — and it must not be. A tap that mails a real person
at a GC is the one write in this app nobody can undo, and the tier comment
in `commands.ts` names "outward send without a composer" as T5, which has
no member on purpose. So `send_email` is `T4_OUTWARD`, the first member of
that tier, and `commands.test.ts` pins that every T4 command is HANDOFF
with no `execute`.

**The model never supplies an address or a figure.** The person names a
contact ("Turner") or a job ("the GC on Riverside"); the address is read
off the `Contact` row the app resolves, through the same `resolveContact`
that `create_estimate_job` uses, with the same `contactId` chips when a
name matches several. The command's schema has no field for an address, so
one the model invents is dropped by `schemaInput` before `resolve` sees it
— pinned from the model and from a chip alike. A name matching nobody is a
refusal that says to add them on `/contacts` with an address; a contact
with no email on file is a refusal that links to their page. Neither is
ever guessed. The body is the person's own words passed through; the
subject is theirs if they gave one and otherwise derived from the message
by the RFI's own rule, with the card saying so.

**Refused before any read when sending is not set up.** The composer does
not render while `emailSetupProblem()` is non-null, so a card that opened
the page would be a dead end. The command checks first and refuses in the
setup sentence the page itself shows, pointing at `/messages`.

**Two decisions a reviewer may overrule.** The command is offered on
`MANAGE_JOBS` — the capability whose own doc comment reads "the
correspondence around them" — so FIELD, ESTIMATOR, PROJECT_MANAGER and
EXECUTIVE are offered it and ACCOUNTING and PAYROLL_COMPLIANCE are not,
though anyone can still open the composer by hand. And `/messages` stays
OPEN: it is on `lib/permissions.test.ts`'s open list with a reason
("sending is the action's problem, not the page's"), and gating it to
match the command would lock accounting out of a page they can reach
today. The HANDOFF invariant in `commands.test.ts` — the page a card opens
must be guarded by exactly the command's capability — is refined rather
than weakened: an open page is reachable by everyone offered the card,
which is what the invariant protects, and such a page must be listed by
hand with its reason (`OPEN_HANDOFF_PAGES`), so an unguarded target is a
decision in the test rather than an omission in the map.

**What the tests pin.** The command test runs `resolve` against a fake
Prisma and a fake email config: the setup refusal before any read, the
missing-message and missing-recipient questions, the no-match and no-email
refusals with their links, the two-match chip row on `contactId`, the job's
GC as recipient when only the job was named, the named contact winning
over the job's GC when both were given, chips re-asserted in-company, and
the exact payload the composer prefills from. `drafts.dbtest.ts` proves
against a real Postgres that `loadMessageDraft` loads that payload once for
the asking person and answers "gone" for an email card on the RFI page and
a punch card on the composer. The eval gains three `send_email` cases (a
contact by name, a job's GC, a FIELD member) and one `no_command` for an
ACCOUNTING member, who is not offered it; the old `none-email` case, which
expected no card for "email Turner the RFI", is retired because a card is
now the right answer. `commands.coverage.test.ts` sees `messages.*` leave
the wildcard list and `deleteOutboundMessage` get its own reason. FIELD and
ESTIMATOR gain `send_email` in "who is offered what"; ACCOUNTING does not.

**Not clicked, and what the eval has not measured.** Nobody has loaded a
page with this on it. The routing eval was not run from here (no key in
this container), so whether the model puts "Turner" in `recipientName`
rather than inventing an address is asserted by the schema and the test,
not yet observed. The click list, on a preview signed in as OWNER on the
Development Clerk instance, with `RESEND_API_KEY` and `OUTBOUND_EMAIL_FROM`
set on that preview (without them step 3 is the refusal, which is also
worth seeing once):

1. `/contacts` → confirm one contact whose name contains "Turner" has an
   email address, and note it. If two do, the card in step 3 is a chip row
   instead; pick one and continue.
2. Dashboard → ask "email Turner that the studs are three weeks late".
3. Expect a card headed "Send an email" with To: "<contact name> ·
   <that address>", Subject: "The studs are three weeks late", Message:
   "The studs are three weeks late.", Goes out: "when you press Send on the
   composer — not before, and not from this card", an amber line "Subject
   taken from the message…", and a button "Open the composer". An address
   other than the one on `/contacts` is a failure. A card with no button,
   or a "Working…" state, is a failure.
4. Tap it. Expect `/messages` with the composer already OPEN, To and Their
   name filled with the same address and name, Subject and Message as on
   the card, job "Not tied to a job". Check `/messages` shows NO new row
   yet — the tap sent nothing.
5. Press Send. Expect the composer to close and one new row at the top of
   the log addressed to that contact. Reopen the dashboard: the card is
   gone, not still offered.
6. Ask "email Skanska Nobody that the studs are late" (a name on no
   contact). Expect NO card and the sentence 'No contact matches "Skanska
   Nobody". Add them, with an email address, first.' with `/contacts`
   named. Any card is a failure.
7. Ask "send the GC on <a job name> a note that pay app 3 went out
   Tuesday". Expect a card whose To is that job's GC and whose Job line is
   the job, then a composer with that job selected.
8. In a browser signed in as a MEMBER with job function ACCOUNTING, ask
   step 2's question. Expect no card and a sentence that it needs job
   correspondence access (MANAGE_JOBS).

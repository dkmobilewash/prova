### The Ask box raises an RFI and adds a punch item — phase 2b, by handing the person to the page's own form (Diego)
`claude/prova-ai-task-completion-96pjes`

Two more commands, and a second MODE. "raise an RFI on Riverside about
the head-of-wall detail at the rated corridor: A-501/3 shows a deflection
track, the spec calls for a rated assembly, which governs?" and "add
'grid out of level, east corridor' to Maple's punch list". Neither card
has a button that saves. Its primary is a LINK to `/rfis?draft=<card>`
or `/punch-lists?draft=<card>`, and the page opens its existing form with
the job, the subject, the question, the references or the item filled
in. Save is the form's own submit, so `createRfi` and
`createPunchListItem` run exactly as they would for a person typing: the
same guards, the same counter number, the same sentences.

**Why a link and not a tap.** Both actions THROW their refusals, and
production redacts a thrown Server Action message. A DIRECT card over
either could only ever show a digest, which is why phase 2a's coverage
test refuses to register a throwing action as DIRECT. HANDOFF is the mode
for that case, and the type now says so: `CommandDefinition` is a union
of a DIRECT arm (has `core` and `execute`) and a HANDOFF arm (has
`handoffHref`, has neither), so a command that both executes and links
cannot be written. `commands.test.ts` also checks the page a HANDOFF
opens is the one `ROUTE_CAPABILITY` guards with the command's own
capability.

**What the page does with `?draft=`.** `lib/ask/drafts.ts` loads the
card only when it is this person's, in this company, for the command
that page owns, in HANDOFF mode, unsettled, unclaimed and unexpired —
and answers null for every other reason alike, so a card id in a URL
discloses nothing about whose it was. The browser sends the id and
nothing else; every prefilled value comes from the server-held `resolved`
payload, the same rule as the tap on a DIRECT card. The first load stamps
`openedAt`, which is what stops the dashboard reattaching a card whose
form is already open somewhere. A page opened with a card it cannot load
renders `<AskDraftNotice>` above the blank form rather than a silently
blank form — except for the person's own card already saved, since the
page after the form's save re-renders with `?draft=` still in the URL and
must not call a just-saved card gone; only the owner gets that
distinction. After the form's action succeeds, `settleAskDraft` records
the card as done; it does NOT re-read the payload, because the person
may have changed every field before saving, and what was saved is the
form's record — the card only ever proposed.

**No date is ever on the card.** The RFI's sent date stays the form's own
default, the person's calendar day, and blanking it there keeps the RFI
a draft; that is the form's rule and not restated here. A question given
without a subject gets one cut from the question's first words, and the
card says so, because the person edits it on the form either way. A
subject without a question is asked about, not padded into one.

**Cyrus's files touched, announced in #prova-build first and held for
his word:** the two pages read `?draft=`; the two forms take an optional
`draft` prop and call `settleAskDraft` after their own action returns.
Nothing in `lib/actions/rfis.ts` or `punchLists.ts`. The `rfis.*` and
`punchLists.*` wildcards become per-action exclusions in
`lib/ask/commands/rfis.ts` and `punchLists.ts`. The three DIRECT files'
private `findJob` moved to `commands/findJob.ts` since it now has five
callers.

**Verified, and how.** `drafts.dbtest.ts` runs the card end to end
against a real Postgres — loads once for the asker and not for a
colleague, the wrong page, DIRECT mode or after expiry; the tap refuses
it and leaves it unclaimed; the form settles it once; afterwards neither
the page nor the dashboard offers it. Run here on a scratch Postgres 16
with all 73 migrations applied, alongside the existing suite. Nobody has
clicked it; the list is in the PR body.

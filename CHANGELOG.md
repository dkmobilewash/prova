# Changelog

What actually changed, in plain English, newest first.

**Rule: update this in the same PR as the work.** A changelog maintained
separately from the code drifts away from it within a week — exactly how
FEATURE-AUDIT.md on `main` twice ended up claiming features that weren't
there. If a PR changes behaviour, it edits this file too.

Entries say what changed and why it mattered, not which functions moved.
`git log` already covers the functions.

---

## The demo dataset caught up with nine models it had never heard of

The seed was written against a schema that has since gained CRM contact
lifecycle fields, an interaction log, and a bid pipeline built over
`BidInvitation`. A demo dataset does not fail when that happens -- it goes
quietly stale, and the new screens read as broken rather than as unseeded.
Merging `main` in is what surfaced it, so this PR now seeds:

- `Contact.status` / `accountType` / `msaExpirationDate` /
  `prequalificationExpiresAt` on the two GCs, plus a third contact that is
  a PROSPECT with no jobs -- PROSPECT is meaningless on a contact that owns
  work, so it needed its own row. One MSA is deliberately lapsed and one
  prequal deliberately expiring: both states are DERIVED from a date and
  cannot be demonstrated by a default.
- Ten `BidInvitation` rows across three GCs, spread to make `/pipeline`
  show its edges rather than an average -- one WON bid with no amount
  recorded (so the value reads as a floor, not a total), one still open
  past its due date, and one GC with nothing decided at all, whose win rate
  must read as "not decided" and not as 0%.
- Six `ContactInteraction` rows, with follow-ups both overdue and upcoming.

And `undo()` covers both new tables. It scopes them by the demo CONTACT
rather than by the `[demo]` tag, the same way job children are scoped by
the demo job ids: a bid logged by hand against a demo GC while clicking
through a preview is untagged, would survive a tag-scoped delete, and would
then block `contact.deleteMany` on a foreign key -- which is precisely the
half-removed state this PR exists to fix.

Still not seeded, and named here so the next person does not have to
rediscover it: `Backcharge`, `CloseoutSubmission`, `OutboundMessage`,
`PrevailingWageRuleSet`, `Equipment`, `EstimateVersion` and `DispatchSlip`.
Their screens demo empty. The first four are Diego's lane and two of them
need counter rows, which is not something to guess at from outside.

Separately, `FEATURE-AUDIT.md`'s summary line on `main` was counting the
four rows of its own legend table as feature rows: it said 121 items /
88 built where the sheets sum to 117 / 87. The branch's `plumbing.test.ts`
is what caught it -- it was already wrong before this merge, and nothing on
`main` checks that arithmetic.

---

### Alerts can now email themselves, once per thing per stage (Cyrus)
`cyrus/notifications`

Sheet 26's five Partial rows all gave the same reason: **"Still no push."**
`#38` landed a sender, `#56` landed the alert engine, and neither knew the
other existed. This is the join, plus the ledger that stops it repeating
itself — which is the only genuinely hard part of it.

A button on `/alerts` sends one email covering everything you have not
already been told. Its most useful property looks like a failure: **click
it twice and the second click says there is nothing new to send.**

**Why a milestone and not a state.** A COI expiring in thirty days is still
true tomorrow. Notify on the state and you send the same sentence thirty
mornings running, and the person learns to filter you — the
six-platforms-and-abandon pattern from the competitor research, self-
inflicted. So nothing notifies on a state. A notice fires when a milestone
is crossed, once, ever, and the milestone is part of its identity rather
than the date it was sent: `RENEWAL:lic_1:2026-11-30@week`. The alert key
carries the FACT, so renewing the licence changes the key and every
dispatch against the old date stops applying — the same mechanism that
makes a dismissal lapse, with no expiry logic anywhere. The rung
distinguishes "this is coming" from "this has happened" about one
*unchanged* fact, which the key alone cannot.

**Per user, not per company.** Alerts are capability-filtered, so two
people legitimately have different lists. A company-wide ledger would let
the first person's send suppress the second's — and the person suppressed
is the one whose capability made it their job.

**The digest never composes a sentence about a situation.** An undated COI
and a job forecast over budget are both `STANDING` with a null date and are
indistinguishable in the `Alert` shape. The engine already says "no date
recorded" for one and the right thing for the other. A label generated from
the rung would email somebody that their certificate has EXPIRED when the
truth is that nobody typed a date in.

**Rows are claimed before the provider is called**, and
`@@unique([userId, dispatchKey])` is the lock, so a crash between sending
and recording is a notice that was sent rather than one that goes again
tomorrow.

#### Seven bugs, and what found each one

The suite was green through every one of these.

**The rungs read the wrong horizon table, and silently dropped the most
useful notice the feature sends.** My first version read
`ALERT_HORIZON_DAYS`, which has no `RENEWAL` entry — renewal horizons are
per renewal kind in `RENEWAL_HORIZON_DAYS` (licence 60, bond 60, COI 30)
and `Alert` flattens all four to the single kind `"RENEWAL"`. It fell
through to a 7-day default, so the sixty-day licence warning never went.
Nothing failed. The fix is better than the bug: the rungs are now NAMED,
and the loosest is *"the engine started calling this DUE_SOON"* — reading
`severity`, which already has each kind's horizon baked into it. A licence
fires at 60 and a COI at 30 with no table on the notifier's side at all.

**`messageId` was `@unique`.** A digest is one email covering many notices,
so the second notice in any digest would have failed to link. Found by
writing the probe that inserts three dispatches against one message.

**The delivery log read "sent · about a alert_digest".** Wrong twice in
four words, found by clicking it. `MessageRow` was rendering
``about a ${relatedType.toLowerCase()}`` — my own code from #38 — and it had
been wrong for `"RFI"` the whole time ("about a rfi"); nothing in the
codebase had ever set that value, so nothing ever displayed it. The
notifier is the first thing to write `relatedType` from code rather than
from a form, which is what surfaced it. Fixed with a label that carries its
own article, because the article is not derivable from the string: "an RFI"
comes from how the acronym is SPOKEN, and no vowel test on the letters gets
there. Free text from the composer is still shown as typed.

**An unconfigured provider burned every milestone permanently.** Found by
an adversarial pass after the click-through, not by clicking. `claim()` ran
before anything checked whether email was set up, and `sendEmail` only
discovers that internally — so the sequence was claim the keys, attempt,
fail, keys spent. Those licence warnings could then never be sent,
**including after email was configured**, because the ledger said they
already had been. This is not an edge case: it is the state every company
is in before somebody sets up a sending domain, so it is the likeliest
first click this feature will ever get, and it silently destroyed exactly
what the feature exists to deliver. Config is now checked before claiming,
and an unconfigured send takes nothing, sends nothing and writes nothing to
the log. The composer keeps its row on a failed send because a PERSON typed
that message; a digest regenerates itself exactly from the alerts, so a row
for mail that was never composed for a provider would record something that
did not happen.

**A provable non-send also burned the claim.** `sendEmail` fails three ways
and only one of them sets `mayHaveSent`. A `fetch` that threw never left the
machine; a provider refusal (bad key, unverified domain, 429) was rejected
outright. Both were keeping the claim. My own note said "a second copy is
worse than a late one" — but where nothing was sent, a second copy is
impossible, so the default was inverted. `mayHaveSent` now decides whether
the claim stands and it is the only thing that does. This one was worse
than the unconfigured case for striking long after everything worked: one
Resend outage during a nightly run and every milestone for every user is
spent for good, with nothing but FAILED rows to show for it. Releasing
never erases the FAILED event — the log is the only place anyone can see
what happened.

**The `rung` column described the wrong rung on every burned row.** Also
from the second-reader pass. `claim()` wrote the rung that FIRED onto every
key a notice consumed, including the looser ones it burned on the way past,
so a row keyed `…@approaching` recorded itself as a `week`. Nothing sent
wrong and nothing could — `dispatchKey` is the only column ever matched on,
which is why 43 unit tests and 12 database tests were green through it. What
was wrong is the column's whole reason for existing: it is stored so that
"why did this person get this email" is a query rather than string surgery,
and it answered wrongly for exactly the rows whose answer is not obvious
from the key. Fixed before merge rather than after, because the table does
not exist on `ep-little-sea` yet: two lines today, a backfill against a
ledger of what we told people once it does. `consumed()` now returns each
key WITH the rung that key names, which makes the old mistake unavailable
rather than merely corrected.

**A count of claimed rows is not ownership, and treating it as one sent two
emails about one licence.** Found reviewing this branch as a second reader.
`claim()` inserted with `skipDuplicates` and returned how many rows it
created; anything above zero was taken as "I won", and the digest then went
out covering every notice in hand. Two concurrent runs for one person do
not have to compute the same notices, and it takes no new record for them
to differ — a rung boundary crossed between their two reads is enough. One
run sees `approaching`, the other sees `approaching` + `week` and fires
`week`. The second wins one key, loses the other, counts 1, and sends. Two
emails, seconds apart, about the same licence: the nag this whole feature
exists to prevent, produced by the machinery meant to prevent it.

`claim()` now returns WHICH keys it created, via `createManyAndReturn`, and
a notice is ours only if we won **every** key it consumes — winning the rung
that fired is not enough, because losing one it burns means another run is
speaking about that alert right now. Keys won for a notice we then decline
to send are given back, so the tighter rung fires next run instead of being
burnt by a run that stayed silent.

Releasing what we won for a notice we decline to send cannot use the
`messageId` scoping described below, because at that point there is no
message yet. It matches on the won keys instead, which is a stricter test
of ownership than any column: a row this call did not insert is never in
the list, so it cannot be deleted by ours.

That release used to match `messageId: null` as well as its own message,
which was raised in review as an accepted risk and turned out not to need
accepting. Only the rung that FIRED is ever linked to a message, so every
`alsoSpent` row stays null for life — and two runs whose notice sets
overlap could each delete the other's. Narrow to hit, but the cost when it
lands is a duplicate carrying the LOOSER notice behind a tighter one
already sent, which reads backwards to whoever gets it.

Releasing only this call's own `messageId` closes it, and costs nothing:
the looser rungs stay spent and were never going to be sent anyway, since
the retry re-fires the rung it failed on with `alsoSpent` already in the
ledger. Both halves are pinned — the existing retry test would fail if the
release were too narrow, and the new one fails against the old code with
`expected [] to deeply equal [ 'approaching' ]` if it is too wide.

#### What this does not do

**Nothing runs unattended.** The digest goes out from a button, so it
reaches somebody who opens the app — the same reach the list already had.
That is why Sheet 26's rows stay Partial: the bar that sheet set for itself
("NOT Built until something pushes it") is met by the sending path and not
by the trigger. A scheduled run is the whole remaining gap.

Verified: 43 unit tests mutation-tested six ways, 12 database tests for
what unit tests cannot reach (the constraint really refuses a second claim,
a colleague's ledger is their own, a silenced alert never mails, and the
full three-way failure taxonomy including a transient outage followed by a
successful retry), and an 8-of-8 click-through on the preview against a
real licence entered through the UI — the run that found the delivery-log
wording. Step 6, delivery confirmation, is unprovable on a preview by
construction: a preview-sent message lives in the demo database and Resend
posts the event to production, which correctly ignores an id it has never
seen. #38 already proved that path on production.

Also worth recording: **the build type-checks `.dbtest.ts` files**, so a
type error in a database test breaks `next build` even though CI never runs
those tests.

Migration is additive — one `CREATE TABLE`, its indexes, three FKs, no
`ALTER` and no `DROP`. Generated with `migrate diff` against main's schema
rather than `migrate dev`, which offered to reset.

## The counter was wrong twice, the same way, and the second fix was mine

Browser testing passed all four fixes and then found the counter I had
just "fixed" reading 15 against a list of 16.

It was `blockers.length > 0`. A job whose checklist is ticked and which
NOBODY HAS SENT has no blockers, so it vanished from the number while
staying in the list -- and that is exactly the job somebody needs to chase.
The list uses `needsAttention`, which keeps it because the panel's own
stated rule is that a job is only off the list once the GC has ACCEPTED
its package.

Both versions of this counter were the same mistake: a SECOND computation
of what the list already decides. The first fix swapped a checklist-only
duplicate for a blockers duplicate and called it derive-don't-duplicate.
It is now `attention.length` -- the counter and the list are the same set
by construction rather than by agreement.

The lesson is about the test, not the code. My own click-list told the
tester to compare the counter against the "not ready" count, which is the
counter's definition rather than the requirement. It confirmed my
implementation instead of checking the claim, so it passed while the thing
was still wrong. A test written from the implementation cannot fail.

Also from that round:

Backcharge category defaulted to CLEANUP. Every other field on that form
is blank on purpose, and the schema's own default is OTHER; the form was
overriding a neutral default with a specific claim nobody made, so a
backcharge logged in a hurry became a cleanup backcharge with nothing to
say the tag was a default. Now OTHER.

The two-step delete put "Confirm delete" exactly where "Delete" had been.
A destructive second step under the first click is a one-step delete with
extra rendering. Cancel takes that position now.

NOT changed: date fields defaulting to "yesterday". Reported as a
systematic one-day lag; `localToday()` is correct and was executed across
six zones to prove it. At the time of the test the UTC date was the 3rd
and the local date in every American zone was the 2nd, which is what those
fields showed. Changing it would reintroduce the bug the helper exists to
prevent -- a foreman filing at the end of a shift dating the record a day
late. Worth re-reading this entry before anyone "fixes" it again.

ALSO NOT A BUG IN THIS FEATURE, and worth someone checking: the footer's
"Cash collected" moved 0 -> $500 mid-session with no payment logged. It is
`SUM(Payment.amount)`, and exactly one path in the app writes a Payment
(`lib/actions/billing.ts`). Backcharges and closeout reference Payment
zero times, so nothing in that test could have moved it. A row was written
by something else -- data, not display.

---

## The bidding relationship, as opposed to the list of bids

`/bids` lists invitations one per row and filters them. It cannot answer
the question a sub actually asks about a GC: do they keep inviting us, and
does it turn into work. `/pipeline` derives that per contact — invited,
bid, won, lost, declined, what is still live, and what is past the date
they asked for.

Read-only over `BidInvitation`, which belongs to the estimating lane. A
status is still changed on `/bids`; nothing here is stored, so a correction
there moves these figures with it.

**Win rate is null, not zero, until something has been decided.** A GC who
has invited us three times with every bid still open has not got a 0% win
rate, and a table printing one is how somebody talks themselves out of a
customer who is still deciding. `winRateLabel` says "no decided bids yet".

**A declined invitation is not a loss.** Declining is a decision we made,
usually because the job was wrong for us. Folding it into the rate would
punish good judgement and make "bid on everything" look like the way to
improve the number.

**A won-value total that skipped rows says so.** `bidAmount` is nullable,
so summing it across won bids gives a floor. The row renders "at least"
and names how many won bids carry no amount, rather than presenting the
partial sum as a total — the same defect as the $0.00 the browser found in
five fringe columns. Worth knowing that `/bids` itself still does the
silent version, filtering unpriced bids out of its total; that is the
estimating lane's to fix and is filed as an issue rather than changed here.

FEATURE-AUDIT's top line said 115 items / 85 built while its rows said 119.
Every PER-SHEET header agreed with its own rows; only the total was stale,
which is the signature of a merge keeping one side's totals line and both
sides' rows. Recomputed from the rows: 120 items now, including this one.

---

## What browser testing found in tests 1-5, and what it cost

Six real defects, all mine, none caught by 814 unit tests, 105 DB tests,
typecheck, lint or a clean build. Worth writing down because of WHAT the
green checks were blind to.

**Attaching a wage determination with no file and no link took down the
page.** Both inputs are labelled optional -- either one satisfies the rule,
neither alone is required by the browser -- and the action enforced "one of
them" with `throw`. Production redacts a thrown Server Action message to a
digest, so the rule arrived as the full-page error boundary and a reference
number. Three attempts, three crashes, read (reasonably) as data loss. The
form is now a client component that renders the returned refusal next to the
field. The rule this broke was already in CLAUDE.md; the action predated it
and nobody went back for it.

There are 146 more `throw new Error` in `lib/actions/`, twelve of them still
in `labor.ts`. Most are legitimate -- "Time entry not found on this job" is a
genuine bug and the boundary is the right place for it. The dangerous ones
are the subset that a USER can trigger by filling a form wrong, because
those turn a correctable mistake into a page crash with a redacted message.
That is the audit worth doing, and this fix only covered one action.

Also: the reference number was byte-identical across all three crashes.
That is correct -- React hashes the error to make the digest -- but it means
a support reference identifies an ERROR, never an incident. Don't ask a user
to quote one expecting it to narrow anything down.

**A green "Closeout complete" badge sat directly above "Not ready to submit
-- 1 punch item still open".** `lib/closeout-readiness.ts` derives readiness
across the checklist, punch items, callbacks and retainage. The panel used
it. The badge one line above kept calling the old checklist-only helper, and
so did the page's header counter -- which reported 0 outstanding jobs while
listing fifteen that each said they weren't ready. Two computations of one
concept, which is the exact thing "derive, don't duplicate" exists to stop,
introduced by the commit that added the better derivation and left the worse
one in place beside it. A badge that can only see the checklist now says
"Checklist done" and never claims the whole closeout.

**A refusal that outlived its input.** Settling a backcharge above the claim
was blocked by `max={claimed}`, so Chrome's own tooltip fired and the
action's real sentence -- that a bigger number is a NEW backcharge, not this
one growing -- was unreachable. The attribute is gone; the server owns the
rule. Separately, the previous refusal stayed on screen after the field was
edited, so "Settling at the full $4200.00 is accepting it" sat under an
input reading 5000. Forms clear the error on input now.

**"In force from" was pre-filled with today.** Every other field on that
form defaults to empty on purpose, because a blank threshold means nobody
looked it up. A defaulted start date silently asserts the rules began today,
which is the same invented value. Removed. `localToday()` is for "this is
happening now", not for when a law took effect.

Smaller: one money string used `.toFixed(2)` while its neighbour used the
shared formatter, so the same number appeared as `$4,200.00` and `$4200.00`
two lines apart; and "Mark done" opened an editor rather than marking
anything done, now "Mark done...".

The clicked-through finding underneath all of these: **green checks confirm
the code does what it says, and every one of these bugs was the code saying
two different things in two places.** Only loading the page catches that.

---

### You can now take all your data out, without asking anyone (Diego)
`claude/prova-vercel-direct-url-hg1acx`

There was no export in this codebase at all. CSV came IN through the catalog
importer and nothing ever went out — a grep for `text/csv` or
`Content-Disposition` returned exactly one file, and it was the importer.

Competitor research found the same complaint at four separate vendors: no
clean way to get your history out when you leave. One put a 50% price rise in
front of the door and then locked the account; another's sales team promised a
full export that never arrived. That is a retention mechanism rather than an
oversight, which makes it a business-model choice to be better at rather than
an engineering problem — and it was the cheapest item on that whole list.

`/settings/export` shows all 18 tables with a **row count beside each, before
anything is downloaded**. That matters more than it sounds: "here is a file,
trust us" is what the incumbents do, and a number somebody can check against
what they see on screen is the difference between an export and a promise of
one. The page also states what is deliberately NOT in the file, and the JSON
repeats it inside the file, because the file is what outlives the account.

**The column lists are an allowlist, and that is the security of the feature.**
A denylist of fields-not-to-export is correct exactly until somebody adds a
column, and then it leaks silently with every check green. An allowlist fails
the other way: a new column is simply absent until a person adds it, and
absence is visible where a leak is not. There are six credential columns in
this schema and two are PLAINTEXT (`QuickBooksConnection.accessToken` and
`.refreshToken`); `Contact.portalToken` and `SignatureRequest.token` are live
bearer keys. `export.test.ts` reads the .prisma files, collects every field
matching a credential pattern, and fails if one reaches a column list — and
asserts it found the known six first, so it cannot pass by finding nothing.

Two formats, deliberately not the same file twice. CSV neutralises leading
`=` `+` `-` `@` so a description reading `=1+1` is shown by a spreadsheet
rather than run by it; those values arrive from CSV imports and GC documents,
so "only what our own users typed" is not a defence. That makes the CSV not
byte-faithful, which is why the JSON exists beside it and does not do it.

Three things only running it caught. Prisma returns `Decimal` objects for
every money and quantity column, so the JSON branch turned 4200 into
`"""4200"""`. The db-test's isolation check first PASSED against a database
the file had already emptied — vitest runs a describe's `afterAll` before the
next describe, so "contains no other company's rows" was true of nothing at
all; the non-vacuity test beside it is what told the two apart. And the
browser test reported HTTP 503 on every download while the runtime logs showed
six 200s: the extension cannot follow a `Content-Disposition: attachment`
response and reports that as a server error. The files had downloaded fine.

Verified on a preview against `ep-patient-lake`: files land, and all six
credential field names return zero matches in the JSON — with a positive
control searched first, so the zero means something.

### Carry the stale-save fix to the other eight forms (Diego)
`claude/prova-contractor-os-e3f0iz`

When the browser found two union-compliance forms leaving the page stale
until a manual reload, I fixed those four components and deliberately did
not touch the rest: I had not root-caused the difference, and blind-
changing eight more on a hunch seemed worse than learning which ones
actually exhibited it.

That was the right call then and the wrong one to keep. Tests 1-5 exercise
`/backcharges`, `/closeout`, `/alerts` and `/prevailing-wage`, and every
client component behind them uses the identical pattern — action returns,
`revalidatePath` fires, component sets its own state — with **no**
`router.refresh()`. Waiting so the test could tell me whether the bug is
universal puts my curiosity above a defect a user will hit; and
`router.refresh()` is idempotent where `revalidatePath` already worked, so
the downside is a wasted round trip and the upside is a save that visibly
saved.

All twelve write paths now refresh: backcharges (row + form), closeout
(panel + job card), alerts, prevailing wage (form, row, determination
picker) and the four union ones from last time.

Still not a diagnosis, and the comment in each file says so. If a stale
save is reported after this, that is a much sharper signal than before,
because the obvious remedy is now in place everywhere.

A note on how this was applied, since the first attempt failed usefully:
the patch script anchored on a guessed list of import lines,
`CloseoutJobCard` carries `type ReactNode` in its React import, and the
assertion fired **after** three files had already been written — leaving
them with an unused `router`. Reverted and redone anchoring on each file's
actual import line by regex. The scar this repo already records — "edit
code by reading the actual text and replacing it exactly" — applies to the
list of anchors as much as to the anchor itself.

814 unit tests, typecheck, lint and a build without `NODE_OPTIONS`, all
clean. No schema change.

---

### Five things the browser found that no test could (Diego)
`claude/prova-contractor-os-e3f0iz`

Test 6 of the click-list passed 12 for 12 — the first of the six features
to be genuinely exercised rather than argued for. The value was in the
section it was asked to add at the end: *anything that looked wrong that I
did not ask about*. Five of six findings were real, and not one of them
was reachable by a unit or database test, because in every case **the
numbers were right and the rendering or the wording lied**.

**The apprentice row printed `$0.00` in all five fund columns.** The copy
promises, twice and emphatically, that unpriced hours are "reported as
unpriced rather than as $0". The word "unpriced" was on the row — beside
five zeroes. Anyone reading the column, exporting it, or adding it up
takes away "nothing owed", which is the exact opposite of what is known.
`isWhollyUnpriced` now blanks those cells to em-dashes. A row with SOME
priced hours keeps its money: that money is genuinely owed on the hours
that priced, and blanking it would swing the error the other way. No
figure changed; only the claim the table was making.

**Two forms left the page stale until a manual reload** — a saved local
still reading "No locals recorded", an ended rate still badged "in force"
— while the others updated live. Every one of these actions calls
`revalidatePath` and every form invokes them identically, so I could not
root-cause the difference without a browser, and **this is not a
diagnosis**: `router.refresh()` after a successful write is the fix that
holds whatever the cause. It matters more than tidiness — a save that
looks like it did nothing gets clicked again, and no create action here is
idempotent, which is the same reasoning behind #19's disabled buttons.

**"1 time entries".** The one message an inspector-facing user reads
carefully. Pluralised, and now pinned by a test rather than trusted.

**A day can read "can't be judged" and still be priced**, which looked
like the page contradicting itself. It is not, and the behaviour is
unchanged: a rate hangs off the classification, a ratio needs the tier,
and those are different facts — hours whose rate is known are genuinely
owed to the fund whatever the tier says. What was missing was anywhere
saying so, so the remittance section now does. The report was right that
it reads as a contradiction; it was wrong that the number was.

**The CBA date fields defaulted to today.** Nearly every real agreement
and rate started in the past, so a default there is wrong more often than
right — a soft version of the stamping this codebase refuses everywhere
else. Blanked, with the reason on screen. The "end it" dates keep today,
because ending something IS a do-it-now action.

**One finding was a false alarm, and checking it was still worth it.** An
agreement ended today still shows "Current". `effectiveTo >= today` is
date-derived and inclusive, consistent with `findEffectiveRuleSet` — it
flips tomorrow on its own, and an agreement in force through today is
current today.

814 unit tests, 105 db tests, typecheck, lint and a build without
`NODE_OPTIONS`, all clean. No schema change.

---

### Two click-list assertions that no test could reach (Diego)
`claude/prova-contractor-os-e3f0iz`

Asked to run the browser click-lists and unable to — the agent proxy
refuses CONNECT to `app.cstream.ai` with a 403, and there is no Clerk
session here — I went looking for which of their assertions were not
proven anywhere. Two were not, and both were the headline claim of their
feature.

**`reviewJobWeek` had no test at all.** Not a unit test, not a database
one. It is the function behind "entered 10 straight, rules imply 8
straight, 2 OT", and it is where the parts that can silently disagree
meet: the rule set reached through the job's wage determination, the
entries grouped per employee, the week window. It now has seven, including
the one worth executing rather than reasoning about — **two people each
working eight hours is not a sixteen-hour day**, and pooling them would
manufacture overtime nobody worked.

**The closeout page composed readiness inline**, so the step that turns
real punch rows into readiness inputs could not be run. The unit suite
covered `closeoutReadiness` with inputs a test wrote by hand; nothing
covered the part that produces them. That is exactly where the feature's
headline claim lives — an open punch item holds closeout open even when
"punch list sign-off" is ticked — and it was the one thing untested.
Extracted to `lib/closeout-query.ts`, which is the fetch/decide split
every other feature here already follows and the reason those halves are
testable. The page is 80 lines shorter and does no composition.

Seven more db tests there, including the contradiction stated directly:
the checklist still reads complete while the punch rows say otherwise, and
the real data wins.

105 db tests (was 91), 811 unit tests, typecheck, lint, and a build run
without `NODE_OPTIONS` all clean. No schema change.

**What this does NOT do, plainly: it is not the browser test.** Tests 1
and 3 were already covered at this level; test 4's real assertion —
typing `/cash-flow` as a field user and getting "Not part of your access"
— cannot be executed without a browser, and neither can any claim about
what a page actually renders. These close the gap between "the logic is
right" and "the query reads what it claims to". The gap between that and
"the screen does the right thing" is still open and still needs a person.

---

### The union compliance page had no way to enter its own data (Diego)
`claude/prova-contractor-os-e3f0iz`

Found by writing the browser click-list and noticing that step one of test
six was impossible. `/union-compliance` reads five tables —`UnionLocal`,
`CompanyUnionAgreement`, `CraftClassification`, `FringeRateSchedule`,
`ApprenticeRatioRule` — and **not one of them had a create action anywhere
in the app**. The engines were verified against a database only a test
could populate. On a real account both sections rendered empty, and the
empty state helpfully pointed at `/settings`, which does not have that UI
either.

That is the defect this repo keeps catching in other people's work — a
control that looks like it works and cannot — and I shipped it, then
marked the sheet Built. FEATURE-AUDIT already records the same failure
against the licence row ("Built on the model alone from 25 Aug until 29
Aug, during which no licence could be created at all"); Sheet 01's union
row had been in exactly that state since 24 August and now says so.

The CRUD lives on `/union-compliance`, beside the reports that consume it,
so the distance between "no rate recorded" and the place to record one is
one screen.

**Three of these tables are global**, and that shapes the behaviour. A
local another contractor already recorded is **adopted**, not rejected —
two companies under Carpenters Local 300 are under the same real local,
and a duplicate-key error would be the app calling a true fact taken. The
local and the agreement are created **together**, because a local with no
agreement is invisible to the company that just typed it in.

**Ended, never deleted** for agreements and rate schedules: payroll filed
under them has to keep computing to the same figures. A classification
with work tagged to it refuses deletion and says how many records — the
foreign key alone would throw an error production redacts to a digest,
telling the person nothing.

**A latent bug fixed on the way past.** `ApprenticeRatioRule` permits
several rows per local and `loadRatioReviews` keys a Map on
`unionLocalId`, so a second rule would have decided the ratio by whichever
row sorted last. `setApprenticeRatioRule` now replaces rather than adds,
and the query orders deterministically so the read is safe whatever is in
the table. A ratio check whose answer depends on row order is worse than
none.

The test that matters is not that the actions return ok: it is that a
company starting from **nothing** reaches a priced remittance and a judged
ratio using only these actions. It does. One assertion in it initially
read 184 and the code returned 72 — and the code was right: an earlier
step had ended the January rate and started a June one, and the August
hours correctly priced at the June rate. That is effective dating working,
proven end to end through the UI's own actions.

12 new db tests (91 total), 811 unit tests, typecheck, lint and a build
run WITHOUT `NODE_OPTIONS` — the way Vercel runs it — all clean.

---

### The production build was out of memory, and the heap was not the lever (Diego)
`claude/prova-contractor-os-e3f0iz`

#56's production deployment died `out_of_memory`, exit **137**. #57 raised
`NODE_OPTIONS` to 6144 and it died the same way, exit 137 again. Recorded
because the second failure is the informative one.

**134 and 137 are different failures.** 134 is V8 reaching its own heap
limit; 137 is SIGKILL — the container ran out of RAM and the kernel killed
the process. Raising `--max-old-space-size` only helps the first. Against
the second it makes things worse, because it tells Node it may grow
further into memory the container does not have. Reproduced locally: the
build OOMs at 4096 AND at 6144, and the stack is in
`String::SlowFlatten` / `NewProperSubString` during NFT's trace step —
not during compile, which finishes in 23 seconds.

The cause is in `next.config.mjs`, and it predates this work:

```
"/**": ["../../node_modules/.pnpm/**/node_modules/.prisma/client/**"]
```

That leading `**` makes the tracer walk every one of the ~473 package
directories in the pnpm store, and `"/**"` asks for that on EVERY route.
The cost is routes × store size. It was survivable at 30 routes and stopped
being survivable when this branch and `cyrus/messaging` added their pages
in the same afternoon — which is why it looks like #56 broke it and is
really #56 tipping something already loaded.

Anchoring the first segment at `@prisma+client@*` turns 473 directory
walks per route into one. The build now completes at **4096**, below even
Vercel's default, and the engine binary is still force-included — verified
by grepping the `.nft.json` traces for `libquery_engine-rhel`, which is the
one the deployed function actually loads. That check matters more than the
build passing: losing it fails at RUNTIME with "could not locate the Query
Engine", which is a worse outcome than a red build and is exactly what the
comment above that entry warns about.

#57's `NODE_OPTIONS` is left in place. It is not what fixed this, but with
peak memory down it is harmless headroom against the 134 failure mode.

**My own part in this, plainly:** every local build I ran during the six
features had `NODE_OPTIONS=--max-old-space-size=8192` exported, so I never
saw what Vercel sees. Cyrus flagged this exact shape about `preflight.sh`
in Slack — a check that passes on a laptop while the real one fails — and
I then did the inverted version of it to myself.

---

### Union fringe remittance and the apprentice ratio, both unblocked (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 09 had three Missing rows, and Sheet 26's last Missing row said the
apprentice-ratio alert was "blocked on apprentice tracking not existing
yet". `ApprenticeRatioRule`'s own schema comment said the daily check
could not be built because there was no labor/time-entry data model.

`TimeEntry` landed weeks ago and closed half of that. The other half was
that nothing said which side of a ratio a classification sits on —
`CraftClassification` had a name and nothing else. **Deriving the tier by
looking for the word "apprentice" in a free-text name would be a guess
that fails silently on the first local that words it differently**, so it
is a column: `tier`, nullable, no backfill. Both stale comments are
corrected rather than left standing.

**The rule that makes the ratio check trustworthy: unclassified is never a
pass.** Hours on a craft with no tier are not counted as journeyman hours
— the day reads "can't be judged". Counting them would make a job look
compliant because nobody had finished tagging its crafts, turning a setup
gap into a false clean bill of health on the exact record an inspector
asks for. Same for a day with apprentice hours and no ratio rule recorded,
and a day with no apprentice hours is "not applicable" rather than
evidence of compliance.

**Checked per day, never averaged.** A crew running two apprentices to one
journeyman on Monday is out of ratio on Monday; a weekly average hides
exactly the day that gets asked about. Measured in hours, which is what
`TimeEntry` holds — a headcount derived from it would count a two-hour
visit the same as a full shift.

**The remittance breaks the money out by fund** — pension, vacation, H&W,
training as separate figures, because that is how the form is filled in
and how the cheques are written. A single "fringe" total would have to be
taken apart by hand, which is the re-entry this product exists to remove.
It reuses `findEffectiveFringeRateSchedule` rather than a second copy of
that lookup, and pays fringe at the flat rate regardless of pay type
(Davis-Bacon) — getting that wrong would overstate every month containing
overtime. Hours it cannot price are counted and the workers named, never
valued at $0: under-reporting a trust fund is the expensive direction to
be wrong in.

**Sheet 26's last Missing row is now Partial**, not Built — the alert
exists and finds the days, and there is still no push, like every other
row on that sheet. It is STANDING rather than dated: the day is past and
cannot be fixed by acting sooner, so a severity that escalated with the
calendar would invent a deadline that does not exist. What can change is
tomorrow's crew.

**Sheet 09's third row is Partial, not Built.** `apprenticePeriod`
identifies the step and hours per apprentice are derivable, but the
program side — registered enrolment, the sponsor, classroom hours,
progression sign-off — needs the program's own data model and cannot be
derived from hours logged. Calling that Built would be the claim this
audit keeps catching.

Two failures worth recording. `UnionLocal` is a GLOBAL table unique on
(parentInternational, localNumber), so a fixed test local collided with
leftovers from an earlier run — stamped per run now. And the typed
`Record<AlertKind, string>` on the alert labels refused to compile when
the new kind had no label, which is the type system catching a gap that
would otherwise have shipped as a blank badge.

24 unit tests across the two engines, 9 db tests. `pnpm test` 524 → 548,
79 db tests, typecheck/lint/build clean.

---

### Prevailing wage rule sets — the rules, never the rates (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 21's missing row was "state-specific prevailing wage rule sets", and
ARCHITECTURE.md had explicitly ruled a rules engine out: no licensed
wage-rate dataset, same reason NV licensing was left unseeded. That
reasoning is still right and this does not overturn it. It corrects a
conflation in it.

A wage DETERMINATION says what a classification pays. A jurisdiction's
RULES say when an hour becomes overtime, when it becomes double time, what
the seventh straight day does, and how soon the report is due. The second
is not a rate and never needed a dataset — it needed somebody to write it
down. `PrevailingWageRuleSet` is where they write it down, with the
citation next to it.

**Null and zero are different, and the whole honesty of the feature is in
that gap.** A blank threshold means nobody looked it up, and the review
reports that week as *unchecked* — never as compliant, never assuming
eight. Zero means the premium starts at the first hour, which is how a
seventh-day rule is usually written. An app that filled in "California is
8 and 12" from nowhere would be asserting law it was never told.

Effective-dated, for the same hard reason `FringeRateSchedule` is:
reviewing last year's timesheet has to use last year's rules. Non-overlap
is enforced by a **Postgres exclusion constraint**, hand-written raw SQL
like `FringeRateSchedule`'s, because two overlapping rule sets would make
"the rules that applied that week" depend on row order. Prisma does not
know that constraint exists, so the action catches the untyped P2010 and
returns a sentence.

**What the review does.** Per employee — never pooled per job, because two
people each working eight hours is not a sixteen-hour day and pooling them
would manufacture overtime nobody worked. Daily rules first, then the
weekly threshold converting straight hours from the LATEST days: you cross
forty at the end of a week, not at the start. It **never rewrites a
`TimeEntry`** — it reports where the entered pay types and the recorded
rules disagree, exactly as `compliance-expiry.ts` reports a stored licence
status contradicting its own date, and a person decides which is wrong.

**One field earns its keep elsewhere.** `filingDueDays` replaces the
certified-payroll alert's hardcoded seven days when a jurisdiction has
recorded a real one — and the alert says which of the two it used, because
"due in 7 days" from a citation and "due in 7 days" from our own default
are not the same claim.

**A failing test caught a real defect in my own process.** The exclusion
constraint was appended to the migration file after `prisma migrate dev`
had already recorded it, so the scratch database never got it and the
overlap test passed an insert that should have been refused. Fixed by
dropping and rebuilding the scratch database from the committed migrations
— which is the only thing that actually proves the file as committed
produces the schema claimed. 50 migrations, constraint present, overlap
refused, adjacent ranges and other jurisdictions allowed.

21 unit tests on the rule engine, 12 db tests, `pnpm test` 500 → 524, 70
db tests, typecheck/lint/build clean.

---

### The three pages that were leaking cost to the field tier (Diego)
`claude/prova-contractor-os-e3f0iz`

The permissions commit shipped with a named gap: `/jobs/[id]`,
`/dashboard` and `/contacts/[id]` still showed a FIELD user cost, margin,
invoiced totals and payment reliability. They are in the other lanes, so
they were listed rather than half-edited. Diego said do them, so they are
done.

All three are reachable by everyone — a foreman needs the job, the
schedule and the GC's phone number — so they are narrowed, not refused.
Each computes two flags once at the top (`showsJobMoney`, `showsBilling`)
rather than per section, so the contract summary, the WIP table and the
change-order log cannot end up disagreeing about whether this reader may
see a price. Both are true for an owner and for a member with no job
function set: all three pages render exactly as they always have for
everyone who has ever used them.

Withheld from a job function without `VIEW_JOB_COSTS`: the contract
summary, the subcontract agreement and signing link, job costing & WIP,
the estimate line items and the change-order log, job health, pipeline
value, per-job contract value. Without `MANAGE_BILLING`: invoices,
retainage, pay applications, the overdue and retainage-held tiles, the
whole Money section, and a GC's payment reliability.

**Whole sections, never filtered ones.** A WIP table with the money taken
out is still a WIP table, and half a screen of blanks reads as broken
rather than as withheld.

**The one that was a data question rather than a markup question.**
`ReceivablesProvider` is a client component, so everything handed to it
reaches the browser whether or not a list renders it. Hiding the panel
while still shipping the rows would have been exactly the "looks enforced,
is not" failure this pass exists to close, so it now receives
`rows={showsBilling ? today.receivables : []}`. Everything else on these
pages is a server component, where an unrendered section never reaches the
browser at all.

`lib/page-money-guards.test.ts` is a static regression guard and is honest
about it in its own header: it asserts each page still consults `can()`
and still references its flags. It cannot tell you a guard wraps the right
section — the click-list does that. What it catches is a refactor dropping
the import and restoring the hole with every test still green.

Sheet 25's second row stays **Partial**, now for one reason instead of
four: there is no mobile SURFACE. This is the same responsive site,
narrowed, and an offline-capable field app with camera capture is a
separate build, not a permission.

`pnpm test` 493 → 500, 58 db tests, typecheck/lint/build clean.

---

### Roles that mean something, and the holes they do not close yet (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 25 was 0 built: two values in `UserRole`, no tier below MEMBER.

**`UserRole` is untouched.** It still has two values and still answers one
question — can this person administer the account. Every `assertOwner()` in
`lib/actions/*` keeps meaning exactly what it meant. Job function is a
second, orthogonal column, because folding "estimator" and "foreman" into
the same enum would have made every existing owner-only guard ambiguous
overnight.

`User.jobFunction` is nullable with **no backfill**, and that null is the
whole safety argument: it means nobody has said, and the person keeps the
access every member has always had. Nobody loses anything the day this
ships. An OWNER holds every capability regardless of it — an owner locked
out of their own books by a dropdown has nobody to undo it on a
single-owner company. An unrecognised value falls back to full access
rather than none, since it is far more likely a newer enum member than an
attack.

**`requireCapability()` on the page is the boundary; the nav filter is
decoration and says so in its own comment.** Hiding a link hides nothing.
A test asserts `canReach()` and `can()` agree on every guarded route for
every principal, so a link can never point at a door that will not open —
nor, far worse, a door be left unlisted and unguarded.

**Auditing my own claim found real holes, and closing the ones I own
changed the shape of the work.** A FIELD user could still be told, by name
and to the dollar, that a $42,000 backcharge was unanswered — because
alerts had no notion of permission. They now carry the capability their
SUBJECT needs, and money figures are stripped from the ones a restricted
person may otherwise see: that the GC has sat on the closeout package for
six weeks is operational, what it holds up in dollars is not. `/closeout`
hides retainage the same way, and the company metric bar — money along the
bottom of *every* screen — is withheld entirely. A permission enforced on
`/cash-flow` and then rendered on every other page is not enforced.

**What it still does not close, said here rather than found later.**
`/jobs/[id]`, `/dashboard` and `/contacts/[id]` show a FIELD user cost,
margin, invoiced totals and payment reliability. All three are in another
session's lane. Half-editing someone else's page to close a permissions
hole is worse than naming it — a page that filters in one place and not
another reads as enforced when it is not. Sheet 25's second row stays
**Partial** for that reason, plus there being no mobile surface, only the
same responsive site narrowed.

Verified: 15 unit tests on the capability map (including the exhaustive
nav-versus-guard agreement check), 5 on the alert filter, and 8 db tests —
the column arriving null and costing an existing member nothing, a
non-owner refused outright, another company's member refused, an owner
refused a job function with a reason, and an owner still holding
everything even if the column somehow says FIELD. `pnpm test` 473 → 493,
58 db tests, typecheck/lint/build clean.

---

### Alerts: derived, ranked, and possible to acknowledge (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 26 was the last section reading 0 built, and its own notes said why:
"it reaches someone who opens the app — still no delivery channel, so it
reaches nobody who doesn't. NOT Built until something pushes it."

**That bar is not met and I did not pretend otherwise.** There is no email
sender on main, so nothing here pushes anything, and four of the five
existing rows stay Partial. What shipped is the half that was actually
missing underneath the delivery question: alerts with an identity, one
ranking across every kind, a place reachable from every screen, and a
record of whether a person has dealt with one.

**There is no `Alert` table and there is not going to be one.** Every alert
is derived from the record it is about, on every render — a COI expiring
is its `expiresAt`, a backcharge going unanswered is its `respondByDate`
against its status, retainage coming due is withheld-minus-released
against an accepted closeout package. Six sources, all through the
existing implementations rather than second copies: renewals via
`compliance-expiry.ts`'s ranking, WIP variance via `jobIsOverBudget`,
retainage via `calculateRetainageSummary`.

**The one stored thing is a person saying they have seen one**, and the key
is what keeps that honest. An alert's key carries the fact that would
change it — `RENEWAL:license_abc:2026-11-30`, not `RENEWAL:license_abc`.
Renew the licence and the key moves, so the dismissal stops matching and
the alert comes back when the new date does. No expiry logic, no sweeper
job. Acknowledgements are per USER: dismissing on a colleague's behalf is
the worse failure, since the real fix clears it for everyone anyway.

**Two alerts are deliberately quieter than they could be.** Certified
payroll is raised only for a job carrying a `PrevailingWageDetermination`
— it is not required on private work, and nagging about every job trains
people to ignore the one that matters. Retainage grounded on
`Job.substantialCompletionDate` says "worth confirming the job actually
reached it" rather than asserting money is owed, because that column is a
forecast, not a record that substantial completion happened.

**A bell in the top bar, on every screen, that renders at zero.** A control
that disappears when it has nothing to say cannot be trusted to appear
when it does.

Verified against real rows: `alerts-query.dbtest.ts` drives the whole
engine through Postgres — the backcharge alert appearing and then dropping
the moment it is answered, retainage becoming collectable only once the GC
accepts the package and falling away as it is released, certified payroll
silent until a wage determination exists and cleared only by a report
whose period covers the WHOLE week (a clipping one is not evidence), a
dismissal silencing one user's list and not another's, and that same
dismissal failing to silence the next deadline on the same backcharge. 14
db tests plus 29 unit tests on the engine. `pnpm test` 444 → 473;
typecheck, lint and build clean.

---

### Closeout that names what is holding it up (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 22 read 3 built / 0 partial / 0 missing and was, for what it listed,
correct — punch lists, the checklist, warranty periods and callbacks all
shipped in August. The gap was between two rows rather than inside one. A
job could show a complete checklist and a $13,420 retainage balance for
four months, and the page had no way to say whether that was because
nobody had sent the package or because the GC was sitting on it. Those are
opposite problems with opposite fixes.

`CloseoutSubmission` (+ its counter) records the package going over and
coming back — several attempts per job on purpose, like `SubmittalRevision`,
because a package that bounces goes again and collapsing that into one
editable row erases the fact that we sent it on time the first time.
Attempts never reissue a number. Sent and answered dates are entered. A
rejection must record what was missing: whoever assembles the next package
needs it, and that is the difference between one more attempt and two.

**Submitting is deliberately not gated on a complete checklist.** Packages
go out short a document with the missing one promised to follow, and a log
that refuses to record what happened stops being a log. The blockers show
next to the submission instead — "the package went anyway" is worth
knowing before the GC comes back asking.

**`lib/closeout-readiness.ts` derives whose move it is.** Not ready →
ready to submit → with the GC → sent back → accepted, plus an ordered
blocker list and the retainage each job is holding up. Three calls in it
matter: an open punch item blocks closeout even when "punch list sign-off"
is ticked (the checklist is an assertion, the punch rows are what
contradict it); once the GC has answered, the submission decides the stage
so a callback the week after acceptance is warranty work rather than
something that un-closes the closeout; and an empty checklist is a
blocker, not a pass.

The page now opens with **What to do next** — every job that needs
something, most money first, naming the blocker and the retainage behind
it. The retainage figure goes through `calculateRetainageSummary`, the
existing implementation, not a second sum. This page's own first sentence
has always said a missing lien waiver is money sitting with the GC; it had
never once shown the number.

**Files touched outside my own:** `CloseoutJobCard.tsx` gained a
`packageSlot` prop and one line rendering it, and `/closeout/page.tsx`
gained the query and the band. Everything else is new files. `PunchListItem`,
`punchLists.ts` and `/punch-lists` are read and not modified.

Verified the same way as backcharges: `closeoutSubmissions.dbtest.ts` runs
the lifecycle against a real Postgres and asserts the rows — no second
package while the GC has the first, no attempt dated before the previous
one came back, no reopening or deleting an older attempt while a newer one
exists, and deleting attempt 2 makes the next one 3. 14 db tests plus 18
unit tests on the readiness math. `pnpm test` 444, typecheck/lint/build
clean.

---

### Backcharges: the money the GC takes back (Diego)
`claude/prova-contractor-os-e3f0iz`

Sheet 13 of FEATURE-AUDIT was the only one still reading **0 built · 0
partial · 2 missing**, and the gap it named was not a small one. This app
had `ChangeOrder` — us asking the GC for more money — modelled four ways
down to a reopen/revise distinction, and no concept at all of the same
conversation running the other way. A GC deducting $4,200 for cleanup left
no record anywhere except an unexplained short-pay on a cheque, and
"unexplained short-pay, months later" is precisely the shape of thing this
product exists to stop.

`/backcharges` is the log. New domain file `backcharges.prisma`
(`Backcharge`, `BackchargeCounter`, and the two enums), one additive
migration, `lib/actions/backcharges.ts`, and the page.

**The dispute half is the point, not a status field bolted on.** RECEIVED →
DISPUTED → ACCEPTED / SETTLED / WITHDRAWN, with the objection carrying its
own date and grounds. "We disputed this" without a date is worth nothing
against a GC holding a signed notice with one.

**Only a settlement stores a figure.** Accepting concedes exactly what was
claimed — a number the row already holds — and a withdrawal concedes
nothing. Copying either into `resolvedAmount` would be a second home for a
fact already stated, so `concededAmount()` derives it from the status, and
returns *unknown* rather than 0 or the claim when a settlement has no
figure recorded. The page counts those separately and says so on the tile
instead of quietly reading low.

**`claimedAmount` locks the moment we answer.** Without that, the "argued
off" figure is computed against an amount anyone could have moved
afterwards — it would be reporting a claim nobody ever made. The edit form
renders the three locked fields as text and the action refuses them
independently, because a form that hides a control is not a rule.

**What it does not do, said on the page rather than left to be discovered.**
Nothing here nets against a pay application, an invoice, a contract value
or a WIP figure, and nothing pushes an accepted backcharge into job
costing. Both are real work in the billing/costing lane. A nullable
`invoiceId` nobody sums would have looked built and changed no number
anywhere — the same defect as a settings card that connects nothing, which
this repo has now shipped twice.

**Verified against a real Postgres, not against a return value.** A scratch
database was stood up, all 46 migrations applied, and `lib/actions/
backcharges.dbtest.ts` runs the whole lifecycle through the actual actions
and asserts the ROWS: that deleting backcharge 2 makes the next one 3 and
not 2, that a locked claim survives an update trying to move it, that
another company's job and another company's backcharge are refused by every
one of the five actions, that a non-owner can log one and cannot delete
one, and that an accepted backcharge stores no conceded figure. 14 tests,
plus 18 unit tests on the exposure math. `pnpm test` is 426 → 444, and
typecheck, lint and a full build are clean.

**One note on FEATURE-AUDIT.** Its top-line tally and its per-sheet headers
already disagreed with the rows underneath them before this edit. Sheet
13's +2 built / −2 missing is applied to both totals rather than
recomputing everything, because a full recomputation is in flight on
another branch and two people rewriting the same totals is how they drifted
apart in the first place.

---

### Field reports get their own page, and a week you can hand to a GC (Cyrus)
`cyrus/field-reports`

Measured before building anything: on the job page, "Daily field reports"
began at **97% down a 3,382px, 13-section page** — dead last, after
prevailing wage determinations, union dispatch slips and estimate versions.
The most field-facing feature in the product sat behind four screens of the
office's paperwork. That is the exact failure the competitor research names
— built for the office, handed to the field — and it was ours.

`/field-reports` is the fix. Nothing moved: a job's reports are still on its
job page. What is new is a way in that doesn't start with a job page, and a
view of a whole week across every job, which is the unit a schedule dispute
is actually argued in.

**The gap is the feature.** A week with a day missing from it is worth less
as evidence than a week that says which day is missing, so the page names
finished weekdays nothing was filed for. Three exclusions, each a way to be
quietly wrong:

- **A day that hasn't happened is not missing.** On Wednesday, Friday is not
  a hole in the record. Flagging it would make every week in progress look
  negligent.
- **Today is not missing either.** The day isn't over. Telling a foreman at
  9am that he has failed to file is how a tool teaches people to ignore it.
- **A weekend is not missing**, though a weekend report still counts as a
  day worked. Nobody owes a report for a Saturday they didn't work.

**Coverage is null, not 0%, before any weekday of the week is over.** A week
nobody has worked yet is not a failed week, and a confident 0% on Monday
morning is a lie about it — the same reasoning as the delivery rate ignoring
unconfirmed messages.

**The week summary is what gives the filer something back.** Logging days
into a system only management reads is the shape of every abandoned
construction tool. This writes the week out as plain text — plain because it
has to survive being pasted into an email, a text, or a GC's own portal.
**Missing days are named in that text rather than left out**: a summary
listing only the days that exist reads as a complete week, and overstating
your own record to a GC is worse than showing the hole.

**Two live bugs found while building, both documented traps this repo
already knew about.**

The actions threw. Production redacts a thrown Server Action message, so
"A report already exists for that date — edit it instead of adding a second
one" — the most user-facing sentence in the module — reached a foreman as an
opaque crash. The guard was correct and could never be read. Now returns
`ActionResult`, verified rendering on both surfaces.

The date defaulted from `new Date().toISOString()`, the server's UTC date,
not `localToday()`. After 5pm in California that is already tomorrow, which
is exactly when a foreman files. Fixed; the divergence itself is not
observable at the hour it was tested, only the code path.

29 tests, four mutation-checked. Reintroducing the raw `getUTCDay()` — which
calls Sunday 0 and would start a week on Sunday — fails 15, because Monday
indexing is load-bearing. Counting today as missing fails 5. Rendering 0%
coverage for an unstarted week fails 1. Dropping missing days from the
summary fails 1.

**Then clicking it found what the tests did not.** "Days with no report:
Mon, Aug 24, Tue, Aug 25, Fri, Aug 28" — each day label already contains a
comma, so a comma-joined list reads as twice as many days as it names, on a
line that goes to a GC. Joined with a middot now, with a test.

The composer's primary actions are deliberately larger than the app's
standard button (py-3 against py-2). Measured: all 15 buttons on the job
page are under 44px, median 36px, against a 48px floor and 60x60 for gloved
use. That is a global fix belonging in Diego's design tokens, not 19 files
edited under an open PR — this one page is a documented local exception on
the one surface designed for a phone, and the measurement is with him.

`/vendors/pricing` also joined the nav, having been two clicks deep behind
`/vendors` since yesterday — the same burial, in my own week-old work.

### What your suppliers actually charge, and which way it is moving (Cyrus)
`cyrus/vendor-pricing`

A material price lived in exactly two places before this, and neither could
be estimated from. `CostEntry` holds a lump amount after the fact, with no
vendor and no unit behind it. `MaterialOrder` deliberately carries no price
at all, because putting one there would make an order a second source of
line-item cost — the rule ARCHITECTURE.md exists to enforce. So the question
an estimator actually asks, "what is board going for, from whom, and is it
moving?", had no answer anywhere in the app.

`/vendors/pricing` answers it. What a vendor quoted, on a date, with what it
came from — a written quote, an invoice, a price list, or a phone call —
because those four are not equally trustworthy and whoever is bidding is
entitled to know which one they are looking at.

**This is reference data and must never become line-item data.** A quote
belongs to a vendor and a date, never to a job or a `JobLineItem`, and
nothing sums it into job cost. Job cost keeps its one home. Read it as
living in the same family as `LineItemCatalogEntry`.

**Nothing is compared across units, ever.** A vendor quoting by the MSF has
not quoted by the SF, and the factor between them is theirs to state. Invent
it and a supplier appears a thousand times cheaper than they are, on a
screen someone bids off. Comparison happens inside a unit bucket or it does
not happen — which means "cheapest" is only ever cheapest per SF, and the
badge now says exactly that.

**No stored current price.** Current, expired, stale, cheapest, spread and
every movement figure are derived on every read, same rule as the delivery
log and the current drawing revision. A stored current price is wrong the
instant a newer quote is entered.

Four smaller decisions, each of them a way to be quietly wrong:

- **A vendor's superseded price is not a competing offer.** Only their
  newest live quote enters a comparison, or one supplier appears twice in a
  field of three and an old number they have already withdrawn wins.
- **An expired quote is still history.** It leaves the comparison and stays
  in the record — dropping it would hide the very rise the page exists to
  show.
- **A vendor's own expiry outranks our rule of thumb.** "Worth re-checking"
  only ever applies where they gave no date. Once theirs lapses, that is the
  truer answer anyway.
- **The expiry is inclusive.** A price held "until the 30th" is live ON the
  30th. An off-by-one here kills a live price on the one day it matters.

The estimating payoff is a warning when a catalog default sits under the
cheapest live quote in the same unit — you are bidding at a price nobody
will sell you at. It changes nothing and points at `/catalog`: which number
is right is a decision about your own pricing, not something to overwrite.

45 tests, four of them mutation-checked by reintroducing the exact bug and
confirming which test dies: comparing movement across units, letting a
superseded price compete, killing a quote a day early on its own expiry, and
comparing the catalog against a quote in another unit. One failure each, and
each was the test written for that rule.

**Then clicking it found what none of them could.** With a $390/MSF and a
$0.39/SF quote on one item, both rows badged "cheapest live" — two
contradictory claims about the same item on one screen. Both were true, each
within its own unit, but a badge that has to be reconciled against a heading
is one that gets misread, and misread here means bidding off the wrong
number. It reads "cheapest per SF" / "cheapest per MSF" now.

Verified by doing it, not by the suite: the guard against an expiry before
the quote date fired on create AND on edit and rendered as a sentence rather
than a redacted crash; a per-MSF quote formed its own bucket and left the
per-SF comparison untouched; expiring a quote dropped it out of the spread
and left it in the list; and a two-step delete removed a quote and its whole
unit bucket with it.

Migration additive. Grouping falls back to the vendor's wording when no
catalog item is linked, which is a weak key — two vendors wording the same
board differently will not line up, and the page says so rather than
under-grouping silently.
### Three of the six fixes didn't work, and the theme change was wrong (Diego)

The re-test found the first attempt shallow in three places. Recording what
was actually wrong, because two of them are the same mistake twice.

**The overdue disagreement survived the fix.** Dashboard still said 1
invoice / $1,000; `/cash-flow` still said 3 / $2,100. I had copied the
rule's SHAPE and missed its content: `calculateArAgingInvoice` uses
`paymentTermsDays ?? 0`, so a GC with no stated terms is due ON ISSUE. My
version returned null for that case and called those invoices undated.

**Then `/cash-flow` contradicted itself again, differently.** My first fix
made the forecast compare instants (`date < asOf`) while the aging table
floors to whole days — so an invoice due today was overdue in one table and
current in the other by lunchtime. I moved the bug rather than removing it.

Both are the same error: two implementations of one rule. `cash-flow.ts`
now exports `effectiveDueDateFor`, `daysPastDueFor` and `isOverdue`, and
the aging table, the forecast and the dashboard all call them. Five tests
pin the two cases that kept slipping, mutation-checked.

**The theme change was wrong, and is scoped back.** The plan was: convert
the shared components and the dashboard, leave other pages looking
inconsistent until a follow-up. They did not merely look inconsistent. On a
light canvas, 15 of 17 pages had content that could not be read — most
seriously the entire Balance column of `/cash-flow`'s AR aging table
rendering white-on-white, and buttons like "Add a licence" and "Log a
toolbox talk" invisible.

My first answer to that was to recolour headings and subtitles, which was
pattern-matching rather than looking: it fixed 21 h1s and missed h2s,
buttons and table cells, and missed `/settings` entirely.

So the light surface is now scoped to what has actually been converted. The
body stays dark, the chrome stays dark, and the dashboard carries its own
`bg-canvas`. Every other page renders exactly as it did before this branch
— the diff against main outside the dashboard is now three files.

That is a smaller claim than the brief asked for, and it is the honest one:
the tokens exist and one screen is built on them, rather than a theme
half-applied over pages that break under it. The conversion is a page at a
time, and each page is readable before and after.

Not a defect, still unproven: gross margin renders "—" because no job in
that dataset has earned revenue, so neither side of the 35% colour rule has
been exercised.

### Six things browser testing found in the new dashboard (Diego)

**The two pages disagreed about which invoices were overdue.** The
dashboard said one, $1,000; `/cash-flow` said three, $2,100. The dashboard
read only `Invoice.dueAt` and labelled the rest "no due date";
`calculateArAgingInvoice` has always derived one from the GC's payment
terms when the invoice carries none. An invoice with no stated date is
still due — net 30 from issue — and calling it undated hid two overdue
invoices. Both now use the same rule, and where a date is inferred the row
says so ("Due 2026-08-28 (terms)") rather than presenting an inference as
an agreed date.

**`/cash-flow` also disagreed with itself**, which the same run caught: its
aging table called an invoice two days past due overdue, while its own
forecast filed it under the current month, because the forecast bucketed on
"before this month started". Past due is past due whatever month it falls
in.

**A job with one budgeted line out of seven read "97% under contract
value".** `calculateJobWip` sums estimated cost as `?? 0`, so six
unbudgeted lines contributed no forecast cost while their contract value
still counted — which makes any partly-estimated job look spectacular. A
number that flatters you for not having estimated is worse than no number.
`jobHealthSentence` now refuses to forecast below 80% estimate coverage and
says what is missing instead.

**Clicking a receivable did nothing between 768px and 1024px.** The panel
is `hidden lg:flex`, but the desktop layout returns at 768px — so for 256px
of width the page looked fully functional and the rows were silently dead.
Below the panel's width a row now opens the job instead. Nothing is ever a
no-op.

**Twenty-one pages had an invisible heading.** Every unconverted page's
`<h1>` is `text-slate-100`, which was correct on the old dark body and is
near-white on the new light canvas. The tester found one; it was systemic.
Their own brief drew the line — inconsistent is expected, unreadable is a
bug — so the 21 headings and 15 subtitles that sit directly on the canvas
are now readable. This is NOT the theme conversion: those pages still carry
their dark cards and will look inconsistent until a second pass.

**The mobile drawer had gone flat** while the rail gained groups, in
different orders — the exact drift `navItems.tsx` exists to prevent. Both
render from `NAV_GROUPS` now.

Also fixed: "Nothing in in progress right now."

Not a defect, recorded because it limits what the run proved: gross margin
showed "—" throughout, because no job in that dataset has earned revenue.
The null branch renders neutral correctly; neither side of the 35% colour
rule has been seen against real data.

### A dashboard that tells you something before you ask (Diego)

`/dashboard` was a searchable table of jobs. Every number an owner needs on
a Monday — what is overdue, what is about to lapse, which job is drifting
past budget, what retainage is due back this month — already existed in the
data model and appeared only if you went looking for it on the right
sub-page. The table is still here, at the bottom, unchanged. What is new is
everything above it: the same figures, asked on load.

Nothing gained a stored column. Overdue totals, over-budget counts, the
metric bar's revenue and margin — all derived on read through `lib/wip.ts`,
`lib/retainage.ts` and `lib/gc-reliability.ts`, per ARCHITECTURE.md. A
saved "over budget" flag is wrong the moment a cost entry lands.

Decisions worth keeping:

**Over budget means forecast, not spend-to-date.** A job that has spent 90%
of its money at 90% complete is going to plan; the question is where it
LANDS. `jobIsOverBudget` compares forecast cost at completion against
contract value, and returns null rather than false when there is no cost
estimate — reporting "we don't know" as "on budget" is how a figure stops
meaning anything.

**Margin is blended by summing both sides, not by averaging job margins.**
A $2M job and a $20k job are not equal evidence of how the business is
doing. Averaging their margins says they are: a test asserts the difference
(20.7% vs a naive 55%).

**Margin only turns green above 35%.** A number that is always green
teaches people to stop reading the colour. The sample 24.6% renders
neutral, on purpose.

**Job health reads as a sentence.** "Forecast to finish 12% over contract
value at 64% complete" is something to act on; a bare variance percentage
in a table is not.

**The detail panel pushes, it does not cover.** The reason to open an
invoice from a receivables list is to compare it against the rest of the
list, so a panel that covered the list would remove what you opened it for.
That is why it is a context with three parts rather than one component —
a panel rendered inside the column it should push cannot push it.

**The rail expands as an overlay.** A rail that widens by shifting the page
reflows everything you were reading the instant your cursor drifts left.

**The two panel actions nobody built are shown disabled, with the reason.**
"Send a reminder" has no email channel and "log a call" has no activity
model. Saying so is more useful than a button that looks real and does
nothing.

**The rail keeps all 18 routes.** The brief for this work assumed eight of
them — RFIs, submittals, safety, drawings, material orders, cash flow,
closeout, estimating — had no route and should render disabled with a
"coming soon" tooltip. All eight shipped during the day that brief was
written. Disabling them would have removed working features from the nav,
so they are grouped and live; the disabled branch exists in the rail for
whenever something genuinely unbuilt is added.

**Theme is half-migrated, deliberately.** `tailwind.config.ts` now carries
semantic tokens, and `Card`/`Button`/`StatusBadge`/`Sidebar`/`Topbar` plus
the new dashboard are built on them. Every other page still carries
hardcoded dark utilities from the previous pass and will look inconsistent
until a second conversion pass. That is stated rather than hidden — the
per-file checklist is in the PR description. Roughly 1,000 hardcoded slate
utilities remain across 29 pages and 47 components; `jobs/[id]` alone has
448.

19 tests over the new arithmetic. Sheet 15's company-wide backlog moves to
Built. Sheet 26's expiration and WIP-variance rows move to Partial and NOT
Built — surfacing something on a screen someone opens is not alerting
someone who doesn't.

### The send button that was never built, and a guard so it can't happen again (Cyrus)
`cyrus/messaging`

Diego caught it in review and he was right: **`sendOutboundEmail` was
defined, exported, re-exported through the barrel, and called from nowhere.**
There was no form anywhere in the messages feature. `/messages` was a
delivery log with no way to create an entry — the counters read 0
permanently and "Nothing sent yet" was the only reachable state.

The part worth sitting with is why nobody noticed. Typecheck passed, because
the code is correct; it just isn't used. Lint and build passed, because the
symbol IS consumed — by the barrel. And **it clicked through clean**, which
is the one that should sting: a feature with no entry point renders as a
perfectly working empty state. "I clicked through it" is evidence of nothing
when the button was never built.

So the fix is two things, and the second matters more than the first.

**The form exists now.** To, name, job, subject, body — disabled while in
flight, because there is no idempotency key on a send and a second click is
a second email to a real person.

**And `lib/actions/reachable.test.ts` asserts every exported Server Action
is called from something.** The barrel and the action's own module are
excluded from counting as a caller, because a barrel re-export is precisely
what lets an orphan compile — it looks like a use and is the opposite of
one. Run against the branch before the fix, it failed on exactly the two
actions Diego found, with 130 others passing. A failure means one of two
things and both are worth stopping for: the feature has no entry point, or
the action is dead.

`emailSendingStatus` was the second kind. It duplicated what `/messages`
already does by calling `emailSetupProblem()` directly in its server
component, so it never had a caller and was never going to. Deleted rather
than wired up.

**Two more of Diego's, both real.**

A provider that ACCEPTS a message but returns no id was being recorded as
FAILED and reported to the user as a failure — but the mail has gone. They
resend, and the GC gets two copies. FAILED means "never reached the provider
at all" in this state machine, and that send reached it. It goes down as
QUEUED now, which is what actually happened, and it surfaces as unconfirmed
after a day because no webhook can ever match a message with no provider id.
The user is told it most likely went out and to check before resending.

That has a second consequence worth naming: such a message has no
`providerMessageId`, so the delete guard would have let someone destroy the
record of an email a real person received. Deletion now refuses on any event
other than FAILED, not just on the presence of an id.

Both rules are pure functions in `messageLabels.ts` and mutation-checked:
recording an accepted send as FAILED fails two tests, and trusting only the
provider id in the delete guard fails two more.

Verified by running it, not by reading it. With deliberately fake
credentials in a gitignored `.env.local`, the compose form renders, submits,
Resend refuses the key, the error reads "API key is invalid" in the form,
the message is recorded rather than lost, the counters move, and the row
reads "Never sent". Two-step delete then removed it, which is correct for a
message that never reached the provider. The file was deleted afterwards.

Still not verified, and still can't be by me: a real send with a real key.

### The app can now send things, and knows whether they arrived (Cyrus)
`cyrus/messaging`

Until this, Prova could not send anything to anyone. No email, no SMS —
every "sent on" date in RFIs, submittals and material orders recorded that
a human sent something through some other channel. The app was a filing
cabinet for correspondence it could not deliver.

**The delivery log is the feature, not the sending.** Sending is table
stakes; knowing whether it arrived is where the competitor research found
every product failing. Quotes sent from the vendor's own domain go 60%
unopened. One product shows "sending" forever on mail that never left, and
a contractor took a formal complaint over three messages a customer never
received. Silence is the failure mode, so silence is what this models
against — a message sent yesterday and still unconfirmed is surfaced, not
assumed fine.

**No stored status.** State is derived from the newest event, same rule as
every other feature here. Two consequences worth stating because both were
tested by deliberately breaking them:

- A **complaint after a delivery** must win. Marking spam a day later is
  the sequence that matters for a sending domain, and an earlier success
  must not hide it.
- **OPENED is never a state.** Image-blocking makes a missing open
  meaningless, so an open can only add information. Letting it become the
  newest state would let a later open overwrite a bounce — a message can
  be opened by one recipient and have bounced for another.

**Events are append-only and deduplicated by the provider's event id.**
Providers retry on any non-2xx. Recording a replayed bounce twice would
misreport deliverability, which is the one number this exists to get right.
Verified: the same event posted twice returns "Already recorded".

**`occurredAt` is the provider's timestamp, not ours.** A webhook delayed
an hour must not make a prompt delivery read as a slow one — the same
entered-not-stamped rule as every other date in this app.

**The webhook fails closed.** With no secret configured it rejects every
event with a 503. An unverified "delivered" is worse than no event: the
entire value of the log is that a delivered in it means something, and
anything forgeable by whoever knows the URL means nothing.

**The delivery rate ignores unconfirmed messages rather than counting them
as failures.** A provider outage would otherwise halve the number for a
reason that has nothing to do with deliverability.

**Sends as the contractor, with no shared-sender fallback.** No verified
domain, no sending. That is the deliverability complaint the research found
everywhere, and a fallback would quietly reintroduce it.

Verified against real HTTP, not mocks: valid event recorded, replay
deduplicated, forged signature rejected 401, stale timestamp rejected 400,
unknown message and unmodelled event type both 200 so the provider does not
retry forever. Then confirmed in the UI that a bounce arriving after a
delivery renders as Bounced with its reason.

24 new tests, verified able to fail by injecting two regressions — letting
OPENED imply delivery, and counting unconfirmed messages against the rate.
Four tests failed, two per regression.

**What is NOT verified, and cannot be by me.** The real provider round trip
— an actual send, a real signed webhook from Resend — needs an API key and
an account, which I can't create. Everything up to the provider boundary is
tested; the boundary itself is not. It ships disabled, with a setup state
naming the three environment variables, rather than pretending to work.

SMS is in the channel enum and deliberately not wired. One channel that
works beats two that half do.

### Finding out that QuickBooks disagrees with you (Diego)

The sync refuses an edit made inside QuickBooks rather than overwriting
it. That is right — overwriting a person's edit is how every platform in
the research ends up "silently diverging". But refusing and then never
mentioning it is half an answer. An invoice sat at $200.00 in QuickBooks
while Prova showed $123.45, and nothing anywhere said so until someone
happened to press a button.

Settings now has "Does QuickBooks still agree?" — one call, on demand,
listing every invoice where the two sides disagree, worst first.

Decisions:

**It reads and never writes.** There is deliberately no "fix this" button.
Which side is right is a judgement about someone's books, and a machine
picking between two humans' numbers is exactly the behaviour that makes a
bookkeeper stop trusting an integration. The row says what differs and
tells you re-sending overwrites QuickBooks — then stops.

**Nothing is stored.** A saved "in sync" flag is wrong the instant either
side changes, the same rule this schema applies to every other derived
value.

**Compared on money and existence only.** Total, and whether QuickBooks
still has the record. Not line counts, not descriptions, not the document
number — QuickBooks legitimately adds tax and discount lines and a
bookkeeper may retitle something. A reconciliation view people learn to
scroll past is worse than none, and that is what noise does to one.

**A voided invoice is a difference, not a disappearance.** QuickBooks
keeps voided invoices at zero rather than deleting them, and marks them in
the private note rather than a field — so "it's gone" would be the wrong
thing to tell someone.

**Order is the feature.** Disagreements first, then invoices QuickBooks no
longer has, then never-sent, then agreeing. Within disagreements, biggest
money gap first: a $4,000 gap must not sit below a $2 one by accident.

**Fetched in one batched query, not one call per invoice.** A hundred
invoices would otherwise be a hundred round trips and a good way to meet
Intuit's rate limits on a page someone refreshes twice. Ids come from our
own database but are still filtered to digits before being interpolated
into a query language with no parameter binding.

17 tests, two mutation-checked: removing the total comparison fails four,
inverting the sort order fails one.

Not verified against a real QuickBooks company yet. The reconciliation
call itself has never run against Intuit — and given that every real
defect in this integration was found by clicking rather than by a test,
that is the gate before this is trusted.

### QuickBooks sync: every claim now verified against the real API

Closing the record. Five browser runs against a sandbox company, each one
finding something no test found, and the last one leaves nothing unproven.

| Claim | How it was verified |
| --- | --- |
| A push creates the invoice | QuickBooks invoice 145, seen in Sales → Invoices |
| Amount, customer, memo, service item all correct | read in QuickBooks by a person |
| **Three clicks make ONE invoice** | rows counted in QuickBooks, not inferred |
| The mapped income account is load-bearing | push refuses without it |
| Refusals are logged, never swallowed | six log entries including every failure |
| A re-send actually re-sends | new log entry appears where none did before |
| **A QuickBooks-side edit is refused, not overwritten** | stale SyncToken path fired |

The last row is the one this design cares most about. The invoice was
changed to $200.00 inside QuickBooks; Prova's re-send came back with "This
invoice was changed inside QuickBooks since we last sent it. Open it there
and decide which version is right before pushing again." A person edited
that record and we stopped. Every competitor in the research quietly
overwrites at this moment, or silently diverges.

Worth keeping for whoever reads this next: **every real defect in this
integration was found by clicking, and none by the test suite.** The suite
was green through a button that did not exist, a required API parameter
nothing supplied, and a re-send that permanently did nothing. It is
genuinely useful against regressions — three of its assertions were written
by reintroducing a production bug as a mutation and watching them fail —
but across five rounds it has never once found something new.

The honest limit of what shipped: this is one-directional. An edit made in
QuickBooks is refused rather than absorbed, and nothing in Prova shows that
the two have drifted until someone presses the button. That is a real gap,
deliberately not papered over, and the right fix is a reconciliation view
rather than pretending to a two-way sync nobody in this market has managed.

### The round trip works, and "Re-send" was a button that did nothing (Diego)

**Verified in QuickBooks, by a person, with their own eyes.** Invoice
pushed as QuickBooks invoice 145, and after three clicks — two rapid, one
five seconds later past the browser's pending guard — Sales → Invoices
holds exactly ONE invoice for $123.45, with the right customer, the right
memo, and the line booked against the right service item.

That is the claim this integration was designed around and it is the first
time anyone has confirmed it by counting rather than by trusting our own
read-back. Worth being precise about why the read-back could never have
settled it: `getInvoice` asks about one id. It structurally cannot answer
"how many are there".

**Then the same session found a real bug, by doing the thing nobody had
done: editing the invoice inside QuickBooks.**

Changed to $200.00 there, then re-sent from Prova. Prova said "Sent to
QuickBooks and verified." QuickBooks stayed at $200.00.

The idempotency key is derived entirely from OUR data — invoice id, total,
line fingerprint. An edit made in QuickBooks changes none of it, so the key
matched a prior success and the push short-circuited before contacting
Intuit. "Re-send to QuickBooks" was a permanent no-op that reported
success, for the life of the invoice.

Worse in principle than in effect: the short-circuit ran BEFORE the
read-back, so once an invoice had been pushed once, nothing ever looked at
QuickBooks again for it. The verification this integration is proudest of
was dead code for every state after the first.

The short-circuit is now time-bounded to two minutes. That covers every
accidental repeat — a double-click, a retry after a timeout — and no
deliberate one. A re-send past the window goes through, and it is safe to
let through: by then a link exists, so the payload carries Id and SyncToken
and QuickBooks UPDATES that document. Creating is the only call that can
duplicate, and it happens exactly once.

Six tests over the window, verified by reintroducing the exact bug as a
mutation — short-circuit forever — and confirming two fail.

Still unexercised: the stale-SyncToken path. The re-send now reaches
QuickBooks, so the next attempt at a QuickBooks-side edit will either
restore our number or refuse because someone changed theirs. Neither has
been seen yet.

### Every QuickBooks push failed, and 193 green tests said otherwise (Diego)

The sandbox run got there. Every invoice was rejected:

> Required parameter Line.SalesItemLineDetail is missing in the request

`buildInvoicePayload` took an optional `incomeAccountItemId`, **no caller
anywhere supplied it**, so every line shipped `SalesItemLineDetail: {}` —
and QuickBooks reads an empty object as absent.

The part worth sitting with is not the missing parameter. It is that the
test suite was fully green while every real push failed, because the tests
asserted on a payload shape I invented and never checked against Intuit.
`SalesItemLineDetail` appeared nowhere in them. A test that only confirms
the code does what the code does is a test that cannot fail for the reason
that matters.

Two consequences the tester found, both worse than the error itself:

**The chart-of-accounts mapping was decorative.** "Invoice revenue →
Services (Income)" was collected, stored, displayed, and never read when
building an invoice. It passed a browser test on a feature with no effect.

**Wiring the stored value through would NOT have fixed it.** The mapping
holds an *Account* id; a QuickBooks invoice line needs a *Product/Service
Item* id. Different objects, different id spaces. That is a second bug
hiding behind the first, and it would have produced a different failure
rather than a fix.

So: `ItemRef` is now **required** in `QboLine`, and `incomeItemId` is a
required argument. The payload that failed is no longer expressible — the
compiler refuses it rather than a test having to remember to look. The
mapped income account is what the service item posts to, so the mapping
became load-bearing instead of decorative, and `pushBlockers` refuses a
push when no income account is mapped rather than failing at Intuit.

`resolveIncomeItemId` finds a stable-named service item before creating
one and stores the link, so a second push reuses the first item rather than
littering a contractor's product list.

Three new tests, one of them the one that was missing: every line, in
every shape this builder produces, must carry a non-empty
`SalesItemLineDetail` with an `ItemRef`. Verified by reintroducing the
exact production bug as a mutation — the empty object — and confirming two
tests fail.

Still unproven after two runs: whether a retry creates a second invoice in
QuickBooks. The client-side pending guard was observed collapsing a fast
double-click into one attempt, which is the browser half; the server half
has never been reached because nothing has ever successfully landed.

### The message that told you what to do was replaced by a crash (Diego)

Browser testing hit "Mark as contracted" on a job with no line items and
got: *"An error occurred in the Server Components render. The specific
message is omitted in production builds."* The real error was
`Add at least one line item before contracting this job` — one sentence
that says exactly what to do, redacted into a crash.

The galling part is that `MarkContractedButton` already had a try/catch
and a slot to render the message. It looked correct. It was written
believing the catch would work, and in development it does — production
redacts thrown Server Action messages, so `err.message` was the generic
string, every time. This trap is written in CLAUDE.md and the code still
walked into it.

`markJobContracted` returns `ActionResult` now, for all three of its
guards. The button renders what comes back.

**The wider finding, which is not fixed here.** 136 `throw new Error("…")`
calls remain across the action modules, against 38 actions that return
`ActionResult`. Most of those throws are user-fixable validation messages
— "Description is required", "End date can't be before the start date" —
and every one of them currently reaches a production user as that same
generic crash string. Written down rather than fixed in passing: it is a
systemic conversion across fourteen files and every caller that renders a
result, not something to do quietly at the end of an unrelated commit.

### The QuickBooks link action had no button (Diego)

`linkContactToQuickBooks` shipped an hour ago as an action nobody could
reach. Found while writing the test that needed it, before anyone ran that
test — but only because the licence CRUD made exactly this mistake earlier
today and I went looking for it deliberately.

An action with no UI is a feature that does not exist. It also blocked the
whole QuickBooks round trip: an invoice cannot be pushed until its GC is
linked to a customer, so every later step depended on a button that wasn't
there.

The contact detail page now has a QuickBooks section, shown only when
QuickBooks is connected — offering a control that cannot work is its own
small lie. The copy explains the behaviour that matters: an existing
customer with the same name is reused rather than duplicated, because a
second copy splits the payment history the bookkeeper already has.

### QuickBooks actually syncs now — one direction, verified (Diego)

The connection has existed since 23 August. Nothing ever flowed through
it: OAuth, token refresh, and a test-connection button, and the Settings
page said so plainly. This is the part that moves money.

Accounting sync is the single most-corroborated failure in the contractor
software research — six platforms, ten-plus independent sources, always
the same shape. "Batches transfer with wrong amounts." "Two way sync does
not work in many areas." "It doesn't work. We ended up just not trying
anymore and now pay for an outside bookkeeping service." Three design
commitments come straight out of that:

**One direction, said out loud.** Prova writes to QuickBooks. It does not
pull. Every platform in that research advertises bidirectional sync and
gets savaged because it isn't really one, and a sync that quietly loses an
edit someone made in QuickBooks is worse than one that never claimed to
carry it. The Settings copy says this rather than implying more.

**A push is not evidence.** Every write is followed by reading the record
back and comparing totals and document number in cents. "Sent, but
QuickBooks holds something different" is its own recorded outcome — not a
success with a footnote — because that state is exactly what every
competitor reports as success. This project already spent a day on a tool
reporting "successfully applied" against a database nobody read; money
deserves the same suspicion.

**A retry can never double-post.** Every push carries an idempotency key
derived from the invoice id, its total, and a fingerprint of its lines. A
network timeout and its retry produce the same key and the second one
no-ops before contacting QuickBooks; a genuine edit produces a different
key and becomes a real update. Doubled charges are the most-repeated
symptom in the research and they are always a retry without a key.

Decisions worth keeping:

**Retainage is not deducted from the invoice.** Work completed is earned
and billed in full; retainage is withheld from payment against it. Netting
it in would make the ledger disagree with the G702 the GC signed and hide
retainage in QuickBooks exactly when someone needs to chase it. It rides
in the memo instead.

**Work completed and materials stored are separate lines**, because they
are two columns on a G703 and a bookkeeper reconciling stored materials
needs the same split the GC saw.

**A stale SyncToken is surfaced, never retried.** QuickBooks rejecting an
update because the record changed there means a person edited it — the
message says so and stops, rather than overwriting them.

**Nothing about the chart of accounts is guessed.** An accountant has
opinions about which account labor posts to, and picking one silently
corrupts books in a way discovered at tax time.

**Customers are matched by name before being created**, so a GC the
bookkeeper already has doesn't become a second "Turner Construction" with
the history split between them.

Three additive models, one migration, zero destructive statements:
`QuickBooksEntityLink` (ours ↔ theirs, with sync token and a separate
verified-at), `QuickBooksAccountMapping`, and `QuickBooksSyncAttempt` — an
append-only log of every attempt including the refusals, because a sync
nobody can audit is one nobody trusts the moment two numbers disagree.

24 new tests over the payload arithmetic, idempotency and verification,
two of them deliberately mutated first to confirm they fail — including
the one asserting retainage is not netted out.

**Not verified, and this matters:** nothing here has touched QuickBooks.
The pure logic is tested; the API calls are not, because testing them
needs an Intuit sandbox company and pushing invoices at real books to find
out is not a thing to do. Before this is trusted with a real invoice it
needs a sandbox run, and the app's Intuit environment needs checking —
production API access goes through Intuit review.

### There are two Neon projects, and saying otherwise cost a day (Diego)

Settled, with evidence, and written into the three files that were lying
about it.

| Project | Endpoint | Used by | Holds |
| --- | --- | --- | --- |
| Diego's | `ep-little-sea-a6bdnaw2` | Vercel — production AND previews | the real data |
| Cyrus's | `ep-icy-hat-afqau56u` | Cyrus's laptop only | his own test data |

Two production build logs printed `ep-little-sea` as the migrate target;
the new Migrate workflow printed the same for secrets copied out of Diego's
Neon project; that project answers `SELECT count(*) FROM "Job"` with 14,
matching what the deployed app shows; and Cyrus's `_prisma_migrations`
timestamps show merged migrations reaching `ep-icy-hat` only when he ran
Prisma by hand.

Everything confusing about 2026-08-29 follows from that table. A build log
saying "successfully applied" and `migrate status` saying "not yet applied"
were BOTH TRUE, about different databases. Nobody was wrong. The words "the
database" meant two things, and no log anyone read named a host.

The second project is not the bug — a developer with their own database is
the right setup, and it is why `prisma migrate dev` on Cyrus's laptop was
never the loaded gun this repo told him it was. The bug was the sentence
"there is ONE Neon database and it is production", which was load-bearing
for every migration risk call either of us made for weeks after it stopped
being true.

Corrected in `CLAUDE.md`, `ARCHITECTURE.md` and `ONBOARDING.md` — each now
names both endpoints and says which is which, rather than saying "the
database". `ONBOARDING.md` also tells a new developer to point at their own
project rather than leaving it to be guessed, which is the step that
created this situation in the first place.

Two follow-ons worth keeping:

**Cyrus's database is supposed to be behind**, and now has a documented
catch-up: `pnpm --filter @prova/db run migrate:deploy`, which prints the
host before it changes anything and verifies afterwards. A local 500 saying
"column does not exist" means his database is behind main, not that the
code is broken.

**`ALLOW_PREVIEW_MIGRATIONS` is gone** — it left with the build's migrate
step in #28, and three documents still described it. A documented escape
hatch that no longer exists is worse than none.

### A wrong database URL creates a new database instead of failing (Diego)

The migrate workflow's first real run failed, and testing the fix found
something worse than the failure.

**The failure:** `P1002`, a 10-second timeout taking the migration advisory
lock. Neon suspends an idle compute and the first connection pays for the
wake, so on a cold database `migrate deploy` can lose that race having
applied nothing. Nothing was even pending. A migration job that fails for
reasons unrelated to migrations is one people learn to re-run without
reading, which is how a real failure gets waved through later — so the
script now wakes the compute with a trivial query first and retries a lock
timeout three times with backoff. Only a lock timeout is retried; a genuine
migration failure stays failed.

**The worse thing.** Testing that fix by pointing at a database name that
did not exist, the script reported "verified — every migration in this
commit is applied" and exited 0. It was telling the truth:
`prisma migrate deploy` CREATED the database and applied all 39 migrations
to it.

That is the most dangerous behaviour in this pipeline. A wrong URL does not
fail — it quietly produces a second, empty, fully-migrated database, and
every later "successfully applied" is true about the wrong one while the
real data sits untouched somewhere else. Which is indistinguishable from
what this project just spent a day untangling, and is a live candidate
explanation for how `ep-little-sea` came to hold every migration and
nobody's data.

So the applier now refuses to migrate a database with no migration history
unless `ALLOW_EMPTY_DATABASE=true` is set. Verified: it refuses, and
critically, no database is created. Setting up a genuinely new database
costs one environment variable once; the alternative cost has already been
paid.

### The environment now says which database it is talking to (Diego)

Two people spent a day disagreeing about whether a migration had been
applied, and both were right. `prisma migrate deploy` in the Vercel build
reported success — repeatedly, in logs I quoted back as proof — against
`ep-little-sea-a6bdnaw2`, while both laptops and (on the evidence) the
running app read `ep-icy-hat-afqau56u`. Cyrus settled it from
`_prisma_migrations`: two merged migrations reached that database only when
he ran Prisma by hand, hours after the builds said they were applied.

Nothing was lying. Nothing printed a hostname either, so there was no way
to see it. That is the actual defect, and it is what this fixes.

**Every build now prints the database it is talking to**, passing or
failing — host and database name, never a credential, since build logs
aren't private. **And it refuses to build** when `DATABASE_URL` and
`DIRECT_URL` resolve to different databases, which is the exact
misconfiguration above. Also fatal: a `DIRECT_URL` pointing at a pooler,
since `prisma migrate` needs session-level advisory locks a pooler can't
hold. An unpooled `DATABASE_URL` is only a warning — it works, and failing
a deploy over it would be worse than the problem.

Neon gives one database branch two endpoints, the pooled one being the
same id with `-pooler` appended, so the comparison normalises that away.
Non-Neon hosts compare on host and database name outright rather than
guessing. The parsing is tested against the two endpoint strings that
actually disagreed, plus a test asserting no credential survives into the
output.

**The app logs its own connection target once per cold start.** That
covers the case the build check cannot see: a PROMOTED deployment, where
no build command runs at all.

**Migrations moved out of the Vercel build into CI on merge to main**
(`.github/workflows/migrate.yml`). The old gate ran them on
`VERCEL_ENV=production` and was blind to promotion — promoting a preview
reuses its already-built output, so the build command never re-runs and
its migrations never apply. Two deployments were promoted that way.
Merging is the decision to change production; a build is not.

The workflow needs `DATABASE_URL` and `DIRECT_URL` repository secrets and
fails loudly without them rather than skipping — a silent skip is how this
class of bug survives. It also reads back `migrate status` after applying,
because "successfully applied" is exactly the claim that turned out not to
be a result.

What the Vercel build does now is assert rather than apply: a production
build REFUSES to ship when migrations are pending, because that means code
reading columns that don't exist. A preview only warns — a branch's own
migration legitimately hasn't merged yet, and failing there would block
the clicking that catches these bugs.

Verified against a real database rather than reasoned about: the mismatched
pair and the pooled `DIRECT_URL` both exit 1; a healthy pair passes; with a
migration row deleted from `_prisma_migrations`, a production build refuses
and a preview warns and continues; and the CI applier refuses mismatched
secrets before touching anything. 15 new tests, one deliberately mutated
first to confirm it fails.

Still open, and deliberately not guessed at: which endpoint Vercel's
`DATABASE_URL` actually uses. CLAUDE.md's "there is ONE Neon database" is
marked as the false claim it is rather than replaced with a second
confident answer.

### Contractor licences can now be created (Diego)

`CompanyLicense` had a model, two indexes, a slot in the renewals ranking
and a row in FEATURE-AUDIT marked **Built** — and no way to create one.
Not a form, not an action, nothing. So a quarter of the renewals feature
ranked a record type that could not exist, and the audit had said
otherwise since 25 August.

Worth naming how that was found. It wasn't found by reading the code, and
it wasn't found by any check: typecheck, lint, tests and the build were
all green the entire time a documented capability had no data path. It
came out of a browser run confirming there was no licence form on any of
the sixteen routes.

`/settings` now has a Contractor licences section: add behind a button,
inline row edit, two-step delete, real empty state, owner-only — the same
shape as every other list.

Decisions:

**No "Expired" in the status dropdown.** `LicenseStatus` has one, but
whether a licence has expired is what its expiration date says. Storing it
as a status too is a second copy of a derived fact, and it is precisely the
contradiction the renewals panel has to detect and report. The four
settable statuses — active, suspended, pending, inactive — all describe a
board's action on the licence, which no date can tell you. Rows that
already store EXPIRED still render; nothing new can create one.

**Classification is a datalist, not a select.** Licensing structure isn't
uniform: CA and AZ split by trade, UT combines several trades into one
code, Colorado has no classification system at all. Suggestions appear for
jurisdictions someone has actually seeded into
`LicenseClassificationReference` and the field stays free text everywhere
else. That table is still empty, and I did not seed it — the schema is
explicit that a wrong code there is worse than no row, and I have no
verified source for those lists.

**Duplicates are checked on jurisdiction + number, not number alone.** A
licence number is only unique within the body that issued it, so the same
digits in two jurisdictions are two real licences.

**The expiry-before-issue check exists** because that typo would otherwise
show up as a licence you just added already sitting in the expired list.

**`today` is passed from the server** into the row component rather than
computed in the browser, so the two renders can't disagree about what day
it is.

The actions return `ActionResult` and the forms render it — production
redacts thrown Server Action messages, so "that licence is already
recorded" would otherwise arrive as an unexplained failure.

Honest status: typecheck, lint, 106 tests and the build all pass, and the
ranking logic these rows feed was clicked through against real data
earlier. The form and its three actions themselves have not been clicked
yet.

### Two pages, one record, two different day counts (Diego)

Browser testing put both numbers on screen at once. `/settings` said a
policy expires "in 11d"; `/compliance` said the same policy is "due in 12
days". The panel was right.

`/settings` did its own arithmetic — `floor((date - Date.now()) / a day)`
— which compares a date stored at UTC midnight against the current
instant, so from mid-morning onward it silently lost a day. It also warned
at a flat 60 days for both policies and bonds, disagreeing with the
per-kind horizons the renewals panel ranks by.

Two answers for one fact is worse than either being wrong on its own,
because now a user can't trust the one that's right. Both pages read from
`classifyRenewal`/`renewalTiming` now, so a future change to how a day is
counted can only be made in one place.

Also fixed, from the same test run:

**`/compliance` scrolled sideways on a phone.** Measured, not eyeballed:
`scrollWidth` 429 against a 360 client. The cause was one row's action
cluster — `shrink-0` and unwrappable, so Edit / Mark received / Delete ran
straight past the viewport and dragged the page with it. Now it wraps, and
the text column beside it may shrink. The mobile shell shipped earlier
made the app usable on a phone; this is the first page-level thing to fall
out of actually testing at 360.

**Three more one-click deletes.** Insurance policies, bonds and company
locations all destroyed a row on a single click, and so did a compliance
document — a signed waiver or a certificate someone sent you. The catalog
fix a commit earlier was written into one row component instead of
something reusable, so the very next test run found the same bug three
doors down. `ConfirmDeleteButton` is that reusable thing; the next list
that needs a delete has no excuse to hand-roll a fourth copy.

### One place that tells you what is about to lapse (Diego)

Sheet 14's last missing row, and the first thing in Sheet 26. Expiration
was already computed correctly everywhere it was shown — but only where it
was shown. A COI's expiry sat on `/compliance`; licences, insurance
policies and bonds sat on `/settings`; none of the four sorted or flagged
by date. Knowing a renewal was coming meant visiting two pages and reading
every row, which nobody does weekly. The consequences are not small: a
lapsed COI turns a crew away at the gate, and an expired licence can void
the contract you are working under.

No migration. All four models already carry an indexed date and a schema
comment saying the status is computed at read time and never stored —
this feature is what those comments were anticipating.

Decisions worth keeping:

**Horizons are per kind, not one number.** 30 days for certificates and
policies, 60 for licences and bonds. The lead time you need is the lead
time the renewal takes: a COI is a phone call to a broker, a state licence
board is not. The round trip proved this does real work — two records
expiring on the same day, 40 out, and the licence is flagged while the
policy correctly is not.

**A date expiring today is due, not expired.** Cover runs through the end
of its last day, and telling someone their still-valid certificate has
lapsed is how a warning stops being believed.

**A missing date is a gap only where a date is expected.** Lien waivers
and payroll reports never expire; flagging them would bury four real
warnings under two hundred permanent ones, which is how alert lists die.
COIs are the only compliance document filtered in at all.

**A record that contradicts itself is never dropped.** `CompanyLicense`
stores a `status` AND an `expirationDate`, so it is the one record here
that can disagree with itself — "marked active, but its date has passed".
Neither is corrected automatically: a person entered both and which one is
stale is not knowable from here. It stays on the list whatever the date
says, because no other page shows the conflict.

**Nothing is dismissible.** An alert you can clear without fixing the
record makes an empty list mean two different things.

`lib/serverToday.ts` is new and deliberately separate from
`components/localToday.ts`. That one answers "what day is it where the
user is" — right for a date input a foreman is filling in, wrong here,
because calling it during a server render breaks hydration. The tradeoff
is stated in the file: for a few hours a day the UTC answer runs a day
ahead of the user's calendar, which is noise on a 30- or 60-day horizon
and not good enough anywhere the exact day decides something.

Verified by result, not by claim: 19 unit tests (two deliberately mutated
first to confirm they can fail), then a round trip against a real
PostgreSQL — ordering by most-overdue, the two horizons splitting
identical dates, the self-contradicting licence flagged, and the current
COI, current policy, undated bond and lien waiver all correctly absent.

Not built, and not claimed: delivery. Nothing emails, texts or pushes.
Sheet 26 stays open, now as Partial — it reaches someone who opens the
app, and nobody who doesn't.

Also corrected here: the summary line at the top of `FEATURE-AUDIT.md`
said 51/15/37 while the table under it said 59/13/35. Two answers in one
file, drifted apart at some point. Recounted to the table.

### Deleting a catalog entry now asks twice (Diego)

Browser testing found it: four deletions, four rows gone on the next
render, no confirm anywhere. Every other list in the app already asks
twice — this one was written with a bare form posting straight to the
action, and neither typecheck, lint, tests nor the build has any opinion
about that.

Worse than an ordinary misclick, because of something invisible on the
row. A `JobLineItem` records the catalog entry it was priced from, and
that relation is optional — so Prisma's default is to NULL the link
rather than refuse the delete. The line items survive intact. What dies
is the actuals feedback loop for that work, silently, with nothing on
screen ever mentioning it. So the confirm step names how many costed
lines are about to be unlinked. That is the number that should make
someone stop, and it was the number nobody could see.

`deleteLineItemCatalogEntry` now returns `ActionResult` instead of
throwing. Production redacts thrown Server Action messages, so the old
`throw new Error("Catalog entry not found")` would have reached a user as
an unexplained failure.

Two smaller things from the same test run. The import preview derived a
trade label by lowercasing the enum, so a row previewed as "lath plaster"
and saved as "Lath & plaster" — nothing wrong with the data, but a
preview whose wording doesn't match what lands is a preview you stop
trusting, and that preview is the only thing between a bad file and the
catalog. Both now read from one `trade-scopes.ts`. And the active nav
link carried its state in colour only; it now also carries
`aria-current="page"`.

### The app now works on a phone (Diego)

Half a subcontractor's people are in the field, and the app assumed a
desktop. The sidebar was a fixed 240px full-height column with no
responsive rules at all and no drawer — on a 360px screen that left a third
of the width to work in. Not a cosmetic problem: most of the crew couldn't
use it.

The rail is now desktop-only (`md:` and up) and gains `sticky top-0`, so it
stays put instead of scrolling away on a long job page. Below `md` the same
links live in a drawer opened from the top bar.

Both read from one shared `NAV_ITEMS` list. That is the point of extracting
it: a route added to the rail and forgotten in the drawer would be a page
that exists on a laptop and not on a phone, which nobody notices until a
foreman reports it.

Drawer behaviour worth naming, each because its absence reads as the tap
not working: navigating closes it, Escape closes it, tapping the backdrop
closes it, and the link list scrolls on its own so the close button can't be
pushed off screen.

Also fixed: `ContractSummary`'s table had no scroller of its own, so on a
phone it dragged the whole page sideways. It renders on `/esign` and the
client portal — the two places an outside party sees, and the one a client
signs on their phone. Every other table in the app already had one.

Not fixed here, and worth being straight about: this is the shell, not a
mobile design pass. Individual pages still lay out for a wide screen, and
the forms are dense. The app is now usable on a phone; it is not yet good
on one.

### Duplicate records from an exhausted pool: the half that's fixable (Diego)

Follow-up to the connection-pool finding below, which was documented and
deliberately not fixed. Two halves; one is fixed here, one is not.

**Fixed: the second click.** Whatever makes a page look like it didn't
save — an exhausted pool, a stale render, a slow request — the duplicate
record comes from the user submitting again. Every create in the app was a
plain `<button>` inside a server-rendered `<form action={serverAction}>`,
which stays clickable for the whole round trip, and no create action is
idempotent. `components/SubmitButton.tsx` uses `useFormStatus` to disable
the button while its own form is in flight; 57 buttons across 7 files now
use it. The one `type="button"` toggle in the change-order UI is left
alone, since it submits nothing.

This is worth stating plainly: it does not fix the pool. It removes the
mechanism by which a pool problem becomes a *data* problem.

**Fixed: silence.** The app had no error boundary anywhere, so a failed
render fell through to Next's default screen, which in production says
only that a server exception occurred. After pressing Save that answers
the wrong question. `app/(app)/error.tsx` now says the page failed to
load, that this does not necessarily mean the save failed, and — the part
that matters — not to submit again before reloading to check. It surfaces
`error.digest` so a report can be traced in the Vercel logs.

**Not fixed: the connection strategy.** Deliberately, because it can't be
verified from here and this is production.

`Error in PostgreSQL connection: Error { kind: Closed }` is the tell. Those
are connections Prisma still believes it holds, closed underneath it —
consistent with Neon suspending an idle compute. Prisma's pool then hands
out dead connections and drains, and the 5-connection budget is exhausted
by connections that no longer exist. That is why it presents as pool
exhaustion under load that isn't actually heavy.

Three options, in increasing order of how much they actually fix:

1. `pool_timeout=30` means a request waits **thirty seconds** before
   failing. Lowering it doesn't prevent anything, but it turns a half-minute
   stall into a fast, visible failure — which the new error boundary now
   explains properly.
2. Prisma sits in front of Neon's pgbouncer with a pool of its own, and
   every lambda instance holds up to `connection_limit` connections. On
   serverless a lower limit is the documented guidance, not a higher one.
3. The real fix is Neon's serverless driver via `@prisma/adapter-neon`:
   stateless per-query HTTP, so there is no long-lived pool to go stale.
   It is a data-layer change that needs testing against Neon specifically,
   not against a local Postgres, so it belongs in its own piece of work.

(1) and (2) are `DATABASE_URL` changes on Vercel and need Diego. (3) needs
a branch and a real test against Neon.

## 2026-08-28

### Material order and delivery tracking per job (Cyrus)
`cyrus/material-orders`

What's on order, who owes it, and whether it turned up. Material that
doesn't arrive is a crew standing around, and "the studs were three weeks
late" is worth nothing in a delay conversation without the date it was
ordered and the date the vendor promised.

**It deliberately carries no quantity and no unit price.** A
`MaterialOrderLineItem` with quantity and price would be a second live
copy of line-item data, which is the one thing ARCHITECTURE.md forbids.
Material cost already has a home (`CostEntry` against a `JobLineItem`) and
scope already has a home (`JobLineItem`). This model answers only what
neither of those can: is it here yet, and if not, who is late. A link from
an order to a specific `JobLineItem` was considered and deferred — it
would be a pure addition, but it touches the unified line-item model,
which is the other lane's core surface.

- **Numbers** come from `MaterialOrderCounter`, incremented in the same
  transaction as the insert. Never `max(n)+1`. Check: delete the highest
  order and the next one issued must not reuse its number.
- **Partial deliveries are their own rows**, not a pair of columns on the
  order — half the studs Tuesday and the rest whenever is the normal case.
  A delivery can be marked as closing the order out, and removing that
  delivery is how a wrongly-closed order reopens.
- **State is derived, never stored**: awaiting / partly delivered /
  delivered comes from the deliveries on every render. A stored status can
  disagree with the deliveries underneath it, and then "still waiting on
  it" and "it's all here" are both on screen at once.
- **An order with no promised date is never late.** Nobody committed to
  anything, so there is nothing to be late against — inventing a date to
  measure against would manufacture lateness no vendor agreed to.
- **Guards**: a promised date before the order was placed, a delivery
  before the order was placed, and a second delivery against an order
  already closed out. The last reads the closing delivery INSIDE the
  transaction — checked outside, two people receiving the same truck both
  pass and the order closes twice with two different completion dates.
- **The ordered date is not editable after creation.** Every delivery is
  measured against it, so moving the start of the clock would retroactively
  rewrite the lateness of deliveries already recorded. The promised date
  *is* editable — a vendor moving their own commitment is normal and has to
  be recordable.

### Closeout, warranty, and the arithmetic that hides in "one year" (Cyrus)
`cyrus/drawings`

Sheet 22 closed out. `/closeout` covers what's still owed before final
payment and what you're still on the hook for after it.

**`JobStatus` deliberately untouched.** The audit note said closeout and
warranty were missing "because `JobStatus` ends at COMPLETE", which reads
as an instruction to add lifecycle stages. Two reasons not to: the job
lifecycle is the other lane's surface, and a stored stage can disagree
with the dates underneath it — the same reason submittals, drawings and
material orders have no stored status. A job is in warranty because it has
a `WarrantyPeriod` whose derived expiry hasn't passed, not because someone
remembered to move a flag.

**A job with no checklist is NOT closeout-complete.** An empty list
asserts nothing, and "complete" is the claim someone quotes while chasing
final payment. Required items decide completeness; optional ones are
tracked but never hold it open.

**The warranty start is entered, not read from
`Job.substantialCompletionDate`.** That field already drives retainage
release forecasting, and the warranty clock and the retainage clock are
not always the same date — warranty often runs from final completion or
owner acceptance. Sharing one field would silently move one whenever the
other was corrected.

**End-of-month clamping, which is the part that would have shipped
wrong.** A warranty of "6 months from 31 August" expires 28 February.
JavaScript's `Date` rolls a month overflow forward and would have said
3 March — quietly extending cover by three days on every job whose
completion landed on the 29th, 30th or 31st. `addMonths` clamps to the
last day of the target month, handles leap years, and is tested at both.
Confirmed in the real UI, not only in the test: entering 2026-08-31 + 6
renders "runs out 2027-02-28".

**Whether a callback was in warranty is judged by its REPORTED date**, not
by when it was resolved and not by today. A call raised in warranty stays
in warranty however long the fix takes — otherwise a slow repair would
quietly move the cost onto us.

28 new tests. Verified able to fail by injecting two regressions — an
empty checklist reporting complete, and naive month arithmetic — which
failed 2 and 2 tests respectively.

### Material orders can point at an SOV line, for attribution only (Cyrus)
`cyrus/drawings`

`MaterialOrder.lineItem` — nullable, `ON DELETE SET NULL`, and **nothing
may ever sum money through it.** Material cost stays on `CostEntry`
against the same `JobLineItem`; this exists so a late delivery can be tied
to the scope it holds up, not so an order becomes a second source of
line-item cost. Agreed with Diego on exactly those terms before it was
written, and the constraint is recorded in the schema comment rather than
only in Slack, because the schema is what the next person reads.

The line select only offers lines from the order's own job, checked
server-side too — a line from another job would attribute a delivery to
scope it has nothing to do with. Deleted (change-ordered-out) lines are
excluded.

### Drawing sets, and a guard that had never fired (Cyrus)
`cyrus/drawings`

Sheet 16 closed out. `/drawings` records, per job, which revision of each
set the architect has issued and whether it is actually in the trailer.

**No counter here, unlike every other numbered record in this app.** RFI,
submittal, safety case and material order numbers come from a counter row
we own. "Rev 3", "ASI-12", "Bulletin 5" are the ARCHITECT'S labels,
printed on a title block we don't control — issuing our own number for
someone else's document would invent a second identity for a sheet the
whole job already refers to by its real one.

**Current means most recently ISSUED, not most recently received.** A
revision supersedes the one before it whether or not it has reached you,
which is exactly why an unreceived issue is dangerous rather than merely
pending — the crew is building from paper that is already out of date. The
page counts those separately and says so in red.

**The set is linked, not uploaded.** Server Action bodies cap around 1MB
and real drawing sets are tens of megabytes, so an upload here would pass
for a test file and fail for every real one. The `fileUrl`/`fileName`
columns exist, so a client-side upload can be added later with no
migration. Links are validated to http(s) — the string goes into an
`href`, so a `javascript:` URL would be an injection vector.

### A P2002 guard that never fired anywhere in the app (Cyrus)

Found by clicking, not by any check: recording a duplicate revision label
returned a 500 instead of the plain-language message written for it.

The catch was the codebase's established pattern —
`err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"`.
Instrumented the real runtime rather than guessing:

    DIAG ctor: PrismaClientKnownRequestError
    DIAG code: P2002
    DIAG instanceof: false

The class resolves, the error is the right shape, and the instanceof is
still false — the client's internal error class and the re-exported
`Prisma` namespace are different copies under this bundling. `prisma` and
`Prisma` come from the SAME import, so this is not specific to one file.

**Three existing call sites use the identical pattern and are therefore
also dead:** `company.ts:29`, `jobs.ts:335`, `fieldReports.ts:59`. On
field reports that means the "one report per job per day" message — the
one described in review as turning P2002 into plain language — has never
once been shown; a foreman filing a second report for a day gets a 500.

Fixed with `isUniqueConstraintError()` in `shared.ts`, which checks the
`code` property and so cannot be defeated by class identity. Applied here
and to `fieldReports.ts`. `company.ts` and `jobs.ts` are left alone and
flagged — `jobs.ts` is claimed by the other lane.

The general form, since it will bite again: **an `instanceof` against a
class from a re-exported package is a guess about module identity, not a
check on the value.** Prefer the discriminating property.

### A successful write showed an empty list — cause NOT established (Cyrus)
`cyrus/material-orders`, corrected on `cyrus/drawings`

**This entry originally blamed the connection pool. That was wrong, and
the correction matters more than the original claim.**

What was observed, and still stands: creating a material order returned
ok, the form closed, the row was in the database, and the page rendered
"Nothing on order". A manual reload showed it correctly.

What was asserted and should not have been: that an exhausted pool made
the revalidated re-render query nothing. The pool WAS throwing
`Timed out fetching a new connection` at the time, so the explanation
looked obvious. It doesn't hold. There was no error boundary in the app
then, so a query that threw would have produced a 500, not an empty list.
A ColorZilla browser extension was also injecting a hydration mismatch
into `<body>` in the same repro. Two candidate causes, neither isolated.

The untested hypothesis that fits all three observations — no 500, empty
list, correct after reload — is that the router refresh never fired and
the STALE pre-create render stayed on screen. Falsifiable by watching
whether the RSC refresh request is made at all after a create. Nobody has
done that yet. It is not a claim.

**What IS established is the risk it pointed at**, and that got fixed: a
page that fails after a commit invites a second click, and no create
action was idempotent. 57 create buttons now disable while their form is
in flight, plus an error boundary that says not to resubmit before
reloading.

The lesson worth keeping is not about pools. A plausible cause sitting in
the logs next to a real symptom is not a diagnosis, and writing it up as
one puts a false explanation in the place the next person looks first.

**Measured 2026-08-29, and it narrows things.** Created an order with
network capture running. The browser reported ONE `POST /material-orders`
and no separate refresh `GET`. The dev server log, for the same create,
reported TWO:

    POST /material-orders 200 in 21ms      <- fast
    POST /material-orders 200 in 5567ms    <- slow

So the refresh is not a `GET`, which is why looking for one found nothing.
The 21ms/5567ms split is consistent with the first request doing the write
and the second doing the re-render — meaning **the re-render is a separate
request with its own failure point, after the write has already
committed.** That would explain every observation: the write returns 200,
the second request fails or returns nothing useful, the client keeps the
stale pre-create render, no 500 anywhere, correct after a manual reload.

Still not a diagnosis. Which POST is which is not confirmed, and the
failure has not been reproduced — that needs the second request forced to
fail. Also note the browser tool and the server log disagreed on how many
requests there were, so neither is trustworthy alone here.

Next step for whoever picks this up: force the second POST to fail (kill
the pool mid-create) and watch whether the page goes stale rather than
500ing. That is the experiment that settles it.

### `ActionResult` moved to `lib/actions/shared.ts` (Cyrus)
`cyrus/material-orders`

Submittals defined `ActionResult` locally as the first module in the
returned-failure shape. Adding a second such module broke the build:
`lib/actions/index.ts` does `export *` from every domain file, and two
modules exporting the same type name is `TS2308`. The type and its `ok`/
`fail` helpers now live in `shared.ts`, which is deliberately not a
`"use server"` module and is never re-exported from the barrel — so there
is exactly one definition and no collision. Both submittals and material
orders import it from there.

Worth noting the failure mode: two structurally identical copies of a type
in two feature modules is invisible until a third feature adds a third
copy. The barrel caught it at `typecheck` this time; it would not have
caught two copies that had drifted apart in shape.

---

## 2026-08-27

### Production redacts thrown Server Action messages — settled by result (Cyrus)
`cyrus/submittals`

Ran a real production build locally (`pnpm build` + `next start`) and
tripped the RFI answered-before-sent guard. Dev shows the plain sentence;
production rendered the generic "An error occurred in the Server
Components render… omitted in production builds" text. So every
`throw new Error("plain language")` in the app degrades to boilerplate
for a real user while reading perfectly in dev. Open question 2 from the
08-26 review entry is no longer open.

The check that catches it: a production build run locally, then clicking
a guard. Neither typecheck, lint, dev-mode clicking, nor a green deploy
would ever show it.

### Submittals — first module written in the returned-error shape (Cyrus)
`cyrus/submittals` — FEATURE-AUDIT category 16

- New `/submittals` page. `Submittal` + `SubmittalRevision` +
  `SubmittalCounter` in `operations.prisma`, new
  `lib/actions/submittals.ts`. One line each in `middleware.ts`,
  `Sidebar.tsx` and the actions barrel.
- **Because of the redaction finding above, these actions RETURN their
  failures** — `{ ok: true } | { ok: false, error }` — and the forms
  render `error` from the result. `throw` is reserved for genuine bugs,
  which should be redacted. The type is module-local until both lanes
  agree on a shared one in `shared.ts`; converting the older
  throw-based modules is its own piece of work.
- **The submittal's status is derived from its latest revision on every
  render, never stored.** A stored status can disagree with the revision
  that produced it, and that contradiction is how someone builds from a
  superseded drawing. States: not sent / with the GC / revise-and-resubmit
  (our court) / approved.
- **Each round trip to the GC is its own revision row** with entered —
  never stamped — sent/due/returned dates, because the turnaround per
  revision is the delay-claim evidence. Revision numbers come from a
  counter on the submittal row, incremented in the sending transaction;
  submittal numbers come from `SubmittalCounter` per job. Same rule as
  RFI and safety case numbers: nothing derived from surviving rows.
- **A sent package can never be deleted** — it is correspondence the GC
  also holds. Only a registered-but-never-sent one can.
- Ordering guards: a response can't predate its revision's send; a
  resubmission can't predate the response that caused it; a second
  revision can't go out while the GC still has the first. The send
  guards read the latest revision inside the sending transaction —
  checked outside it, two people resubmitting at once would strand a
  revision no form could ever respond to.
- An approved package can still take a new revision (a design change
  after approval is normal); what it can never do is have its recorded
  stamp falsified to get there.

### `/rfis` list header no longer calls every visible row "open" (Cyrus)
The header said "N open" but counted drafts and answered RFIs — the
tiles' `isOpen` means awaiting an answer, so the two disagreed on the
same screen. The list header now says "in play"; the open tile keeps its
stricter meaning.

## 2026-08-26

### Adversarial review of RFIs and Safety — seven defects fixed (Cyrus)
`cyrus/rfis`

Two independent reviews were run against the RFI and Safety code looking
for defects rather than approval. Everything below passed typecheck, lint
and a full production build, and none of it would have been caught by
those. Most severe first:

- **A sent RFI could be deleted.** `deleteRfi` allows drafts only — but
  `updateRfi` re-derived status from the dates, so clearing the sent date
  on a sent RFI turned it back into a draft, and then it deleted. That
  destroys correspondence the GC also holds and leaves a permanent hole in
  the numbering. `sentOn` can no longer be cleared once set.
- **Editing an RFI reopened a withdrawn one.** Same re-derivation: a
  closed-without-answer RFI went back on the open list when someone fixed
  a typo in its subject. Status is now preserved on edit; draft → sent is
  the only transition an edit can make.
- **A same-day answer was impossible.** `markRfiSent` stored a wall-clock
  instant while every other date is stored at UTC midnight, so an answer
  dated today compared as *earlier* than a send stamped at 14:30 and was
  rejected — with a message blaming the user for correct data.
- **Date inputs defaulted to the server's UTC date.** At 17:00 in
  California the UTC date is already tomorrow, so a form opened at the end
  of a shift pre-filled tomorrow. On a safety incident that is worse than
  a wrong date: on 31 December it picks the wrong case-number series, and
  the incident date is not editable afterwards. Defaults now come from the
  user's own calendar; storage and rendering stay UTC.
- **Safety day counts were enforced only by the form hiding the inputs.**
  A direct action call could store `FIRST_AID_ONLY` with 40 days away, and
  the log would print a row contradicting itself. Cleared server-side
  unless the outcome is one OSHA counts days for.
- **`assertOwner` said "Only the account owner can manage team members" at
  all 18 call sites** — deleting a vendor, an invoice, a punch-list item.
  Pre-existing. Now a generic default with a specific message where useful.
- **The cost/schedule impact tile counted only visible rows,** so it fell
  to zero as answered RFIs were closed — exactly as the work got done. It
  is a job-lifetime figure and is now counted from the database.

**Known and not fixed here, deliberately:**

- The `add_safety_case_counter` migration seeds the counter from
  `MAX(caseNumber)` — the same derivation the feature exists to avoid. For
  a database where cases were deleted *before* the migration ran, a number
  can still be reissued once. There is no recoverable record of deleted
  numbers, so no better seed exists; rewriting an already-applied
  migration is its own hazard. Flagged rather than hidden.
- **Next.js redacts thrown Server Action errors in production builds.** If
  that holds here, every plain-language guard message in the app degrades
  to an opaque digest for the user — across both lanes, not just these
  features. Needs verifying against a real deployment and, if confirmed, a
  move from `throw` to a returned `{ ok, error }` shape. That is its own
  piece of work.
- A wrong incident date can only be corrected by deleting and re-filing,
  which retires the case number. Whether an owner should be able to edit
  the date within the same year is a product decision, not a bug fix.

### RFI log (Cyrus)
`cyrus/rfis` — FEATURE-AUDIT category 16

- New `/rfis` page. `Rfi` + `RfiCounter` in `operations.prisma`, new
  `lib/actions/rfis.ts`. Its own page, nothing in Diego's lane.
- **Built as an evidence record, not a task list.** The dates are the
  product: sent, answer-needed-by, and the date the answer actually came
  back. An RFI sent and answered three weeks late is what a delay claim is
  argued from.
- **Overdue is derived from the dates on every render, never stored.** A
  stored overdue flag is correct for one day. `today` comes from the server
  so the server and browser can't disagree about the date.
- **The sent date is entered, not stamped, and can be backdated.** The first
  version stamped `sentOn = now` behind a "mark as sent today" checkbox.
  That made the first real use of the feature impossible: entering the RFIs
  you already sent over the last three weeks would record every one as sent
  today, and the response-time evidence — the whole point of the log —
  would be fiction. Blank sent date means draft; status follows the date
  rather than being set separately, so the two can't disagree.
- **An answer can't be dated before the RFI was sent.** Found by clicking:
  the row rendered `sent 2026-08-26 · answered 2026-08-23 · -3 days`. A log
  that can hold an answer arriving before the question discredits itself,
  and a negative day count is the number someone would quote in a dispute.
  Rejected in the action; the row also refuses to render a negative count
  for any record predating the check.
- **The answer date is entered, not stamped.** Recording an answer that
  arrived last Tuesday must not read as arriving today, or the log
  overstates the GC's response time — which destroys its value as evidence
  in the direction that matters.
- **RFI numbers use the same counter pattern as safety case numbers**, for
  the same reason: a GC references "RFI 12" in writing, so a number that
  comes back after a deletion points at two different questions.
- **A sent RFI cannot be deleted, only closed.** Deleting it destroys
  correspondence the other side still holds. Drafts can be deleted.
- Cost and schedule impact are flags set when the answer is read. They
  deliberately do not create a change order — they mark which RFIs to pull
  when someone builds one.

### Pre-existing: `nextChangeOrderNumber` has the same reissue bug (open)
`apps/web/lib/actions/shared.ts` computes change order numbers as
`max(number) + 1`. Nothing deletes a change order today, so the reissue
path isn't reachable — but the concurrency race is: two people adding a CO
to the same job at the same moment both read the same max, and one gets a
raw Prisma unique-constraint error. Flagged to Diego rather than fixed
here; `shared.ts` and change orders are his lane.

### FEATURE-AUDIT.md corrected
It still listed categories 17, 19, 20 and 22 as `0 built` while vendors,
equipment, punch lists, daily field reports and safety were all on main.
Second time this file has drifted in a day. Corrected against what's
actually in the schema.

### Neon connection pooling (Cyrus)
`cyrus/db-pooling`

- **Every page in the app was returning a 500**, local and deployed alike:
  `Timed out fetching a new connection from the connection pool`. Not a
  code change — the app had always pointed at Neon's **direct** endpoint,
  which allows very few connections, while Prisma opened a pool of 17.
- Fixed by using Neon's **pooled** endpoint (`-pooler` in the hostname) for
  `DATABASE_URL` and keeping the direct endpoint as `DIRECT_URL`, which
  `prisma migrate` requires — a pooler can't run migrations. Datasource now
  declares `directUrl`.
- Pool dropped to 5 connections, timeouts raised to 30s. Neon suspends an
  idle compute; the first request after a quiet period has to wake it, and
  the 10s default expired during the wake.
- **This was worse in production than locally.** Vercel is serverless —
  each invocation opens its own connection, so the direct endpoint
  exhausts far faster there. It had never been caught because nobody had
  loaded the deployed app end to end.
- **Anyone with a local checkout must add `DIRECT_URL` to their `.env`,
  and both variables must be set in Vercel project settings.** Neither is
  fixed by pulling the code.

### Safety & field operations (Cyrus)
`cyrus/safety` — FEATURE-AUDIT category 17

- New `/safety` page with two records: the incident log and toolbox talks.
  New `SafetyIncident` and `ToolboxTalk` models in `operations.prisma`, new
  `lib/actions/safety.ts`. Nothing outside my lane was touched — one line
  each in `middleware.ts` and `Sidebar.tsx`.
- **Case numbers are issued by a counter row that only increments
  (`SafetyCaseCounter`), not computed from the incidents.** The first
  version took `max(caseNumber) + 1`, which is wrong: delete the *highest*
  case and the max drops back, so the next case reissues that number. A row
  count fails the same way. Anything derived from the rows that still exist
  can be reissued, because deleting a row changes the answer — caught by
  clicking it, not by any check that passed. The counter is incremented in
  the same transaction that creates the incident, which also settles the
  race where two people file simultaneously and both read the same value.
  The migration seeds the counter from existing incidents so numbering
  continues rather than restarting. Case number and year are not editable
  after creation — they identify the case on a document that may already be
  filed.
- **"Recordable" is derived from the outcome, never stored.** Everything
  except first aid is recordable on the 300 log. Storing it as its own
  field lets it disagree with the outcome, which is exactly the kind of
  contradiction an inspector finds.
- **`jobId` is optional on incidents.** Injuries happen in the yard, the
  shop and in transit, not only on jobs. Requiring a job would train people
  to attach the incident to whatever job was handy, which corrupts the
  record more than a blank field does.
- Day counts (away / restricted) only appear for the two outcomes where
  OSHA counts them. Showing them otherwise invites numbers that don't
  belong on the log.
- First aid cases are logged too, and the empty state says why: a first-aid
  case that later turns into lost time is only defensible if it was written
  down the day it happened.
- Dates stored at UTC midnight and rendered in UTC, same rule as daily
  field reports.
- Create and inline-edit share one `SafetyIncidentFields` component so the
  two forms can't drift. Two-step delete, owner only, no `window.confirm`.

### Daily field reports (Cyrus)
`cyrus/field-reports` — WORK-SPLIT task 3

- New `DailyFieldReport` model and a section at the end of the job page:
  crew on site, work performed, weather, delays. One entry per job per day.
- **Weather and delays are the reason this exists.** A delay claim or a
  schedule dispute months later gets argued from these, and nothing
  captured them before.
- **One report per job per day, enforced by the database**
  (`@@unique([jobId, reportDate])`), not by code. Two people filing the
  same day would leave contradictory records of what happened — worse than
  one person editing an existing entry. The duplicate error is caught and
  turned into plain language rather than surfacing a Prisma code.
- Dates are stored at UTC midnight and rendered in UTC. Rendering in local
  time would show the previous day for anyone west of UTC.
- `crewPresent` is free text rather than a link to `JobAssignment`: the
  crew that shows up rarely matches the roster, and forcing the link would
  make people record the roster instead of the truth.
- The report date is not editable. It's the identity of the record — filed
  against the wrong day, delete and re-file.

**Touching `jobs/[id]/page.tsx`, which is Diego's file:** 19 insertions,
0 deletions. One import, one additive `include`, one `<section>` at the
very end. Agreed with him in #prova-build before writing.

Not done: no photos, no per-report crew hours (that's `TimeEntry`), no
copy-yesterday shortcut.

### Split the two files we kept colliding in (Cyrus, agreed with Diego)
`cyrus/split-shared-files`

Every feature either of us built edited `packages/db/prisma/schema.prisma`
and `apps/web/lib/actions.ts`. PR #6 conflicted in exactly those two files
and nothing else — not a feature collision, just two people appending to
the same file. This makes that structurally impossible.

- **Schema** is now `packages/db/prisma/schema/` — 7 domain files
  (`company`, `jobs`, `estimating`, `labor`, `billing`, `compliance`,
  `operations`) plus a header file holding only the generator and
  datasource. Grouped by domain rather than one file per model: 36 files
  would mean hunting relations across the tree for no gain.
- **Actions** are now `apps/web/lib/actions/` — 9 domain modules plus
  `shared.ts`. `index.ts` re-exports them, so every existing
  `@/lib/actions` import works unchanged. No call site was touched.

Pure move. Same 51 models, same 67 exported actions, same bodies. Verified
by diffing the sorted names before and after.

**Two things this turned up that were not obvious:**

1. With a multi-file schema, Prisma expects `migrations/` **inside** the
   schema folder. Left where it was, `prisma migrate status` reported
   "No migration found" and then "Database schema is up to date!" in the
   same breath — because with nothing to compare, nothing looks wrong.
   `migrate deploy` would have applied nothing to a fresh database. The
   check that catches this is `migrate status` naming real migrations, not
   the absence of an error.
2. Next.js rejects `export *` inside a `"use server"` file — it can't prove
   a wildcard only yields async functions. The barrel is therefore a plain
   module; each domain file carries its own `"use server"`, and a
   re-exported action keeps that identity from where it's defined.
   `pnpm typecheck` does not catch this. Only `pnpm build` does.

Also applied 6 migrations from Diego's merge that had never been run
against the local database.

### Punch lists (Cyrus)
`cyrus/punch-lists` — WORK-SPLIT task 5

- New `PunchListItem` model and `/punch-lists` page. What still has to be
  fixed before a job closes out. `JobStatus` runs ESTIMATE → COMPLETE with
  nothing in between, so until now this list lived in someone's memory of
  the walkthrough.
- Filter by job or see everything at once; completed items hidden by
  default with a toggle. A super walking three jobs wants everything still
  open, not one job at a time.
- Checking an item off is one click and reversible, so it asks nothing.
  Delete still asks twice.
- "Raised by" comes from the signed-in user, not a form field — nobody
  types their own name during a walkthrough.
- The add form deliberately stays open after saving, unlike vendors and
  equipment: punch items get logged in bursts, five in a row on the same
  job. Job selection is kept, description clears and refocuses.

**Built as its own page rather than a section on `jobs/[id]/page.tsx`.**
WORK-SPLIT assigns that file to Diego and he's been editing it this week,
so this avoids the collision entirely. The per-job section can be added
later as a thin read of the same model — the data doesn't change.

Not done: no due dates, no photo attachments, no assignment to a person.

### Equipment inventory (Cyrus)
`cyrus/equipment` — WORK-SPLIT task 4

- New `Equipment` model and `/equipment` page. What the company owns —
  scaffolding, lifts, mixers — and which job each item is on right now.
  Unassigned means "in the yard", a normal state rather than missing
  data, so the list header counts both.
- Type is free text rather than an enum. Categories vary too much by
  trade to fix a list now, and guessing wrong means a migration to add
  the one type a contractor actually owns.
- Deleting a job returns its equipment to the yard rather than deleting
  it along with the job.
- Built on the vendor pattern as fixed below, not the bare version.

Not done: no equipment cost allocation into job costing. Step one is
knowing what you own and where it is.

### Vendor directory — edit, delete confirmation, collapsible form (Cyrus)
`cyrus/vendor-edit`

- **Vendors can be edited.** Previously add and delete were the only
  operations, so fixing a typo in a phone number meant deleting the vendor
  and retyping every field. Edit swaps the row for a form in place.
- **Remove asks twice.** It sits next to Edit; a misclick shouldn't
  silently destroy a hand-typed record. Two-step button rather than a
  browser `confirm()`, which is blocked in some embedded browsers and
  can't be styled.
- **The add form is collapsed behind a button.** Open by default it filled
  the viewport, so you scrolled past six empty fields to reach the
  directory. Looking a vendor up is the common case; adding is occasional.
- Fields extracted into `VendorFields` so the create and edit forms share
  one definition and can't drift apart.

Not done: no search or filtering — fine at this size, will need it past
~50 vendors.

### Vendor/supplier directory (Cyrus)
`cyrus/vendor-directory` — WORK-SPLIT task 2

- New `Vendor` model and `/vendors` page. Records who you buy from —
  board and steel suppliers, scaffolding, equipment rental. Until now a
  material cost was a dollar amount with no source attached.
- Trade scope is optional. Fastener and equipment-rental suppliers serve
  every trade; forcing a choice would record something false.
- Owner-only delete, matching every other company-level record.

Not done: no link between vendors and jobs, costs, or pricing history yet.
It's a directory.

### CI has never passed — fixed (Cyrus)
`fix(ci)`

- Every CI run since the repo was created failed in about ten seconds. The
  workflow declared the pnpm version in two places — `version: 10` in
  `.github/workflows/ci.yml` and `packageManager` in `package.json` — and
  `pnpm/action-setup@v4` aborts rather than choosing. Install, lint,
  typecheck and build never ran, on any commit, by either of us.
- Removed the workflow's version pin; `package.json` is the source of
  truth and the action reads it automatically.
- CI now takes about 2m20s and actually checks things.

Note: pushing changes to `.github/workflows/` needs a token with the
`workflow` scope. Without it the push is rejected.

### TRAILER company location type (Cyrus)
`cyrus/trailer-location-type` — WORK-SPLIT task 1

- Added `TRAILER` (a job-site field office) alongside HQ, BRANCH_YARD and
  WAREHOUSE.

---

## Open, not owned by this changelog

Tracked here because both of us keep rediscovering them:

- **Five features are on `claude/app-access-confirmation-ik5ise`, not on
  `main`** — line-item catalog, subcontract storage, field time entry,
  per diem/travel pay, dispatch slips. `main`'s FEATURE-AUDIT.md counts
  them as built. Verify with `git log main..origin/<branch> --oneline`.
- **Default branch is still `claude/brave-allen-dmu1e7`.** A fresh clone
  does not land on `main`.
- **The repo is public.** An unauthenticated clone succeeds.
- **The Anthropic API key was emailed in plain text** and has not been
  rotated.

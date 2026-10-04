### #418 does not reproduce in a dev build, and the production-writes hunt was looking for the wrong artefact (Diego)
`diego/418-dev-mode-audit`

**DOCS-ONLY. No code, no schema, no migration.** Two CLAUDE.md entries
corrected from measurements, under the audit exception in the working
agreement — both are "recording what an investigation established or
ELIMINATED, so the next person does not re-run the same checks", and one of
them corrects a live elimination that is false outside the context it was
measured in.

**1. The #418 instrument was finally pointed at the bug, and the bug
vanished.** The entry has said for a week that `E2E_DEV_SERVER=1` is "the
one instrument nobody has pointed at it yet" and "the only way left to learn
WHICH element the two sides disagree about". It has now been run on a
laptop: **96 authenticated page loads across 16 routes, zero mismatches.**
Sixteen routes is the union of all four page lists the entry records, plus
three it never named, so "you tested the quiet pages" is answered rather
than left open. Against production's own measured 12-in-40, P(0 in 96) is
about 10^-15.

The zero is only reportable because the probe was proved able to return
non-zero, which is the part worth copying. Each batch ended with a positive
control that rewrote `/dashboard`'s HTML to carry one extra `<div>` inside
`<body>` — inside React's tree, the ColorZilla mechanism from the #61 entry
— and all four fired 3/3 naming the injected node. Every load was
independently proved hydrated by looking for a `__reactFiber$` key, since
React cannot mismatch on a page it never hydrated and an un-hydrated load is
a silent zero. The first version of the probe had neither check and its zero
would have meant nothing.

Per the entry's own rule — a mismatch that vanishes under `next dev` is
probably the Flight deferral — this is the first POSITIVE signal in an
investigation that had produced nine eliminations and no mechanism. It is
recorded as evidence, not a verdict: build mode and machine moved together,
the defect is a race, and a laptop dev server is not a GitHub runner. The
experiment that separates them is named in the entry (the same probe in CI),
and the counter-example that keeps it honest is kept too — the accidental
dev-mode CI run DID name the `UserButton` div, so dev mode is not blind to
#418 in general.

**2. "A CHECKOUT holding the connection string" was never run, and is
unsupported.** That has been the leading hypothesis for the stray production
rows since 4-5 September. Running it took three messages: `ListAgents`
listed three peer sessions on this machine and all three checked their own
checkouts. 185 files name the endpoint across 18 worktrees and every one is
repo-tracked source, docs, `migrate.yml`'s deliberately-hardcoded
`MIGRATE_EXPECT_HOST`, or the two tests that name it precisely to assert the
scratch guard refuses it. **No env file on the machine points at
production.** Snapshot of 2026-09-30 against sightings 25 days earlier, so
it is "unsupported now" rather than "it was not that" — a distinction this
file has an entry about.

**The route it was hiding needs no env file, which is why looking for one
found nothing.** The strays were `SalesActivity`, `SalesLead` and
`CompanyLicense` — app-level rows a migration workflow cannot write. A
session signed into `app.cstream.ai` can, on production's own Vercel
variables. That is now demonstrated rather than supposed: one of the peers
disclosed unprompted that it created real production rows on 2026-09-20
through exactly that route, by browser automation against the UI, and did it
correctly — announced in `#prova-build` before the writes, all six deleted
and verified on screen afterwards. It is not the culprit (it postdates the
sightings and never touched the sales models); it proves the mechanism is
real and in routine use.

**And the elimination that hid it was true about containers and read as true
about everything.** The browser route was eliminated because an agent
container's `curl` "fails at CONNECT". That measurement stands for
containers and does not cover a laptop, where a plain `fetch` to Clerk's API
returned `HTTP 200` on 2026-09-30. "An agent cannot reach production" was
never a property of agents.

**Also corrected: this entry said peers were unreachable.** It read "A cloud
session cannot be questioned from another container… `SendMessage` returns
`No agent named '…' is reachable`". True, and about CLOUD sessions — read
generally it is the one sentence that stops anyone trying, and trying took
minutes. Cloud sessions remain unreachable; that half needed no correction.

**Two mechanisms recorded that are not the cause.** An agent copied
`apps/web/.env` and `packages/db/.env` between worktrees on 2026-09-26 (demo
endpoint, so nothing leaked, and exactly how a production string would
spread if one existed). And every `pnpm build` and `preflight.sh` opens a
connection — not in the "migrations that will hit PRODUCTION" report, which
is pure git and grep, but one step earlier at `preflight.sh:104` →
`check-schema.mjs:74`, which runs `prisma migrate status`. A read, so not a
candidate for the rows, but "nobody wrote" and "nobody connected" are
different questions and only the first was asked.

**One defect found in passing and NOT fixed here.** `/closeout` logs React's
missing-`key` warning on every render, 6 of 6 loads, the only page of
sixteen that did — and production React strips that warning, so no
production run can ever surface it. Closeout & Warranty is Cyrus's lane
(WORK-SPLIT.md:44), so it is a GitHub issue assigned to him per rule 3, not
a change in this PR. The transferable half is in the entry: there is a class
of real defect only a development build will report, which is a reason to
point a dev run at this app occasionally even when nothing is wrong.

**Harness notes for whoever runs it next**, because three of four attempts
died before producing a number. `next dev` has two distinct memory failures:
"approaching the used memory threshold, restarting" is cured by
`NODE_OPTIONS=--max-old-space-size=8192`, and `FATAL ERROR: Zone Allocation
failed` is not — zone allocation is a separate allocator the heap flag does
not govern, and its next symptom is `ERR_CONNECTION_REFUSED`, which reads
like a broken app. Four routes per dev server, one worker, fresh server per
batch.

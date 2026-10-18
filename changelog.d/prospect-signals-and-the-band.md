### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

`/sales` knew who we were talking to and could not answer the question that
decides a morning: of these, which one do I call, and what do I say first.
Cyrus asked whether a sales agent bot was worth coding rather than paying
$300/month for one. The honest answer was that the $300 buys deliverability,
contact data and compliance — the expensive, risky parts — and that writing
our own replaces the cheap part. But the half that IS worth building, and
where he has an unfair advantage, is the research: walking into a call able to
say "you're framing the Mission Valley job under Turner" instead of "hi, do
you use software".

So a lead now carries SIGNALS. One signal is one thing you found out about a
prospect, with the page you read it on — what they do, where they work, who
they build for, a job they are on now. And from those, a BAND: *Call this
one* / *Worth a call* / *Too thin to call* / *Not a fit*.

**The band shows its reason, not just its colour, and the reason is the
point.** A pill saying "too thin" tells somebody they cannot call and not
what to go and find out. The reason names the missing half — "Not confirmed
yet: where they work" — and on a strong lead it IS the opening line.

**Nothing here sends anything.** No email, no dialler. The deliverable is a
briefed human. That is a product decision with two teeth in it: cold email at
volume from a new domain can poison the sending reputation `cstream.ai` needs
for invoices and GC portal links, and auto-dialling mobiles is TCPA exposure
at per-call penalties against a trade whose numbers are nearly all mobiles.

### Four decisions worth reading

**A claim with no source does not exist.** `sourceUrl` is `NOT NULL` in the
database, so no code path can invent one, and the form says why before you
type rather than after. `leads.ts` already states the reason and it is sharper
when we are the ones calling: a sub who rings an owner about a job that does
not exist has spent credibility he cannot get back.

**The band is arithmetic, never a model's opinion.** `lib/sales-qualification.ts`
is pure and imports nothing that can reach a language model.
`salesQualificationPurity.test.ts` fails the build if that changes — and its
control is the interesting half: every forbidden pattern must still match a
live import *somewhere in the monorepo*, because judging them against
`apps/web` alone declared `@anthropic-ai/` dead and would have had the census
delete its own best rule. A pattern must be proven wherever the thing it names
could legitimately appear, and enforced only where it is banned.

**An unreviewed signal can never raise the band.** Only `CONFIRMED` counts.
Otherwise the band measures how much searching happened rather than what is
known, and the busiest-looking lead is the one with the least confirmed about
it. Mutation-proved red three ways.

**`disqualifies` is one boolean, not a second taxonomy.** The first design
derived "not a fit" from a trade outside our five, which needed a second copy
of the trade list in the scoring module — the exact #526 defect. One flag
covers they-are-the-GC, shut-down, already-a-customer and
locked-into-a-competitor, and the canonical trade list stays in the one place
that owns it.

### Three defects this found in its own making, each caught by something other than judgement

**A stripped field rendered an empty sentence.** The `/sales` list query
selected only the three fields the band reads, to keep it small, and passed
`claim: ""`. Typecheck was clean, 17 unit tests passed, and a *Call this one*
lead showed a blank reason on the one screen where the reason is the whole
value. The caller now selects `claim`; `shortClaim` has an explicit fallback
and a regression test, because the next caller will make the same trade for
the same reason.

**A form that refuses must not be submitted through `action`.** Both forms
were written as `<form action={fn}>`, which in React 19 resets the fields
BEFORE the action runs — so the source-link refusal, the one somebody will
actually hit, would have arrived over an emptied form and lost the sentence
they had just found. `formActionCensus.test.ts` named both sites.
`SubmitButton` went with it: `useFormStatus` reports nothing for an
`onSubmit` form, so the spinner rides the transition instead.

**And the reader census was asking the wrong question.** It checked whether
anything under `components/` or `app/` imported the qualification module.
Mutation-tested by stripping every reference from all three real consumers, it
stayed GREEN — because `SalesSignalFields` imports the kind list to build a
dropdown. The band could have been orphaned while the kind list kept the
module "used". It asks for `qualify` BY NAME now. That is this repo's own
recurring shape — *nothing is ever missing from a question nobody is asking* —
turning up inside a census written to prevent it.

### The trap that did not apply, checked rather than assumed

A new RESTRICT child is normally three edits: the model, `HANDLED_MODELS`, and
the `del()` order in both cleanup scripts — the trap #224 fell into.
`HANDLED_MODELS` is **job-owned rows only**, and a signal is lead-owned, like
`SalesActivity`, which is also correctly absent from all three. Verified by
running `scratch-cleanup-order.test.ts` and `counterCensus.test.ts` against
the new foreign keys rather than by reasoning about them.

`deleteSalesLead` DOES now count signals. WORK-SPLIT records that exact guard
shipping without the activities count while `SalesActivity.leadId` was already
RESTRICT, so the delete failed at the database with a message production
redacts. A researched lead refuses deletion and says how much evidence it is
holding — which is also right on the merits, since the research is the
expensive part of the record.

### What is deliberately NOT here

The web-search call that proposes signals. That is Diego's lane, and it is
built as an injected seam rather than reached into his package. Slice one
therefore ships with a hand-typed signal and no model at all — on purpose, so
the screen, the action and the band are all exercised by a person before any
research call exists. A seam with nothing behind it is how "written,
documented, and never called" ships green.

### Verification

Typecheck clean, lint clean (0 errors), 8,648 of 8,659 unit tests pass. The 11
failures are two files this container cannot run and that this branch does not
touch: `xlsx-import` needs a CDN tarball the egress proxy blocks, and
`complianceUploadAllowance` TIMES OUT at 30s rather than asserting. `main`'s
own `ci` job passes with both present.

Seven mutations, each red on its own assertion: PROPOSED counting toward the
band, the disqualifier check disabled, SIZE added to the opening kinds, the
empty-claim fallback removed, the band importing a model package, a forbidden
pattern typo'd dead, a second copy of the kind list inlined, and the band
orphaned from every screen.

**Not clicked.** Slice one is a screen, so clicking is the point — the
click-list is in the PR.

### Nothing in this app had ever read a specification (Diego)
`diego/spec-section-reader`

A GC's invitation arrives with a spec book. For a framing, drywall, plaster,
EIFS, ceilings or fireproofing sub the money sits in two or three sections of
Division 09, each thirty to sixty pages of requirements written by an architect,
and the estimator's fear is one sentence long: **a requirement that costs money
and was not in the number.** Level 5 finish where Level 4 was bid. A UL assembly
that changes the stud gauge. A field mock-up nobody priced. Third-party testing.
"No substitutions" on a product that costs twice the one in the catalogue. Any
one of those is a bid won at a loss, and the only thing standing between the sub
and it was somebody reading forty pages carefully at 11pm.

The 2026-10-02 audit of the whole estimating workflow established against source
— not against `FEATURE-AUDIT.md` — that this app had never read a spec at all.
No specification model, no reader, and no `AI_FEATURES` member for one. The only
hits for "spec" anywhere were a label on an addendum item
(`BidAddendumReferenceKind.SPEC_SECTION`) and a free-text `specSection` on the
RFI and submittal forms.

So: log the sections of a bid's book, attach the PDF, and read one. What comes
back is a list of what the section DEMANDS that costs money — each finding with
the sentence it was read from, the page it was on, and one line on why it costs,
ordered **lowest confidence first** so the reader's least certain claim is where
somebody will look rather than buried at the end.

**What it deliberately does not do, and each refusal has a prior cost behind
it.** It writes nothing any other module reads — not a `BidRequirement`, not a
bid verdict, not a takeoff line. `bid-compliance.prisma` already states why: a
row the app can check itself carries a `satisfiedOn` that the underlying data can
contradict. It does not decide whether the bid carries the cost; that is the
`affectsPricedScope` mistake the addendum review killed, where `false` silently
removed a live warning and `true` was inert. And there is no carried/not-carried
tick in v1, because a decision keyed to free prose is discarded the moment a
second reading words it differently — the exact bug the addendum plan's review
caught. The findings sit beside the estimator's judgement and never replace it.

**The checks, and two of them found real defects.**

The double-read guard is an **atomic claim with a lease**, not a time window.
Issue #563 is open against the addendum reader for precisely this: a window that
reads, decides, then writes has thirty seconds in which two submits both see
nothing and both charge. A conditional `updateMany` that only matches an unclaimed
row cannot — `count === 0` IS the refusal, and the lease means a crashed read
does not wedge the section forever.

Pages are claimed **before** the model call, in one conditional `updateMany`
marked never released, so a failure is recorded rather than refunded. Spec pages
get their **own** meter rather than sharing the addendum one, because a section
is thirty to sixty pages against an addendum's two to twenty — sharing would mean
reading specs silently eating the allowance for reading addenda with no way for a
contractor to tell which feature spent their month. 1,800 pages a month, which is
a figure and not a measurement, in those words. The first draft of this said 600
on the strength of "four ten-page sections"; ten pages was wrong by five times,
which made 600 about three bids.

The eval scores **false confidence, not recall**, the same asymmetry the addendum
and symbol evals use. An invented requirement is FATAL — a finding the section
does not contain sends somebody to add money for work nobody asked for, and
unlike a missed finding they have no way to discover it short of re-reading the
section, which is the thing the feature was supposed to save them. One case names
Level 5 and a mock-up only to say both are **not** required here; reporting either
fails the run. Findings on a document of the wrong kind are FATAL, because a
reader asked to find things will find things. A quote that is not in the document
is FATAL. A missed requirement is reported and is **not** a failure: quiet is no
worse than today.

And the free half of it runs on every push, because a fixture nobody has opened
is a measurement about nothing — every synthetic section is rendered to a real
PDF and read back with the same pdfjs the app ships, including a control that the
invention trap's own forbidden sentence really is on the page. Without that, a
broken line in the PDF writer would send six blank pages, collect six empty
findings lists, and report a perfect score for a reader that was never shown
anything.

Two defects this branch wrote and two censuses on `main` caught while it was in
flight, which is the whole argument for rebasing before pushing rather than
after. `colorTokenCensus.test.ts` found `hover:border-line-strong` on three
buttons — a token that does not exist, so Tailwind emits nothing and the hover
renders colourless — and then found that the confidence badge had copied
`bg-tag-amber-ground` from its sibling component, which is issue #573's open
defect. The census's second assertion exists exactly to stop a known-undefined
token gaining call sites, and it did.

Migration `20261003030000_add_bid_spec_reading`, purely additive, generated
`--from-schema-datamodel --to-schema-datamodel` and **never** with
`--shadow-database-url`, which dropped `ep-icy-hat` on 2026-09-18. Renamed to
sort after `20261003013000` once that landed on `main`: out-of-order migration
names are a risk with no upside when the thing has never been applied anywhere.

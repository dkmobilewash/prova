### The document tray learns how this office actually files (Cyrus)
`cyrus/integration`

Cyrus asked for two things in one sentence — "can we also have the AI learn
how the contractor likes to work based off their responses", and then, asked
what to learn first, "I'd say learn job assignment".

**The substrate was already there, which is why this is small.**
`DocumentIntake` has kept `proposedKind` and `acceptedKind` side by side
since the model was written, and the schema says exactly why: *"the only way
to know whether this screen is any good is to be able to ask how often a
person changed the answer."* Every correction this office has ever made was
already on disk. Nothing read them back, so the same office corrected the
same document type every Monday forever.

`lib/intake/learn.ts` reads them. Two habits, and deliberately only two:

  - a **kind**, keyed on a word in the filename — "every file with WAIVER in
    the name that I was offered as a compliance document, I filed as a lien
    waiver";
  - a **job**, keyed on a word in the filename. The office names its files
    after the GC or the site, and no classifier can know that "BRKT" is the
    Brackett job.

**The expensive property is refusal, not accuracy.** What gets filed through
this screen is certified payroll, a pay application, an executed subcontract
— records this repo's own rules say lock on creation and never delete once
sent. Guessing right nine times and wrong once is worse here than not
guessing, because the tenth is not a mistake you take back. So:

  - a rule needs two corrections that AGREE, and **one contradiction kills it
    outright and permanently** — not a majority vote. The test feeds it two
    agreeing, one dissenting, then three more agreeing, and requires the rule
    to stay dead;
  - **match first, learn second**: a HIGH-confidence reading of the
    document's own text is never overridden, because that is evidence about
    THIS file and a rule is a habit about files that looked like it. Learning
    only fills a gap;
  - **blank when two habits disagree.** A file called `brkt-maple-joint.pdf`
    where one word means one job and the other means another is the moment to
    leave the field empty and let a person look;
  - agreement teaches nothing about kind. Accepting a proposal is agreement
    with a machine, not a person saying something it did not know. It does
    teach about the JOB, because the classifier never proposed one.

**Nothing is written back.** Learning moves what the picker defaults to and
appends a sentence saying why; the stored `proposedKind` is untouched,
because it is a thing that happened and a habit learned later must not
rewrite the reason somebody was shown when they decided. "How often did a
person change the answer" stays answerable.

**And it says what it learned, out loud**, which Cyrus asked for and is the
half that makes the rest acceptable: a screen that quietly gets better is
indistinguishable from one that quietly gets worse. Every line is a fact
about what the person did, with their own filenames as the evidence —
"Files with 'brkt' in the name go on Brackett — Gym Addition; you filed 4
that way (brkt-01.pdf, brkt-02.pdf, brkt-03.pdf)". Never "AI determined",
which is a reason nobody can check and therefore a reason nobody can
overrule. The panel is absent entirely until there is something to say.

Two things it drops rather than shows: a rule pointing at a deleted job
(it would set a jobId the picker has no option for), and a habit of filing
to "no job", which is the default the screen already offers.

`learn.test.ts` — 16 tests, and most of them are about learning NOTHING.
The tokeniser has its own fixture test first, because every "learned
nothing" assertion rests on it returning real words and an empty tokeniser
would pass all of them while checking the empty set — this repo's
most-repeated scar. Mutation-proved by breaking each guard in turn:
contradiction-kills, the two-example floor, the HIGH-confidence guard, the
ambiguity blank, agreement-teaches-no-kind and the token-length floor each
turn at least one test red (agreement-teaches-a-kind turns three).

One test was written wrong first and is noted in the file: the ambiguity
fixture let both tokens teach the SAME kind, so the kind rule fired
correctly and the assertion was the bug, not the code.

Bounded at the last 500 filed rows — roughly six of the eighty-file drops
this screen was built for. Enough for a pattern, recent enough to still be
true.

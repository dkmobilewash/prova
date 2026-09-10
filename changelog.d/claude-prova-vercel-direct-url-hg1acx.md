### The counter roll-call became a test, because the number rotted in a day (Diego)
`claude/prova-vercel-direct-url-hg1acx`

CLAUDE.md's sequence-number rule carried a count — "EIGHT counters exist
and all eight do this" — plus two shell commands to re-derive it rather
than be trusted, and a note that a bare count is the kind this file
deletes elsewhere for rotting faster than the claim it decorates. That was
written on 9 Sep. #228 added `ContractDocumentVersionCounter` the next
morning. Both commands printed 9; the prose still said 8.

**The commands were right to be there.** They are what caught it, in one
line, rather than anyone noticing. But a re-derivation nobody runs is
still a claim with an expiry date, so it is now
`apps/web/lib/counterCensus.test.ts` and fails the build instead.

It asserts three things, each a defect this repo has actually shipped:
every counter model is bumped through a **transaction** client; none is
bumped on the bare `prisma` client (that is #224's `max(n)+1` wearing a
counter's clothes, and it is not atomic with the insert it numbers); and
no counter model exists that nothing increments — the "written,
documented, and never called" shape wearing a schema.

**It counts what it parses against a literal that cannot drift with the
pattern**, which is the lesson `scratch-cleanup-order.test.ts` paid for:
that guard passed all thirteen of its assertions while parsing 180 of 181
foreign keys, because a pattern matching nothing is never missing
anything.

Four mutations, each reddening its named test: bump a counter on the bare
client (3 red), add a counter model nothing bumps (1 red), make the model
pattern match nothing (1 red), and make it miss exactly one counter — the
180-of-181 shape (1 red). Every file restored byte-identical.

**One of those mutations initially failed to redden, and that was the
mutation's fault rather than the guard's.** Narrowing the pattern's `\s+`
to a single space changed nothing, because the schema is formatted with
single spaces — so it still matched all nine. A mutation that does not
actually break the thing it is aimed at reports the same green as a guard
that works, which is the whole family of defect this file keeps
recording. Replaced with two that genuinely empty the set.

Also checked while in here, and clean: all eight per-job counters are
registered in `HANDLED_MODELS`, `clean-scratch-data.mjs` and
`seed-demo.mjs`, and company-scoped `SafetyCaseCounter` correctly is not.
No third instance of the #224/#228 cleanup miss.

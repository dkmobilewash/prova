### The #510 probe ran, and the dev-mode instrument is now exhausted (Diego)
`diego/probe-result`

**DOCS-ONLY AUDIT**, under the working agreement's rule-1 exception: recording
what an investigation ESTABLISHED, and correcting a claim that is now stale.

#633 added the probe CLAUDE.md's #418 entry had been asking for since
2026-09-25. It ran the same day — run `37347729521`, `main` at `627465b8`.

| | |
| --- | --- |
| loads | **24** (4 routes × 6), every one proved HYDRATED |
| hydration mismatches | **0** |
| positive control | **fired 3/3** |

**What it settles.** The entry's own confound was that a 96-load dev-mode zero
came from a LAPTOP while every red run is a GitHub runner — build mode and
machine moved together, and the defect is a race. This run moved only the
build: the same runner class, the same day, in production mode, printed NINE
mismatched pages on #631 and SIX on #633. Against the entry's measured
production rate of 12 in 40 loads, P(0 in 24) ≈ 0.0002. So the laptop result
was not a laptop artefact, and **Flight's 3,200-byte deferral remains the
surviving mechanism** — it does not exist in a development build.

**The consequence is worth more than the conclusion, and it is the opposite of
what the entry implied.** That paragraph calls a dev run "the one instrument
nobody has pointed at it yet" and wants it for the one thing production cannot
give: the ELEMENT and its component stack. It has now been pointed, and it
reports nothing — because a development build can only name an element it
actually sees disagree. **The element-naming route is CLOSED, not pending.**
A second dev-mode probe will keep returning 24/24, 3/3, zero, which looks like
progress and is the same measurement repeated. What is needed is a
production-mode instrument that can identify an element without React's help,
and nobody has designed one.

Both versions of that paragraph were true when written, which is the shape this
file keeps recording.

**Two bounds, stated because the number is smaller than it looks.** 24 loads is
a quarter of the laptop sweep's 96, over 4 routes rather than 16 — so it is the
weaker sample, decisive only because of what it is compared against. And it is
ONE run of a RACE: re-dispatch the probe before treating a future zero as
confirmation.

No code. The original hedged paragraph is left standing with the result after
it, per this file's own convention of recording both and saying which is which.
573 files / 8,927 unit tests pass, including the guards on `CHANGELOG.md`'s
conventions.

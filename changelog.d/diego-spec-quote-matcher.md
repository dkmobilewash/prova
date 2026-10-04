### A paid eval failed on a curly apostrophe, and said the model had fabricated a quote (Diego)
`diego/spec-quote-matcher`

The spec reader's eval (#604) scores one thing above all others: **a finding
whose quote is not in the document is FATAL**, because a quote that is not on
the page is a paraphrase presented as the spec's own words. It is the one
assertion a plausible-sounding answer cannot satisfy.

Its first paid run failed `buried-mock-up` on three quotes, with that message.

**It was not a paraphrase.** All three were character-for-character the page's
own sentence, **the same length**, differing at exactly one code point: the
model wrote `’` (U+2019) where the fixture has `'` (U+0027). Measured rather
than argued — every differing index was printed, and the only entry was that
pair. A reader that transcribes a sentence perfectly and types the apostrophe
the way a typesetter would has invented nothing.

So the check was answering "are these bytes identical" while claiming to answer
"is this sentence on the page" — this repo's most familiar failure, in a new
costume, and this time inside the assertion written to catch dishonesty. A
false accusation of fabrication is worse than a vague one: it sends the next
person reading the prompt for a defect that is in the harness.

**The matcher now lives in `lib/specs/quoteMatch.ts` rather than inside the
eval, and that move is the substantive part.** The eval costs money to run, so
nothing inside it is exercised on a push — which means the function deciding
whether a fabricated quote gets caught was checked only by a paid run nobody
runs often. It is now covered by `quoteMatch.test.ts` on every push.

Normalisation maps a character to its ASCII twin and nothing else: the
apostrophe and quote families, the hyphen and dash family, non-breaking and
thin spaces, the ellipsis. **No substitution can turn one word into another**,
which is the property that keeps a real fabrication failing. Deliberately not
done: stripping punctuation, stemming, dropping short words, or any fuzzy or
percentage match — each of those would let a paraphrase through, and a
paraphrase is the entire point.

**Both directions are tested, and only the second half is a guard.** The
permissive cases prove an honest transcription is not failed; the hostile ones
prove a paraphrase, an absent sentence, a too-short fragment and an empty quote
all still fail. A file with only the first half would pass a matcher that
returns `true` unconditionally. Proved by mutation rather than asserted:
disabling the normalisation reds 3 tests naming the variants; making the matcher
permissive reds 3 different tests naming the fabrications.

**One test of my own was wrong, and the wrong version was the tempting one.** I
first asserted that a truncated fragment inverting the page's meaning must
fail — the page says "**No** field mock-up is required", so dropping the "No"
reverses it. It passes, and it should: the remainder is a literal substring, and
a containment check reporting that is reporting a true fact. Making it stricter
would reject honest mid-sentence quotes too. The inversion is caught by the
eval's INVENTED check instead, which reads the finding's own claims against the
case's `forbidden` list — and that check passed on the first run, the reader
having declined the case and explained that the section "expressly disclaims
Level 5 and any field mock-up". Two checks, two questions, and collapsing them
into one fuzzy test would do both badly.

**The eval now passes 6 of 6 with every fatal counter at zero** — `requested 6,
returned 6`, INVENTED 0, EAGER 0, UNQUOTED 0, OVERCLAIMED 0, on `claude-opus-5`
with prompt `spec-section.1`. One `missed`, reported and not fatal, and it is
arguably the reader being right: it declined to call Level 4 a cost driver
because Level 4 is the default a drywall estimator prices without being told.

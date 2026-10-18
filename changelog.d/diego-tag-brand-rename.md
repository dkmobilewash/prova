### `tag-blue` has never been blue (Diego)

`diego/tag-brand-rename`

It is `#facc15` — the brand yellow — with `#422006` ink. The hue was deliberate
and documented three lines above the value. **The NAME was the defect**, and a
name that contradicts its own value in the same file is the cheapest kind of
trap this repo keeps paying for.

Renamed to **`tag-brand`** across 21 files, which also makes `tag-brand-soft`
mean something: that is the dark-ground version of the same chip, so the
`-soft` suffix is now relative to something rather than to nothing.

`tag-brand` stays the one tag pair with a LIGHT ground. Nothing on screen
changes colour.

#### Why a rename needed checking at all

**A missed call site would have rendered UNSTYLED, not wrong-coloured.** A
Tailwind class naming no token resolves to nothing — the same mechanism
CLAUDE.md records for `bg-primary` arriving from a generator. So the question
was not "did the rename run" but "would anything notice if it had not".

`colorTokenCensus.test.ts` answers it, and was mutation-tested in both
directions rather than trusted:

| mutation | |
| --- | --- |
| a call site left on `tag-blue` | **RED** — names the file |
| the config left on `tag-blue`, call sites renamed | **RED** |

#### And the gap the mutation found on the way past

**A contrast ratio is symmetric, so swapping a pair's ground and ink leaves
every assertion in `theme-contrast.test.ts` green.** 9.5:1 is 9.5:1 whichever
way round it is read. A swapped `tag-brand` would render yellow text on dark
brown instead of dark text on yellow — not a readability failure, a different
chip entirely, and indistinguishable from `tag-brand-soft`.

The config already claimed `tag-brand` is "the one pair that keeps a LIGHT
ground". That is a claim about luminance, so it is a check now: every `tag-*`
pair must be a dark ground under a light ink, `tag-brand` must be the reverse,
and the parse asserts it found at least five pairs — because nothing is ever
wrong in an empty set.

That third mutation is RED now too.

Preflight green. No schema change.

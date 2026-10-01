### What actually changed, in plain English (Cyrus)
`cyrus/seed-counters-zzbqtu`

Sixty-two places in this app ask Tailwind for a colour that does not exist, and
Tailwind's answer to an undefined class is silence. No error, no fallback — the
element simply renders with no colour.

Found while surveying the palette before reworking Settings. Seven invented
names: `surface-input` (39 sites), `surface-card` (16), `surface-muted` (3),
`surface-sunken`, `ink-strong`, `tag-red-ink`, `tag-amber-ground`, plus
`tag-emerald`/`tag-emerald-ink` (6). None is in `tailwind.config.ts`; there is
no `@apply` in `globals.css`, no safelist and no plugin, so nothing defines
them anywhere.

**Two of these are worse than a missing colour.** `bg-surface-input` is on 39
form fields, on a canvas of `#0f0f0f` — those inputs have no ground of their
own at all. And `tag-emerald-ink` appears in three ternaries whose other branch
is `text-tag-rose-ink`, which IS defined: so the failure state is red and the
success state is nothing. A user reads "not acknowledged" in red and
"acknowledged" in default ink, which looks like something that has not
finished loading rather than something that is fine.

Every one of the 62 is in the estimating / takeoff / bids / billing lane, so
per CLAUDE.md they are issue #573 rather than a PR. This change is the guard
only.

**Why no existing check could see it.** `theme-contrast.test.ts` walks every
DEFINED ink/ground pair and checks its ratio in every palette. It is exhaustive
over the palette and silent about the source. An undefined token is not a pair
with bad contrast — it is not a pair at all, so there is no row it can be
missing from. That is the third member of a family this file already names
twice: *nothing is ever missing from a directory you do not walk*, *nothing is
ever missing from a list nobody imports*, and now **nothing is ever wrong with
a colour that was never defined**. Each is a check that is correct about the
set it can see and blind to the set the defect is in.

So `lib/colorTokenCensus.test.ts` asks the other direction — not "is every
token readable" but "does every token a source file NAMES actually exist". It
derives the valid set from the config rather than restating it, derives which
namespaces are ours from the keys (so adding one extends the census with no
edit here), takes its roots from the `content` globs, and strips comments
through a string-aware tokenizer — load-bearing, because this very file writes
`tag-emerald` in prose and a raw scan would name the census as the offender.

The 62 are held as nine entries keyed by TOKEN AND COUNT, the shape
`formActionCensus` uses. Sixty-two line keys would rot on the first reformat;
a count per token fails when the family grows AND when a name is partly fixed,
which is the moment the number has to come down rather than the moment it gets
forgotten.

**One thing the mutation testing caught that is worth more than the census.**
The scope control originally threw from `statSync` while the `describe` bodies
were evaluated — so a root resolving to nothing reported as **"no tests"**
rather than a red assertion naming the root. CLAUDE.md records that exact shape
costing a session already. "No tests" beside a green sibling is the most
ignorable failure there is. The roots now come back as data and are asserted
inside an `it` that names the broken glob.

Mutation-tested five ways, each red naming the offender except where green is
the point: a new invented token (red), one extra call site of a token already
excepted (red, "gained new call sites"), a dead `content` glob (red, names the
glob), an exception count left too high (red, prune test), and the same
invented token written only inside a comment (**green** — which is the proof
that the tokenizer is doing its job).

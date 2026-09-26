### What actually changed, in plain English (Diego)
`diego/ui-tokens`

The touch-target floor moved to 48, the phone got a palette for direct
sun, and two more things nobody could name became tokens.

**48, not Apple's 44, and the reason is in theme.ts now rather than in a
Slack message**: these hands are in gloves, and Android's own floor is
48dp. 44 is the smallest target a bare fingertip can hit on a phone held
still, which is not the posture this app is used in. Primary actions —
the one thing a screen exists for — run to 56 (`hitTargetPrimary`), so
`Button`'s primary variant is 56 and its floor is 48; the 52 it used to
carry was a number nobody could name, clearing Apple's floor and missing
the primary target.

**A third palette, `outdoor`**, chosen by hand in Settings. Every ink in
it clears 7:1 and most clear 12:1 — `inkMuted` stops being muted, which
is the point: in sun there is no secondary text, only text you can read
and text you cannot. It is never sensed, per Diego: an ambient-light
sensor cannot tell direct sun from a bright office, and a theme that
flips mid-entry is worse than one somebody picked.

**Status colours are named by the thing they are a state of.**
`StatusBadge` held a private map of job and integration states; invoice
and change-order states had no tokens at all, so the next screen needing
"Overdue" would have invented one. `statusTokens` now covers all four
domains and the badge reads from it.

**Two censuses, both mutation-tested.** `touch-targets.test.ts` fails on
a pressable component below the floor and carries a NAMED debt list of
the two not yet migrated — `DateField`'s 38pt calendar cell and
`JobSections`' hardcoded 44 — each with what has to be decided, because
in both cases a bigger number alone is the wrong fix. And the spacing
census grew the half it never had: the gap rule only ever read `gap:`,
so `padding`/`margin` drifted freely underneath it — **91 bare numbers
across 20 files**, four of which (3, 10, 14, 88) appeared in several
files each and were nobody's decision anywhere. Those four are named in
`space` now (`badge`, `control`, `controlX`, `scrollBottom`) rather than
snapped to the 4-pt grid, because snapping them would have redrawn every
field, chip and badge in the app — a visual change wearing a token
change's clothes.

**Two existing censuses were checking two palettes by name.** Adding a
third would have been checked by nothing while every test stayed green —
not a wrong answer, an unasked question, which is the scope half of the
rule CLAUDE.md already states. Both derive their palette list from
`palettes` now and assert the count.

**CLAUDE.md has a UI rules section**, naming which skill to use for which
kind of task, the tokens-only rule with the censuses that enforce it, the
field-use rules no skill covers (56pt primaries, bottom third,
7:1 outdoors, offline/queued/synced on every screen, pickers over typing,
photos tagged and queued), and the closing rule that a screen is reviewed
against the accessibility and HIG skills before it is called finished —
because no test here can see layout at all.

**One audit finding was wrong and is corrected in the same breath.** The
audit that prompted this said Dynamic Type would clip `Button` because it
declares a fixed height. `minHeight` is a MINIMUM — the box grows with
the text, and Button does not clip. What actually clips is a real fixed
`height:` around text, which in this app is `DateField`'s 38pt day cell
alone; the widespread issue is `numberOfLines` truncation on ten sites,
which loses content rather than breaking layout. Both are PR 2's.

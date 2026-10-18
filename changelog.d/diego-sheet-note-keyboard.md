### The keyboard sat on top of the note you were writing (Diego)
`diego/sheet-note-keyboard`

No migration. A `KeyboardAvoidingView`, two ScrollView props and a scroll on
focus.

**REPORTED FROM A REAL PHONE**, on a TestFlight build, which is the only
instrument that could have found it. Placing a pin opens the note card at the
BOTTOM of the screen — deliberately, and the file says why: *"this phone is
held in one hand and often on a ladder"*. The keyboard then opened straight
over it, so you could not see what you were typing.

**Three things, and only the first was reported.**

  - `KeyboardAvoidingView` lifts the content clear. The same pattern
    `app/sign-in.tsx` already uses, `padding` on iOS only — this is the app's
    established answer, not a new one.
  - `keyboardShouldPersistTaps="handled"`, **which nobody reported and is a
    real bug**: without it the first tap on "Place note" with the keyboard up
    only dismisses the keyboard. People tap twice and never notice they did.
  - A `scrollToEnd` when the field takes focus. Lifting the view is not the
    same as showing the field — this card is the last thing on a long screen,
    so it can be clear of the keyboard and still below the fold. The two are
    different problems and the fix needs both halves.

**WHAT THE TEST CANNOT DO, AND THIS IS THE PART WORTH READING.** It cannot
prove the keyboard is avoided. Nothing here can: the screen suite renders in
happy-dom, which does no layout, returns zeros from `getBoundingClientRect`,
and has no keyboard. `lib/sheet-note-keyboard.test.ts` is a PRESENCE census —
the same instrument that passed on three broken expo-router header fixes in a
row with its size and scope assertions both holding.

> A census can tell you the code is THERE.
> It can never tell you a framework HONOURS it.

So the verdict comes from a phone and nowhere else. **This is NOT verified.**
It needs a new TestFlight build and somebody typing a note on one. What the
census is for is narrower and still worth having: once a device has confirmed
it, this stops a later tidy-up quietly removing it — a `KeyboardAvoidingView`
wrapped round a `ScrollView` reads like redundant nesting to anyone who has
never seen the bug.

| mutation | result |
| --- | --- |
| control | green |
| `KeyboardAvoidingView` removed | **RED** |
| `keyboardShouldPersistTaps` dropped | **RED** |
| the focus scroll removed | **RED** |

Each mutation was checked for having changed the CODE rather than a comment,
by comparing comment-stripped text before and after — twice this week a
mutation has reported green because it only edited prose.

**One structural near-miss worth recording.** The first edit put the closing
`</KeyboardAvoidingView>` on the INNER horizontal ScrollView — the sheet-number
strip — instead of the outer one, because both close with the same five
characters and the inner one comes first. Caught by reading the tag structure
back rather than by a test, since it still typechecked. CLAUDE.md's rule about
editing by exact text rather than structural pattern, earning itself again.

Both mobile suites (42 files / 352 tests, 16 files / 78 tests) and `expo lint`
clean.

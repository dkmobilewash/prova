### A header option can be discarded in silence, and three fixes shipped green because of it (Diego)
`diego/cold-start-header-trap`

**DOCS-ONLY AUDIT**, under the exception Diego granted 2026-09-07. No code,
no schema, no migration. It records what an investigation established so
the next person does not re-run it — the second thing that exception admits.

#555 fixed the cold-start dead end and was confirmed on a phone on
2026-09-29. What is NOT in the repo is why the three attempts before it
failed, and that is the part with a price on it: four releases and a whole
evening.

**The finding.** `Stack.Screen` in expo-router 57.0.21 is two components
wearing one name. In a layout its props are read by the navigator — that is
how `title` reaches these screens, and `title` was visibly rendering the
entire time the header button was not. Inside a PAGE it delegates to
`views/Screen.js`, which calls `navigation.setOptions` from a layout effect
behind `navigation.isFocused()` read at render and never subscribed, plus an
`isPreloaded` check — and a cold deep-link launch is exactly where those are
unsettled. A FUNCTION passed as layout `options` is separately spread with
`{ ...props.options }` (`StackScreen.js:78`), and a function has no
enumerable own properties, so it becomes `{}`.

**The transferable half is not about expo-router.** The census asserted the
code was present — first in the screens, then in the layout — and passed
both times, with its size and scope assertions holding, on an app where
nothing rendered. A census can tell you the code is THERE; it can never tell
you a framework HONOURS it. That is a fourth member of a family this file
already documents twice, and it is the limit of the instrument rather than a
failure of rigour:

    nothing is missing from a directory you do not walk
    nothing is missing from a list nobody imports
    nothing is ever missing from a question nobody is asking

So the rule recorded is about where a fix LIVES: anything that must be
visible on a cold-start screen goes in the screen BODY, where React renders
it and a test can see it. And the mutation that distinguishes a real guard
from a mock-measuring one is **"make it render nothing"** — every test
written for #548, #553 and #554 stayed green under it.

**One smaller thing, kept because it generalises.** `HeaderHomeButton`
coloured its label `brand` — #facc15 on a near-white rail — which `theme.ts`
forbids in as many words. `theme-contrast.test.ts` never caught it and
neither did a human, **because the button it sat on never appeared.** A
defect inside dead code is invisible to every instrument, including the one
written for that exact defect.

**Not claimed:** nothing here is new behaviour, and no test guards prose.
The entry names the date and the version it was read from, which is the only
honest form available for a finding about somebody else's library.

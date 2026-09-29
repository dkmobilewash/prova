### Two releases shipped a way out of a dead-end screen and neither one rendered (Diego)
`diego/way-home-in-the-layout`

**No schema change, no migration.** Mobile only. Found on a real phone,
which remains the only instrument that could have found it.

**What was wrong.** #548 gave `/alerts` a Home button for a cold
notification tap; its follow-up gave `/job/<id>` the same thing. Both
shipped. **Neither rendered.** Reported from a phone on build 4: header bar
present, nothing on the left, no way back.

The absence of a back chevron is what made it diagnosable — it proves
`canGoBack()` really was false, so the conditional fired and the option was
simply discarded.

**The mechanism, read out of the installed expo-router 57.0.21 rather than
guessed.** `Stack.Screen` is TWO components wearing one name:

- In a **layout**, its props are read by the navigator. This is how `title`
  reaches these screens, and `title` demonstrably renders.
- Inside a **page**, it renders and delegates to `views/Screen`, which calls
  `navigation.setOptions` from a layout effect behind a guard —
  `const isFocused = navigation.isFocused()` read at render and **not**
  subscribed, plus an `isPreloaded` check. A cold deep-link launch is
  exactly where focus and preload state are unsettled.

`StackScreen.js` says the same thing twice more in its own source: it warns
that *"function-form options are not supported inside page components"*, and
its docstring tells you to prefer `Stack.Title` / `Stack.Header` for
page-level header configuration. Both fixes did the one thing the library
documents against.

**The fix** moves the decision to the layout, onto the same lever `title`
already pulls, as a function evaluated with that screen's own navigation:

```tsx
<Stack.Screen name="job/[jobId]" options={({ navigation }) => ({
  title: t("nav.job"), ...wayHomeOptions(navigation),
})} />
```

`wayHomeOptions` is pure and lives in `components/wayHome.tsx`, away from
the layout, **so that what to render is answerable in node.** That is the
whole point: the previous two attempts were untestable by construction, and
that is why they survived two releases.

**THE GUARD WAS GREEN THE WHOLE TIME, AND REWRITING IT IS THE REAL WORK
HERE.** `push-destination-exit.test.ts` asserted that each destination's
SCREEN file contained `canGoBack` and `HeaderHomeButton`. Both did. It
passed honestly, with a size assertion and a scope assertion both holding —
and the app was broken.

Neither of those could have helped. They ask whether the set is COMPLETE,
and this set was complete and irrelevant: the census was pointed at a
location that does not deliver. A third member of the family —
*nothing is ever missing from a question nobody is asking* — after
"nothing is missing from a directory you do not walk" and "nothing is
missing from a list nobody imports".

So the census now asserts the **delivery**: every destination is declared in
`app/_layout.tsx` with `wayHomeOptions` wired in. It also asserts the
inverse, which is the regression that would look most like a fix — that no
screen sets header options from inside itself again, with an error message
saying why.

**Mutation-tested, and the control passes first so the rest means
something:**

| | mutation | reds on |
| --- | --- | --- |
| ctl | nothing | green, both suites |
| M1 | job route loses `wayHomeOptions` | "declares every destination … with a way home" |
| M2 | **alerts** route loses it | same |
| M3 | `<Stack.Screen options>` put back in a screen | "keeps the decision out of the screens" |
| M4 | decision made unconditional | the control — "adds nothing when the stack can already go back" |
| M5 | decision never offers Home (**the original defect**) | both way-home assertions |

**Deleted on purpose: the screens tests that vouched for the broken fix.**
They mounted a screen, set `canGoBack` false, and checked it recorded a
`headerLeft` option — which it did, in a mock, while the framework threw the
real one away. A green test asserting on a mechanism the framework ignores
is worse than no test, because it is why two releases went out believing
this was fixed.

**WHAT IS STILL NOT PROVEN, and it is the sentence to read.** Nothing here
demonstrates that React Navigation delivers `headerLeft` from a layout
options function on a cold launch. No test in this repo can see that — the
census proves the wiring exists and the pure test proves the decision is
right, and neither watches a navigator. The evidence it will work is that
`title` reaches these same screens by this same mechanism and was visible on
the phone during the failure. **That is strong evidence and it is not
proof**, and this is the third attempt at this bug, so it should be
described that way until somebody taps a notification from a cold start and
sees a Home button.

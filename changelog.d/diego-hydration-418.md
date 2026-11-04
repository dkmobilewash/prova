### The #418 that failed step 11 on almost every run is found and fixed: React re-claimed `<main>` (Diego)

`diego/hydration-418`

The pilot journey's step 11 and the shoot rehearsal's last check went red on
nearly every CI run with a React #418 on a different random page. Nobody had
been able to say which element disagreed, because production React prints no
diff and the defect never reproduced in `next dev`.

**The instrument.** Production React does compute a component stack for every
hydration error; it hands it to `onRecoverableError` as a second argument that
Next 15.5 ignores. The mismatch locator probe now wraps that handler before
hydration, and also reads the DOM, the JS stack and the Flight/webpack state at
the instant React builds the error. Each was proved by the existing injected-node
control before any result was read.

**What it said, 42 times out of 42 in 540 loads:** the failing fiber is the
shell's `<main>`, thrown from React's replay of a suspended HOST component.
`<main>`'s child is Next's LayoutRouter element, whose props carry the
`(app)/error.tsx` client module; when that chunk has not run yet, the Flight
client hands the element back as a lazy, which suspends `<main>`. The replay
claims `<main>` again from a cursor that already moved inside it, finds the
page's first `<div>`, and the whole page regenerates.

**The fix** is `components/PageSlot.tsx`, a bare function component between
`<main>` and the page, so the suspension lands on something that claims no DOM
node. `components/pageSlot.test.tsx` reproduces the mismatch against the real
react-dom without it (the control) and shows none with it;
`shellRegion.test.ts` pins that the layout keeps using it.

**Measured:** the same probe on the same runner class went from 42 mismatches
in 540 loads (4 runs) to 0 in 270 (2 runs), control firing 3/3 every time.
Not yet measured: CI's own `e2e` job, which only runs on the PR.

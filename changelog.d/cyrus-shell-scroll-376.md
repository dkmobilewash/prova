### The scroll-port guard, and what two days of `main` did to it (Cyrus)
`cyrus/shell-scroll-376`

Issue #376 reported the document scrolling 112px on `/dashboard` — the top
bar sliding away when only the content inside it should move. The obvious
suspect was something inside the shell's scroll port sized to the raw
viewport (`h-screen`, `100dvh`) instead of to `--shell-port`, the variable
`app/(app)/layout.tsx` declares for exactly that.

**That suspect was checked and cleared, in real Chromium rather than by
reading.** A `min-h-screen` child nested inside `<main>`, a
`fixed inset-0` overlay with an absolutely-positioned child taller than the
viewport, and `SidePanel` mounted open with 3000px of content each added
**0px** to `document.scrollingElement.scrollHeight`. So the element that
produced the 112px is not on `main` today, and this branch does not pretend
to have found it. What it adds is the guard against the next one:
`apps/web/components/shellPortCensus.test.ts`, which derives every
raw-viewport-height occurrence from source, requires each to be named with
a one-line reason it is safe, and fails by file, token and count.

**Then the branch sat for two days, and the guard earned its keep before it
ever merged.** Merging current `main` in and re-running it produced five
findings — four new occurrences and one entry pointing at code that has
gone:

| file | what | verdict |
| --- | --- | --- |
| `app/global-error.tsx` | `min-h-screen` on `<body>` | safe — a global error boundary renders its own `<html>`/`<body>`; no shell exists |
| `components/CompanySetupGate.tsx` | `min-h-screen` on `<main>` | safe — rendered only by `app/welcome/page.tsx`, outside the `(app)` group on purpose |
| `components/SearchLauncher.tsx` | `100dvh` + `60vh` | safe — both inside a `position: fixed` panel, same shape as `HelpButton`/`AskLauncher` |
| `components/LandingPage.tsx` | `min-h-[78svh]` | safe — outside `(app)`, no port to escape |
| `app/page.tsx` | entry expects 1, file has none | **stale** — #457 moved the landing markup into `LandingPage.tsx` |

Each of the four was verified at its mount point, not assumed from its
name, and named in the allowlist with the reason. None is the bug.

**The last row is the one worth reading.** An allowlist entry for a file
that no longer matches is a claim about code that has gone, and it is
invisible to a check that only asks "is this file listed?". This census
asks for a per-file COUNT, so the move announced itself. That is the same
lesson `scratch-cleanup-order.test.ts` paid for from the other direction —
a set you derive has two failure modes, a wrong answer and an empty
question, and only the first one looks like a failure.

**Mutation-tested, both caught and both restored green:** dropping
`SearchLauncher`'s count from 2 to 1 went red naming the file; a new
unlisted `min-h-screen` component added under `app/(app)/` went red naming
the file and quoting the token.

**Still not verified, and a human has to close it:** the live authenticated
check the issue actually asks for — `document.scrollingElement.scrollHeight
=== clientHeight` on a real signed-in route at more than one window height.
No agent session can sign in. The click-list on the PR says how.

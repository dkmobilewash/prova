# The display face, and why the file is in the repository

`BarlowCondensed-SemiBold-latin.woff2` is Barlow Condensed, weight 600,
latin subset — the face every heading in this app renders in. It is wired
up in `app/layout.tsx`, which carries the measurements that chose it.

## Why `next/font/local` and not `next/font/google`

`next/font/google` downloads the file **at build time**. That is a
third-party network dependency on every build, in CI and on Vercel, for a
22KB file that never changes — and a build that cannot reach
`fonts.googleapis.com` does not degrade, it FAILS. It also could not be
measured from an agent container at all: Node's fetch does not use the
egress proxy, so the build failed with "Failed to fetch `Barlow Condensed`
from Google Fonts" and there was nothing to put a browser in front of.

`next/font/local` reads this file. No network at build time, the same bytes
every time, and it still does the two things a `<link>` to Google Fonts
cannot: it self-hosts (no third-party connection from a visitor's browser,
nothing to block, no privacy question) and it generates a size-adjusted
fallback so the swap does not move the text.

## Licence

SIL Open Font License 1.1 — `OFL.txt`, copied from the upstream project
(`google/fonts/ofl/barlowcondensed`). The OFL permits redistribution,
including of a subset, provided the licence travels with the file. It does
so here. Barlow declares no Reserved Font Name, so the family keeps its
name.

## Replacing or adding a weight

Every heading in this app is `font-semibold`, so ONE weight (600) is all
that is served. Adding another weight means another file and another
`src` entry in `layout.tsx` — not a `weight` string, which for a local
font only declares what the file already is. Re-measure the headline if
you change the face: `app/layout.tsx` records the min-content widths that
the hero's column widths were chosen from, and a wider face overflows that
column rather than wrapping.

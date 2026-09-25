### What actually changed, in plain English (Cyrus)
`cyrus/e2e-red-three`

Three of the four things making the signed-in browser suite red on `main`.
Two were the TEST being wrong. One was a real, small hole in the app.

**The import page was never broken.** `/settings/import` has been recorded
twice — in #495's notes and in the guard audit — as "hits the error
boundary". It does not, and the run that said so proves it: the same spec's
other test opens the Clients box on that page, picks a file, and reads the
refusal sentence back, and it passes. What failed was the locator.
`getByText("Clients")` matches any text CONTAINING "clients", and each box
carries both a heading ("Clients") and its own button ("Import clients"), so
Playwright refused an ambiguous match before it ever looked at the page. All
three lines had it — "Jobs" is inside "Import jobs", "Crew" inside "Import
crew". They ask for the heading by role now. Every test in that file also
calls `expectHealthy` from here on, which is the check that can actually
tell a broken page from a broken selector: it reads the screen for this
app's own "This page didn't load" wording and names the sentence it found.
A note claiming the page was broken sent the next two people looking at the
wrong half of the product for two weeks.

**The two phone screens were not broken either, and the health check was.**
`field-screens.mobile.spec.ts` walks daily field reports and punch lists at
375px — the width a foreman actually holds. Both failed on "the app shell's
main navigation is missing", which was true and was the wrong question: the
240px rail is deliberately `display: none` on a phone, where the hamburger
and its drawer are the navigation. The check asked every signed-in page for
the desktop rail at every width. It asks the browser what the CSS media
query sees now and requires whichever navigation that width owes — the rail
at desktop, the drawer button on a phone. Deliberately not "either one":
that would go green on a phone still showing a desktop rail.

**The real defect, found while establishing which of those two it was: the
phone drawer had no name.** Below `md` the rail is gone, and the drawer's
`<nav>` carried no `aria-label` — so on a signed-in phone page there was no
named navigation landmark anywhere in the product. Somebody using a screen
reader in a truck got an anonymous "navigation" and nothing to jump to. It
says `Main` now, the same name the rail has used all along, and the two are
never on screen together so one name is right rather than ambiguous.

Checks: `components/MobileNav.test.ts` mounts the drawer and asserts the
landmark, its name, and the current-page marker inside it (removing the
attribute again fails it: *expected null to be 'Main'*).
`e2e/lib/health.test.ts` pins the breakpoint to what Tailwind's own config
resolves `md` to, and both landmark names to the two components that render
them — with comments stripped first, because the first draft of that check
passed while the attribute was deleted from the JSX: the comment explaining
the attribute quoted it, which is #185's disarmed census exactly.
`e2e/specs/shell-nav.mobile.spec.ts` presses the hamburger in a real
Chromium at 375px, which nothing in this repo had ever done — proof the
landmark exists where it counts, and that Escape closes it.

Not fixed here and not mine: the React hydration mismatch the journey's
step 11 reports on a dozen-plus pages. Another branch owns it, so the
`e2e` job stays red until that lands.

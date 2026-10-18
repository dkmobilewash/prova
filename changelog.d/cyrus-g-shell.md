### The left sidebar is gone: a slim top bar, bottom tabs on a phone, and "All pages" for everything else (Cyrus)
`cyrus/g-shell`

The owner's brief was that the app "looks too much like HighLevel and every
other CRM — the bar on the side with all the tabs." Concept G removes the
rail from every signed-in page. Desktop gets one slim top bar: the C Stream
wordmark (home), three words (Jobs · Money · Schedule, the current one
underlined in brand yellow), the search box, Ask, Help and an avatar. A
phone gets the wordmark, a search icon and the avatar on top, and a fixed
Home · Jobs · Money · Schedule tab bar along the bottom, clear of the
home-indicator inset, with the page padded so nothing hides behind it.

Nothing became unreachable. The avatar menu's "All pages" opens one
full-width panel listing every group and page the rail offered, in the
rail's own groups, filtered by the same `navGroupsFor` capability and
business-scope rules, every group open. The Money Rail's five figures moved
onto those group headings (Proving now sits on Paper trail, which holds the
RFIs and submittals it counts) and are still loaded only behind
VIEW_COMPANY_FINANCIALS. The alert count moved from the bell onto the
avatar, and the menu always lists Alerts with its count. Clerk's
UserButton was replaced by the menu's own "Your account" and "Sign out".

Deleted with the files they mounted: Sidebar, MobileNav, Topbar,
SearchLauncher (⌘K now opens the new palette, and only that), useNavAccordion
and their three tests. Every census that named them was moved to the new
files, not dropped. The checks: `components/shell/shell.test.tsx`
(mutation-tested: an unfiltered Money link and a renamed stage key each go
red), plus the shell-region, help, business-scope, Clerk-gate and E2E health
censuses pointed at TopBar and BottomTabs. The metric bar now shows from
`md` up only; on a phone the Money tab is the way to the figures.

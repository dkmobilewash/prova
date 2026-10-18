### The rail changed its name, and one assertion failed while its twin went quiet

`cyrus/sales-signals`

Merging `main` into this branch turned `e2e` red on a spec that had passed on the
head before it. Not a product defect and not the conflict resolution: main's shell
refactor renamed the landmark the assertion was aiming at.

**`nav[aria-label="Main"]` is now the AREA TABS, not the page rail.** It is
`components/shell/TopBar.tsx` on desktop and BottomTabs on a phone, and its
contents come from `primaryTabs()` — Home, Jobs, Money, Schedule, AI, enumerated
in code. So `/sales` cannot appear under that name at all, by construction; the
rail is `nav[aria-label="Pages"]` (`components/shell/Sidebar.tsx`), and
`components/shell/sidebar.test.tsx` asserts in as many words that the rail has no
"Main" landmark. Both spellings were right in their turn, which is why this read
as correct when it was written.

**THE HALF WORTH RECORDING IS THE ONE THAT DID NOT FAIL.** The same locator
appears twice in this spec: the operator must SEE the link, and a tenant must
not. The operator's assertion went red, which is how any of this was found. The
tenant's is `toHaveCount(0)` — so it kept passing, and would have kept passing if
a tenant could reach the link, because after the rename no "Sales CRM" link
existed under that name for anybody. A rename breaks a positive assertion loudly
and silently disarms its negative twin. The negative one was the
security-adjacent half.

It was vacuous for a second reason that outlives the rename, so fixing the name
alone would have left it hollow: the rail expands only the group holding the
current page, and a tenant has no group holding `/sales` — every group is
collapsed and NO page link is in the DOM for anyone. The count would pass against
a rail that had rendered nothing at all. It is sized now, on a fact that survives
the collapse: `navGroupsFor` drops the whole "Internal" SECTION for a tenant, and
a group's heading renders whether or not it is open. So the tenant case asserts
the rail is there, that it has groups, that "Internal" is not among them, and only
then that the link is absent.

Established by measurement rather than by reading, since the signed-in suite
cannot run in an agent container: a throwaway render of `Sidebar` showed the link
present under `Pages` for the operator, absent with `showsInternal: false`, and
absent on `/dashboard` — the group being closed there. That probe's own control
was mis-specified first (it expected more than 20 links and got 2) and in failing
it confirmed the mechanism: on `/sales` the only open group is "Internal", whose
two items are `/sales` and `/internal/usage`. The typecheck was mutation-tested
on this file rather than trusted, because a clean `tsc` and an unparsed one look
identical — a deliberate `TS2322` was injected and the checker named it.

The remaining `e2e` failure on this branch is the #510 hydration race, which is
red on `main` at the same commit and is not this PR's.

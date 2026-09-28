### What actually changed, in plain English (Cyrus)
`cyrus/business-scope-promise`

The "Set up for your work" box on `/settings` told a paying contractor that
**"Retainage, prevailing wage, certified payroll and a few other menus only
apply to some businesses"**. Two of those three named things are not
affected by any answer they can give. `ROUTE_HIDDEN_WHEN` in
`lib/businessScope.ts` hides exactly `/submittals`, `/prevailing-wage` and
`/union-compliance`. Retainage and certified payroll have no top-level rail
entry at all — they are job routes, and
`app/(app)/jobs/[id]/(tabs)/layout.tsx` does not consult business scope
anywhere. `businessScope.ts` says so in its own comment; the screen the
customer reads said the opposite, so somebody answering these questions was
being told they were about money they hold back from a GC.

The fix is not a corrected list of menu names. A sentence that enumerates
routes is false the day the map changes, and the map is being extended on
another branch right now. The copy now describes what the answers DO —
tailor what the sidebar shows, delete nothing, leave every page reachable by
search, by Ask and by its own link, changeable any time — and names no
menus, with a comment above it saying why adding one back is the wrong
instinct.

The guard is the other half. `isHiddenByBusinessScope` is display-only BY
CONSTRUCTION and nothing enforced it: one import in a page, a loader or a
search filter turns it into an access gate, and the failure is invisible —
a customer who answered "no public work" simply never learns a page exists,
which looks exactly like the feature working. That is #540's shape one axis
over. `lib/businessScopeDisplayOnly.test.ts` now fails the build if anything
outside the rail's own three files reaches that symbol — by name, by alias,
by namespace import, by default import, by a literal dynamic `import()`, or
by an `export … from` that would hand it to a file the census would then
never look at. Type-only imports are not callers and are not flagged; eight
files import `BusinessScopeAnswers` and all of them are innocent. When the
rail legitimately grows a fourth consumer, the failure message says to add
its path to `RAIL_FILES` and why.

Built to the three rules this repo has paid for, because all three failure
modes are live here. **SIZE**: the importing files are found twice, by an
import grammar and by a grammar-free backwards scan off the literal
characters of the specifier, and the two sets must be equal; the file walk
is counted twice as well, by its own regex and by `path.extname`, plus two
files by name. **SCOPE**: the roots come from `tailwind.config.ts`'s
`content` globs AND `tsconfig.json`'s `include`, each asserted to exist —
not belt-and-braces, because `content` does not cover `lib/`, which is where
this module lives and where a server-side gate would most naturally be
written. **COMMENTS**: stripped before every read, length-preserving so an
offender can be named with a line number — `businessScope.ts` and
`navItems.tsx` both discuss this symbol in prose, and `navItems.test.ts`
names it in a comment while importing something else.

Mutation-tested nine ways, each mutation confirmed applied before its result
was read: a real illegal import (red, naming file and line), the same import
in a `//` and in a `/* */` (green, both), the discovery pattern matching
nothing (red on the count — 0 against 1,502, not a green empty list), the
import grammar matching nothing (red on the two-mechanism set equality), a
content-glob root that does not exist (red, naming the directory), a
namespace import, a re-export barrel, the real rail consumer dropped from
the allowlist, and an allowlist entry that is no longer a file.

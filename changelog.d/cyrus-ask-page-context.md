### The assistant now knows which page you are standing on (Cyrus)
`cyrus/ask-page-context`

A coworker standing next to you does not ask which job you mean. They can
see the screen.

`AskLauncher` has been in the Topbar since the demo build, so the assistant
is on every page in the app — and it knew nothing about which one. Standing
on Riverside's job page and saying "log 8 hours for Tino today" made it
resolve a job from scratch, or ask. `AskRequest` now carries `pagePath`, and
`/jobs/<id>` and every route nested under it (certified payroll, the photo
report, a pay application — all still that job) resolve to a job the person
can see.

**THE HINT IS NOT AN AUTHORITY, and that distinction is the whole design.**
The path arrives in a request body from a browser, so it is exactly as
trustworthy as anything else a caller can type. Three things make it safe,
and they are separated on purpose so no one layer is load-bearing alone:

  - `lib/ask/page-context.ts` parses a path to an id and **reads no rows**.
    It cannot grant access because it cannot reach data.
  - `lib/ask/page-context-query.ts` looks that id up through the session's
    own `companyId`, which is a PARAMETER closed over from Clerk and never
    taken from the body — the same arrangement the tools use. A forged
    `/jobs/<someone-else's-id>` finds no row and returns null, which is
    byte-identical to sending no path. There is deliberately no "that job
    is not yours" branch: telling a caller their guess named a real job
    elsewhere is an existence oracle, and the honest outcome is identical
    either way.
  - nothing here widens what the assistant may read. Every tool and command
    was company-scoped before this and still is. **The worst a hostile path
    achieves is a wrong default among jobs the caller can already see.**

`/api/ask`'s header comment promised that "nothing is read from the request
body except the question and, for a chip answer, the pick". That is no
longer literally true, so **it is amended in this diff rather than left to
go quietly false** — a security invariant nobody has re-read is exactly the
kind of sentence this repo has paid for before.

**The prompt sentence is scoped to the case where no job was named**, and
that scoping is the difference between help and a confident wrong answer. A
model told to "use this job" bends an explicit "on Cedar Park" toward the
page it happens to be on. It reads: if they say "this job", or ask something
that needs a job and name none, they mean that one — *if they name a
different job, that one wins*. There is a test on that sentence.

Joined onto `accessContext` rather than into `SYSTEM_PROMPT`, because both
vary per request and the prompt is the cached half.

**What this is not.** It is not conversation memory: `ask.prisma` still has
no thread model and every question is still standalone. That is a real gap
and a separate piece of work. This is the smaller half that changes how the
thing feels, because most of what made it feel like a search box was having
to re-establish context the screen was already showing.

**Mutations**, each watched red and restored:

| broke | result |
| --- | --- |
| dropped `companyId` from the resolver's `where` | **RED** — the scope test names it |
| accepted any path segment as an id | **RED** — 2 tests, parser and query |

The first is the one that matters: the security boundary is pinned by an
assertion on the argument sent to the database, not by a comment. Reading
the `where` clause was chosen over seeding two companies deliberately — a
seeded test would pass equally against a post-query `if (job.companyId !==
companyId)` check, which is the same protection with one more place to
forget it.

Also pinned: the parser refuses path traversal, quotes, angle brackets,
uppercase and hyphens; `/jobs` on its own is NOT a hint, because "this job"
on a list of five means nothing; and a well-formed id belonging to someone
else is deliberately NOT rejected by the parser, so that nobody later
"hardens" it into a false sense of security that the company scope is
actually providing.

test 3202/3202 (189 files), lint clean, typecheck clean, build green.

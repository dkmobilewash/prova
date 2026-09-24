### When the E2E seed is refused, the log now says which rule refused it (Diego)
`diego/e2e-floor`

The two Clerk secrets went in today, so `ci.yml`'s `e2e` job ran its first
real pass — the first time anything behind sign-in has been checked in a
browser by CI. It got through install, Prisma, a real `next build` and a
booted server, and then died in global setup with this as the complete
explanation:

```
ClerkAPIResponseError: Unprocessable Entity
   at ../lib/seedClerkUsers.ts:46
```

That is the HTTP reason phrase and nothing else. **Clerk had already sent
the reason** — a `code`, a `message` and a human-written `longMessage` per
error, sitting on the thrown object — and `toString()` drops every word of
it. All of it was one property access away the whole time.

**Why the missing word is the expensive part.** A 422 from `createUser` is
always an instance RULE refusing an address, and *which* rule decides where
the fix goes: an allowlist or a blocklist is a dashboard toggle, blocked
subaddresses is a toggle, a rejected address format is a change to
`personas.ts`. Those have nothing in common except the status code. Without
`code` you cannot tell them apart, so the next move is a guess — and the
cheapest guess was wrong: "Block email subaddresses" looks obvious because
all six personas carry `+clerk_test`, but that rule keys on the address with
its subaddress REMOVED, and the six bases are distinct, so each one is a
first sign-up and allowed. An hour would have gone into the wrong toggle.

`describeClerkSeedFailure` prints Clerk's own `code`, `message`,
`longMessage`, HTTP status and `clerkTraceId`, names the persona that could
not be created, and says the one thing that is true whatever the code:
this is a setting on the instance those secrets point at, not a bug in the
app — so nobody's first move is reading app code.

**Deliberately NOT a lookup table keyed by Clerk's error codes.** Writing
one means inventing code strings that cannot be verified from here, and a
hint keyed to a code that does not exist is this repo's "written,
documented, and never called" shape — it reads as coverage while matching
nothing. Clerk writes `longMessage` for a person to read; printing it beats
paraphrasing it.

**The `instanceof` that would have failed only in CI.** The check is
duck-typed on purpose. `ClerkAPIResponseError` is re-exported by
`@clerk/backend` from `@clerk/shared`, which is not a direct dependency
here, so an identity check can be made against a different copy of the
class and silently return false — landing back on a bare "Unprocessable
Entity" with a unit test still green. That is mutation M2 below, and it is
the reason the test asserts against a plain object.

| mutation | result |
| --- | --- |
| stop printing Clerk's `code` | RED, 3 failed |
| `instanceof` instead of the duck-typed read | RED, 3 failed |
| the blank-line-eating filter this nearly shipped with | RED, 1 failed |

The third one is not hypothetical — I wrote it, in the first draft. Dropping
an absent `clerkTraceId` line with `.filter(line => line !== "")` also eats
every paragraph break, flattening the message into one block in a wall of
scrolling CI log. It is a `null` sentinel now, and a test holds the blank
lines.

**A false green in my own mutation harness, worth recording.** The first M1
run reported 9 passed — because the `perl` substitution had failed on a
`??` in the pattern and never applied, so it tested an unmodified file. A
mutation that does not apply is indistinguishable from a guard that works.
The harness now exits 3 if its needle is absent, which is the same rule
this repo already has for censuses (assert the set is non-empty before
reasoning about it) arriving in the tooling that checks them.

Nothing here changes what the suite tests. It changes what happens when the
suite cannot start, which on 2026-09-24 was the difference between a
diagnosis and a guess.

## It ran, and it caught the author choosing the wrong fields

The first version shipped, CI ran it, and the answer came back:

```
Clerk said (HTTP 422):
  - [form_data_missing] missing data
  clerkTraceId: 26ebe7ad7766ee667df8fe5df9f576f7
```

**Which is a MISSING FIELD, not a restriction** — the other family entirely
from the one the message confidently told the reader to go and look at.
Two things were wrong, and both are the same mistake:

- the pointer named Restrictions and nothing else, so it aimed an
  afternoon at the wrong dashboard page. It now names both families and
  says the `code` is what distinguishes them;
- `meta` was **not printed**, and `meta` is where Clerk names the missing
  parameter. The formatter had chosen which fields to show, and the field
  it did not choose was the one that would have ended the investigation.

So the formatter no longer chooses. It prints the labelled fields **and**
dumps every error object verbatim, because the lesson of the round trip is
that the useful field is the one you did not anticipate. `safeJson` makes
that dump non-throwing — a diagnostic that replaces the error it is
reporting is the worst available outcome.

**And the second vacuous test of the day, in a test written to catch the
first.** The new "prints meta" case asserted `toContain("username")` and
passed with the structured meta line deleted entirely, because the raw
dump at the bottom carries the same string. Mutation M4 went GREEN when it
should have gone red. It asserts the labelled form now.

| mutation | result |
| --- | --- |
| stop printing `meta` | RED *(green until the test was fixed)* |
| drop the raw dump | RED |
| let `safeJson` throw | RED |

## And the raw dump paid for itself on the very next run

`meta` came back **empty** — `{}`. The answer was in `longMessage`, which
the labelled section printed and which the raw dump made impossible to
miss:

```
["username" "phone_number"] data doesn't match user requirements
set for this instance
```

So the `striking-jaybird` instance requires a username and a phone number,
and the suite was sending an email alone. Had the formatter still been
choosing fields — and `meta` was the field I added precisely to answer
this — the second round trip would have printed `meta: {}` and told us
nothing. That is the argument for the dump, made by the run after the one
that suggested it.

**Fixed on the suite's side, not the instance's.** Each persona gains a
username and a phone. The alternative — relaxing the requirement on
`striking-jaybird` — was rejected because that instance is SHARED: it
holds the original dev users, and loosening what it asks for so a test can
pass changes what every other dev sign-up is asked for. Sending two more
fields costs nothing and touches nobody.

The numbers are Clerk's documented fictional range, `+1 (XXX) 555-0100`
through `555-0199`, which send no SMS and verify with `424242` — the same
bargain `+clerk_test` makes for email. `personas.test.ts` holds both
invariants that are invisible at the point a seventh persona would be
added: every identity field distinct, and every phone inside the test
range. A real number there would text a stranger on every CI run.

| mutation | result |
| --- | --- |
| two personas share a phone | RED |
| two personas share a username | RED |
| a real phone number slips in | RED |

A duplicate would not fail where it was made — it fails inside
`createUser` on whichever persona is seeded second, as the same opaque 422
this whole PR started with.

**One thing for Diego rather than for this PR:** development requires
username and phone; nothing here establishes whether production
(`cstream.ai`) does. If it does not, the two instances disagree about what
a user needs, which is the kind of drift CLAUDE.md's Clerk table exists
for. Flagging, not fixing — it needs somebody who can read both
dashboards.

### What actually changed, in plain English (Cyrus)
`cyrus/input-error-convergence`

A contractor types `2,800` into a quantity, or `12,500` into a money field,
and presses Save. Until now that produced a blank screen with a reference
number on it. It now produces the sentence `"quantity" must be a number`,
under the form, with the rest of what he typed still there.

**The cause, and why it was two bugs rather than one.** #407 found that
`lib/actions/company.ts` had its own `class InputError` and its own
`runAction` that caught only that class, while the shared parsers it called
threw `shared.ts`'s class of the same name. Two classes, one name,
`instanceof` false between them, so the refusal escaped and production
redacted it — that was the digest on `/welcome`. #407 converted the two ENUM
parsers and switched that one module over.

It left the two DECIMAL parsers throwing a bare `Error`, and those are the
ones a contractor reaches first, because `Number("2,800")` is `NaN`. So the
comma was still a class nothing in the repo caught. That single line is the
fix for the bug people actually hit; everything else here is what stops it
coming back.

**Sixteen files held a private copy of the class. Fifteen of them were not
broken.** Worth saying plainly, because the number is the misleading part:
of the fifteen modules outside `shared.ts`, exactly ONE (`changeOrders.ts`)
called a shared parser at all — and it had already paid for the gap by hand,
with local `decimal()` / `nullableDecimal()` wrappers that caught the bare
`Error` and rethrew it as its own class. The other fourteen were traps
waiting for the first person to reach for `enumFromForm`. All sixteen now
import the one class and the one boundary; `changeOrders.ts`'s workaround is
deleted, and the message a person reads is byte-identical to the one the
wrapper used to forward. `unionCompliance.ts` had the identical arrangement
under the name `SetupError` and was converged with them — no grep for
`InputError` would ever have found it.

**The live bugs were somewhere else entirely, and this is the part worth
remembering.** Counting FILES that declare the class finds the traps.
Counting BOUNDARIES finds the bugs. Three actions declare
`Promise<ActionResult>` — a promise that their refusals are legible — and
call a throwing parser with no boundary anywhere, so the rejection escapes
and is redacted. None of the three declares a local class, so the grep that
found the sixteen could never see them:

- `compliance.ts` → `createCompanyLicense` / `updateCompanyLicense`. Fixed
  here. Saving a licence on `/settings` with a value the picker did not
  offer — a stale tab, a restored form — gave a digest. It reads perfectly
  in `next dev`, which is why it survived.
- `billing.ts` → `logPayment`, and `jobs.ts` → `addCostEntry`. Both left
  alone: estimating/job-costing/billing is Diego's lane and both are live
  money. Flagged in `#prova-build` under the live-money exception, and
  recorded as a named, deliberately-listed exception in the new census, so
  they cannot be forgotten.

**The guard: `lib/actionErrorBoundaryCensus.test.ts`.** Three rules — one
`InputError` class in the repo; no file converting an error by testing a
class it declared itself; no action promising a legible refusal while
calling a throwing parser outside a boundary. It is built against this
repo's three census scars and says so in its header: the file list comes
from `git ls-files` over the WHOLE repository (`theme-contrast.test.ts` had
the right pattern and a root that could not see `packages/ui`), every set it
reasons about is size-asserted against a count derived a different way
(`scratch-cleanup-order.test.ts` parsed 180 of 181 foreign keys and passed),
and the header states plainly what it reasons about and what it therefore
cannot catch — a throw from a helper in another module, or anything dynamic.
The two known-unconverted actions are a ratchet, not an allowlist: the test
fails if a new one appears AND if a listed one is fixed without deleting its
line.

Eight mutations, eight red — including one that first reported GREEN because
the mutation had not applied, which is the "refuted versus never ran" trap in
miniature and is why every mutation here is asserted to have landed before
its result is read.

What a contractor sees change: a bad number or a bad dropdown value now
gives a sentence instead of a blank page on change orders and proposals
(`/jobs/[id]`), and on licences (`/settings`). Nothing else moves — no
schema change, no migration, and no refusal anywhere changed its wording.
